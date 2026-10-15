'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');
const TMP_PATH = DB_PATH + '.tmp';

/** Strip hash, tracking params and trailing slash so the same article always matches. */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    [...u.searchParams.keys()]
      .filter((k) => k.toLowerCase().startsWith('utm_') || ['fbclid', 'gclid', 'ref'].includes(k.toLowerCase()))
      .forEach((k) => u.searchParams.delete(k));
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return String(url).trim();
  }
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) return { articles: [] };
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  if (!raw.trim()) return { articles: [] };
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.articles)) data.articles = [];
    return data;
  } catch (err) {
    // Refuse to continue rather than overwrite a corrupt ledger and lose history.
    throw new Error(`database.json is corrupt and could not be parsed: ${err.message}`);
  }
}

const db = loadDb();
const seen = new Set(db.articles.map((a) => normalizeUrl(a.source_url)));

function persist() {
  // Write to a temp file first, then swap, so a crash can't leave a half-written ledger.
  fs.writeFileSync(TMP_PATH, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(TMP_PATH, DB_PATH);
}

/** Has this URL already been processed? */
function urlExists(url) {
  return seen.has(normalizeUrl(url));
}

/**
 * Save a successfully processed article.
 * Expects at least { source_url, rewritten_copy }.
 */
function saveArticle(record) {
  if (!record || !record.source_url) {
    throw new Error('saveArticle requires a source_url');
  }
  const key = normalizeUrl(record.source_url);
  if (seen.has(key)) return false;

  const rewritten = record.rewritten_copy || '';
  const original = record.original_text || '';

  db.articles.push({
    source_url: record.source_url,
    source: record.source || null,
    title: record.title || null,
    image_url: record.image_url || null,
    rewritten_copy: rewritten,
    metrics: {
      original_word_count: original ? original.split(/\s+/).filter(Boolean).length : 0,
      rewritten_word_count: rewritten.split(/\s+/).filter(Boolean).length,
      model: record.model || null,
    },
    processed_at: new Date().toISOString(),
  });
  seen.add(key);
  persist();
  return true;
}

module.exports = { urlExists, saveArticle, normalizeUrl };