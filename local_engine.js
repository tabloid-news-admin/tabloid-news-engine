// local_engine.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const axios = require('axios');

const DB_PATH = path.join(__dirname, 'database.json');
const PROMPT_PATH = path.join(__dirname, 'local_prompt.txt');

const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';

// Feeds to scan. Add more here as the local stream grows.
const FEEDS = [
  {
    name: 'Dublin People Northside West',
    url: 'https://dublinpeople.com/news/category/northsidewest/feed/',
  },
  // Keep your existing Reddit RSS feed here, e.g.:
  // { name: 'Reddit /r/Dublin', url: 'https://www.reddit.com/r/Dublin/.rss' },
];

const MAX_ITEMS_PER_FEED = 10;

const parser = new Parser({
  customFields: { item: [['content:encoded', 'content:encoded']] },
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tabloid-news-engine/1.0)' },
});

// ---------- Database helpers ----------
function loadDb() {
  if (!fs.existsSync(DB_PATH)) return { articles: [], local_articles: [] };
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!Array.isArray(db.articles)) db.articles = [];
    if (!Array.isArray(db.local_articles)) db.local_articles = [];
    return db;
  } catch (err) {
    console.error('Could not parse database.json, aborting to avoid data loss:', err.message);
    process.exit(1);
  }
}

function saveDb(db) {
  // If the internal script data package was initialized as a flat list array, 
  // wrap it cleanly inside the named object vault compartment our webpage expects
  const alignedStructure = Array.isArray(db) ? { local_articles: db } : db;
  
  fs.writeFileSync(DB_PATH, JSON.stringify(alignedStructure, null, 2), 'utf8');
}

// ---------- Image extraction ----------
function extractFirstImage(item) {
  const html = item['content:encoded'] || item.content || '';
  if (!html) return null;

  const $ = cheerio.load(html);
  const img = $('img').first();
  if (!img.length) return null;

  // Handle lazy-loaded images as well as plain src
  let src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || null;
  if (!src) return null;

  src = src.trim();
  if (src.startsWith('//')) src = 'https:' + src;
  if (!/^https?:\/\//i.test(src)) return null; // skip data: URIs and relative paths
  return src;
}

function stripHtml(html) {
  if (!html) return '';
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim();
}

// ---------- AI call ----------
async function rewriteWithAI(systemPrompt, item) {
  const rawHtml = item['content:encoded'] || item.content || '';
  const bodyText = stripHtml(rawHtml || item.contentSnippet || '').slice(0, 4000);

  const userMessage =
    `Source headline: ${item.title}\n` +
    `Source link: ${item.link}\n\n` +
    `Source text:\n${bodyText}`;

  const res = await fetch(TOGETHER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) throw new Error(`Together AI HTTP ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';

  // Models sometimes wrap JSON in fences or add chatter, so pull out the object
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ---------- Main ----------
async function main() {
  if (!process.env.TOGETHER_API_KEY) {
    console.error('Missing TOGETHER_API_KEY in .env');
    process.exit(1);
  }

  const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
  const db = loadDb();
  const seen = new Set(db.local_articles.map((a) => a.source_url));
  let added = 0;

  for (const feed of FEEDS) {
    console.log(`\nScanning: ${feed.name}`);
    let parsed;
    
    try {
      const response = await axios.get(feed.url, {
        headers: {
          'User-Agent': process.env.REDDIT_USER_AGENT,
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
        responseType: 'text',
        transformResponse: [(data) => data], // stop axios from auto-parsing the body
        timeout: 20000,
      });

      const cleanXml = response.data.trim().replace(/^\uFEFF/, "");

      // Diagnostic: if the server sent something other than XML, show what it was
      if (!cleanXml.startsWith('<')) {
        throw new Error(`Response is not XML. First 200 chars: ${cleanXml.slice(0, 200)}`);
      }

      parsed = await parser.parseString(cleanXml);
    } catch (err) {
      console.error(`  Failed to fetch feed: ${err.message}`);
      continue;
    }

    for (const item of parsed.items.slice(0, MAX_ITEMS_PER_FEED)) {
      if (!item.link) continue;
      if (seen.has(item.link)) {
        console.log(`  Skip (duplicate): ${item.title}`);
        continue;
      }

      try {
        const result = await rewriteWithAI(systemPrompt, item);

        // Adjust these field names to match the JSON your local_prompt.txt asks for
       if (!result.newsworthy) {
          console.log(`  Skip (not newsworthy): ${item.title}`);
          seen.add(item.link); // avoid re-paying the AI call next run
          
          // 🚨 TEMPORARY FILTER OVERRIDE: 
          // Comment out 'continue' by adding two slashes so it doesn't skip the story
          // continue; 
          
          // Force a fallback pillar so the page compiler script can format it cleanly
          if (!result.pillar || result.pillar === "None") {
            result.pillar = "1 NEWS";
          }
        }

        const record = {
          ...result,
          source: feed.name,
          source_url: item.link,
          original_title: item.title,
          published_at: item.isoDate || item.pubDate || null,
          processed_at: new Date().toISOString(),
          image_url: extractFirstImage(item),
        };

        db.local_articles.push(record);
        seen.add(item.link);
        added++;
        saveDb(db); // save after each success so a crash never loses work
        console.log(`  Added: ${item.title}${record.image_url ? ' [image]' : ''}`);
      } catch (err) {
        console.error(`  Error on "${item.title}": ${err.message}`);
      }
    }
  }

  console.log(`\nDone. ${added} new local article(s) added.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});