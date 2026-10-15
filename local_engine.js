'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const axios = require('axios'); // still used for the Together AI call
const cheerio = require('cheerio');
const Parser = require('rss-parser');

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

// Your RSS source constant. Override with REDDIT_URL in .env if you prefer.
const REDDIT_URL = process.env.REDDIT_URL || 'https://www.reddit.com/r/Dublin/new/.rss?limit=50';
const REDDIT_USER_AGENT = 'node:tabloid-news-engine:v1.0.0 (local Dublin stream)';

const DB_PATH = path.join(__dirname, 'database.json');
const DB_TMP_PATH = DB_PATH + '.tmp';

const MAX_POSTS_PER_RUN = parseInt(process.env.MAX_LOCAL_POSTS_PER_RUN || '15', 10);
const MAX_POST_CHARS = 6000;

// The model's JSON must carry one of these boolean flags to mark a post as
// newsworthy or not. If none is present, an object is treated as approved.
const APPROVAL_KEYS = ['newsworthy', 'is_newsworthy', 'approved'];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': REDDIT_USER_AGENT },
});

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
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

// --- Database (shares database.json with engine.js, touches only its own keys) ---
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

// --- Reddit RSS ---
/** Pull plain post body text out of a feed item and drop Reddit's boilerplate footer. */
function extractBody(item) {
  let body = '';
  if (item.contentSnippet) {
    body = item.contentSnippet;
  } else if (item.content) {
    body = cheerio.load(item.content).text();
  }
  return body
    .replace(/submitted by\s+\/?u\/\S+[\s\S]*$/i, '') // "submitted by /u/name [link] [comments]"
    .replace(/\s+\n/g, '\n')
    .trim();
}

function buildPostText(item) {
  const body = extractBody(item);
  const parts = [`Title: ${item.title}`];
  if (body) parts.push(body);
  return parts.join('\n\n').slice(0, MAX_POST_CHARS);
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
  if (!TOGETHER_API_KEY) {
    throw new Error('Missing TOGETHER_API_KEY. Add it to your .env file.');
  }

  console.log('[Local] Fetching Reddit RSS feed...');
  const feed = await parser.parseURL(REDDIT_URL);
  const items = feed.items || [];
  console.log(`[Local] ${items.length} items in feed.`);

  // Deduplication against local_articles (and local_rejected, so non-news isn't re-sent every run)
  const db = readDb();
  const seen = new Set([
    ...db.local_articles.map((a) => normalizeUrl(a.source_url)),
    ...db.local_rejected.map(normalizeUrl),
  ]);

  const fresh = [];
  for (const item of items) {
    if (fresh.length >= MAX_POSTS_PER_RUN) break;
    if (!item.link || !item.title) continue;

    if (seen.has(normalizeUrl(item.link))) {
      console.log(`  skip (already seen): ${item.link}`);
      continue;
    }
    fresh.push(item);
  }

  if (fresh.length === 0) {
    console.log('[Local] No new posts. Nothing to do.');
    return;
  }

  // Read the system rules once, now that we know there is work to do
  const promptPath = resolvePromptPath();
  const systemPrompt = fs.readFileSync(promptPath, 'utf8').trim();
  console.log(`[Local] Loaded system rules from ${promptPath}`);
  console.log(`[Local] Sending ${fresh.length} new post(s) to the model...`);

  let approved = 0;
  let rejected = 0;

  for (const item of fresh) {
    try {
      const reply = await askModel(systemPrompt, buildPostText(item));
      const result = parseModelJson(reply);

      if (isApproved(result)) {
        saveApproved({
          ...result,
          source_url: item.link, // set last so the model can't override it
          reddit_id: item.id || null,
          reddit_title: item.title,
          reddit_author: item.author || null,
          posted_at: item.isoDate || null,
          model: MODEL,
          processed_at: new Date().toISOString(),
        });
        approved++;
        console.log(`  approved: ${item.title}`);
      } else {
        saveRejected(item.link);
        rejected++;
        console.log(`  not newsworthy: ${item.title}`);
      }
    } catch (err) {
      // Not recorded anywhere, so it gets retried on the next run.
      console.error(`  failed for ${item.link}: ${err.message}`);
    }

    await sleep(500);
  }

  console.log(`\n[Local] Done. ${approved} approved, ${rejected} rejected, ${fresh.length - approved - rejected} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });