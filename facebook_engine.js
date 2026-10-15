'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const axios = require('axios');

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

// Hardcoded target. Replace with the full URL of your Facebook group.
// (A bare https://facebook.com is not a group, so the script refuses to run with it.)
const FACEBOOK_GROUP_URL = process.env.FACEBOOK_GROUP_URL || 'https://www.facebook.com/groups/346088715883642/';

// Apify actor, in the "username~actor-name" format used by the API.
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'apify~facebook-groups-scraper';
const APIFY_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`;
const MAX_POSTS = 10; // budget protection: only the newest 10 posts

const DB_PATH = path.join(__dirname, 'database.json');
const DB_TMP_PATH = DB_PATH + '.tmp';

const MAX_POST_CHARS = 6000;
const MIN_POST_CHARS = 20; // skip photo-only or near-empty posts

// The model's JSON must carry one of these boolean flags to mark a post as
// newsworthy or not. If none is present, an object is treated as approved.
const APPROVAL_KEYS = ['newsworthy', 'is_newsworthy', 'approved'];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Strip hash and tracking params but KEEP real query params, because some
 * Facebook permalinks identify the post in the query string.
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    [...u.searchParams.keys()]
      .filter((k) => {
        const key = k.toLowerCase();
        return (
          key.startsWith('utm_') ||
          key.startsWith('__') ||
          ['fbclid', 'ref', 'comment_id', 'reply_comment_id'].includes(key)
        );
      })
      .forEach((k) => u.searchParams.delete(k));
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase();
  }
}

function resolvePromptPath() {
  const candidates = [
    process.env.LOCAL_PROMPT_PATH,
    path.resolve('local_prompt.txt'), // relative to the folder you run the script from
    path.join(__dirname, 'local_prompt.txt'),
    path.join(os.homedir(), 'Desktop', 'local_prompt.txt'),
    path.join(os.homedir(), 'OneDrive', 'Desktop', 'local_prompt.txt'),
  ].filter(Boolean);

  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      'local_prompt.txt not found. Checked:\n  ' +
        candidates.join('\n  ') +
        '\nSet LOCAL_PROMPT_PATH in .env to its exact location.'
    );
  }
  return found;
}

// --- Database (shares database.json with the other engines, touches only its own keys) ---
function readDb() {
  if (!fs.existsSync(DB_PATH)) return { articles: [], local_articles: [], local_rejected: [] };
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  if (!raw.trim()) return { articles: [], local_articles: [], local_rejected: [] };
  let db;
  try {
    db = JSON.parse(raw);
  } catch (err) {
    // Never overwrite a corrupt ledger; stop and let the user look at it.
    throw new Error(`database.json is corrupt and could not be parsed: ${err.message}`);
  }
  if (!Array.isArray(db.articles)) db.articles = [];
  if (!Array.isArray(db.local_articles)) db.local_articles = [];
  if (!Array.isArray(db.local_rejected)) db.local_rejected = [];
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_TMP_PATH, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(DB_TMP_PATH, DB_PATH); // swap in so a crash can't leave a half-written file
}

function saveApproved(entry) {
  const db = readDb(); // re-read fresh so we never clobber other keys
  const key = normalizeUrl(entry.source_url);
  if (db.local_articles.some((a) => normalizeUrl(a.source_url) === key)) return false;
  db.local_articles.push(entry);
  writeDb(db);
  return true;
}

function saveRejected(url) {
  const db = readDb();
  const key = normalizeUrl(url);
  if (db.local_rejected.some((u) => normalizeUrl(u) === key)) return false;
  db.local_rejected.push(url);
  writeDb(db);
  return true;
}

// --- Apify ---
async function fetchFacebookPosts() {
  const { data } = await axios.post(
    APIFY_URL,
    {
      startUrls: [{ url: FACEBOOK_GROUP_URL }],
      resultsLimit: MAX_POSTS,
      viewOption: 'CHRONOLOGICAL', // newest first
    },
    {
      headers: {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      params: { limit: MAX_POSTS }, // hard cap on items returned from the dataset
      timeout: 330000, // Apify's synchronous endpoint waits up to 300s
    }
  );
  if (!Array.isArray(data)) throw new Error('Unexpected Apify response (expected an array of posts)');
  return data.slice(0, MAX_POSTS);
}

/** Unique key for a post: its URL, or a synthetic key built from its id. */
function getPostKey(post) {
  const url = post.postUrl || post.url || post.facebookUrl || post.topLevelUrl;
  if (url && /^https?:\/\//i.test(url)) return url;
  const id = post.id || post.postId || post.legacyId;
  return id ? `facebook-post:${id}` : null;
}

function getPostText(post) {
  const text = post.text || post.message || post.postText || '';
  return String(text).trim().slice(0, MAX_POST_CHARS);
}

// --- Together AI ---
async function askModel(systemPrompt, userText, attempt = 1) {
  try {
    const { data } = await axios.post(
      TOGETHER_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      },
      {
        headers: {
          Authorization: `Bearer ${TOGETHER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 90000,
      }
    );
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('Empty response from model');
    return content;
  } catch (err) {
    const status = err.response?.status;
    const retryable = status === 429 || (status >= 500 && status < 600) || err.code === 'ECONNABORTED';
    if (retryable && attempt < 4) {
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`  AI call failed (${status || err.code}), retrying in ${wait / 1000}s...`);
      await sleep(wait);
      return askModel(systemPrompt, userText, attempt + 1);
    }
    throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message);
  }
}

/** Parse the model's reply as JSON, tolerating code fences or stray text around it. */
function parseModelJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error('Model did not return valid JSON');
  }
}

function isApproved(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (Object.keys(obj).length === 0) return false;
  for (const key of APPROVAL_KEYS) {
    if (key in obj) return obj[key] === true || obj[key] === 'true';
  }
  return true;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  if (!APIFY_TOKEN) throw new Error('Missing APIFY_TOKEN. Add it to your .env file.');
  if (!TOGETHER_API_KEY) throw new Error('Missing TOGETHER_API_KEY. Add it to your .env file.');

  // Refuse to spend Apify credits on a placeholder URL.
  const urlPath = new URL(FACEBOOK_GROUP_URL).pathname.replace(/\/+$/, '');
  if (!urlPath) {
    throw new Error(
      'FACEBOOK_GROUP_URL is still the bare facebook.com placeholder. ' +
        'Set it in the script or in .env to your group URL, e.g. https://www.facebook.com/groups/<group-name>'
    );
  }

  console.log(`[Facebook] Running Apify actor ${APIFY_ACTOR_ID} (up to ${MAX_POSTS} posts)...`);
  const posts = await fetchFacebookPosts();
  console.log(`[Facebook] ${posts.length} posts returned.`);

  // Deduplication against local_articles (and local_rejected, so non-news isn't re-sent every run)
  const db = readDb();
  const seen = new Set([
    ...db.local_articles.map((a) => normalizeUrl(a.source_url)),
    ...db.local_rejected.map(normalizeUrl),
  ]);

  const fresh = [];
  for (const post of posts) {
    const key = getPostKey(post);
    if (!key) {
      console.warn('  skip (no url or id on post)');
      continue;
    }
    if (seen.has(normalizeUrl(key))) {
      console.log(`  skip (already seen): ${key}`);
      continue;
    }
    const text = getPostText(post);
    if (text.length < MIN_POST_CHARS) {
      console.log(`  skip (no usable text): ${key}`);
      continue;
    }
    fresh.push({ post, key, text });
  }

  if (fresh.length === 0) {
    console.log('[Facebook] No new posts. Nothing to do.');
    return;
  }

  // Read the community archivist guidelines once, now that we know there is work to do
  const promptPath = resolvePromptPath();
  const systemPrompt = fs.readFileSync(promptPath, 'utf8').trim();
  console.log(`[Facebook] Loaded system rules from ${promptPath}`);
  console.log(`[Facebook] Sending ${fresh.length} new post(s) to the model...`);

  let approved = 0;
  let rejected = 0;

  for (const { post, key, text } of fresh) {
    try {
      const reply = await askModel(systemPrompt, text);
      const result = parseModelJson(reply);

      if (isApproved(result)) {
        saveApproved({
          ...result,
          source: 'facebook',
          source_url: key, // set last so the model can't override it
          facebook_post_id: post.id || post.postId || null,
          posted_at: post.time || post.timestamp || null,
          model: MODEL,
          processed_at: new Date().toISOString(),
        });
        approved++;
        console.log(`  approved: ${key}`);
      } else {
        saveRejected(key);
        rejected++;
        console.log(`  not newsworthy: ${key}`);
      }
    } catch (err) {
      // Not recorded anywhere, so it gets retried on the next run.
      console.error(`  failed for ${key}: ${err.message}`);
    }

    await sleep(500);
  }

  console.log(`\n[Facebook] Done. ${approved} approved, ${rejected} rejected, ${fresh.length - approved - rejected} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const detail = err.response?.data ? ` ${JSON.stringify(err.response.data)}` : '';
    console.error('Fatal error:', err.message + detail);
    process.exit(1);
  });