const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const DB_PATH = path.join(__dirname, 'database.json');
const PROMPT_PATH = path.join(__dirname, 'prompt.txt');

const API_URL = 'https:' + '//' + 'openrouter.ai/api/v1/chat/completions';
const API_KEY = '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'; // ◄— Make sure your active OpenRouter Key is pasted here!
const MODEL = 'meta-llama/llama-3.3-70b-instruct';

const FEEDS = [
  { name: 'RTÉ News', url: 'https:' + '//' + 'www' + '.rte.ie/news/rss/news-headlines.xml' },
  { name: 'Dublin Live', url: 'https:' + '//' + 'www' + '.dublinlive.ie/news/?service=rss' }
];

function readDb() {
  if (!fs.existsSync(DB_PATH)) return { local_articles: [], articles: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) { return { local_articles: [], articles: [] }; }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function cleanText(t) {
  return t.replace(/\s+/g, ' ').trim();
}

async function scrapeArticle(url) {
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    const $ = cheerio.load(html);
    const image_url = $('meta[property="og:image"]').attr('content') || $('article img').first().attr('src') || null;
    let paragraphs = $('p').map((_, el) => cleanText($(el).text())).get().filter(p => p.length > 50);
    return { text: paragraphs.slice(0, 8).join('\n\n'), image_url };
  } catch (err) { return { text: '', image_url: null }; }
}

// 🚨 PRECISION EXTRACTION MODEL BEYOND THE XML ROADBLOCKS
function extractItemsUsingRegex(xmlText) {
  const items = [];
  const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];
  
  itemMatches.slice(0, 5).forEach(itemXml => {
    const titleMatch = itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemXml.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = itemXml.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/) || itemXml.match(/<link>([\s\S]*?)<\/link>/);
    
    if (titleMatch && linkMatch) {
      items.push({
        title: cleanText(titleMatch[1]),
        link: cleanText(linkMatch[1])
      });
    }
  });
  return items;
}

async function run() {
  if (API_KEY === 'YOUR_API_KEY_HERE') { console.error('Error: Please paste your openrouter key string inside the API_KEY variable line.'); return; }
  const db = readDb();
  if (!db.articles) db.articles = [];
  const seen = new Set(db.articles.map(a => a.url));
  const dynamicGuidelines = fs.existsSync(PROMPT_PATH) ? fs.readFileSync(PROMPT_PATH, 'utf8') : 'Rewrite as a punchy tabloid article.';

  console.log('Connecting to OpenRouter Gateway Route...');

  for (const feed of FEEDS) {
    console.log('Scanning Feed Channel: ' + feed.name);
    try {
      const xmlResponse = await axios.get(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 15000
      });

      const items = extractItemsUsingRegex(xmlResponse.data);

      for (const item of items) {
        if (seen.has(item.link)) continue;
        console.log('  Processing Article Entry: ' + item.title);

        const scraped = await scrapeArticle(item.link);
        if (!scraped.text) continue;

        try {
          const response = await axios.post(API_URL, {
            model: MODEL,
            messages: [
              { role: 'system', content: dynamicGuidelines + '\nIMPORTANT: Output ONLY the raw rewritten copy. No thinking process, no analysis tags, no intros.' },
              { role: 'user', content: 'Title: ' + item.title + '\n\nText:\n' + scraped.text }
            ],
            temperature: 0.7,
            max_tokens: 1000
          }, {
            headers: { 
              'Authorization': 'Bearer ' + API_KEY, 
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https:' + '//' + '://github.com',
              'X-Title': 'The North Dublin Chronicle'
            },
            timeout: 60000
          });

          const choicesList = response.data && response.data.choices;
          if (!choicesList || choicesList.length === 0) throw new Error('Empty choices returned');
          
          const copy = (choicesList[0].message ? choicesList[0].message.content : choicesList[0].text || '').trim();
          if (!copy) throw new Error('Blank content generated');

          db.articles.push({
            headline: item.title,
            content: copy,
            url: item.link,
            image_url: scraped.image_url,
            scraped_at: new Date().toISOString()
          });
          seen.add(item.link);
          saveDb(db);
          console.log('    Successfully logged rewritten story.');

        } catch (aiErr) { console.error('    AI Rewrite Failed: ' + aiErr.message); }
      }
    } catch (feedErr) { console.error('  Failed to read feed channel: ' + feedErr.message); }
  }
  console.log('Done! Run "node publish.js" to compile your newspaper layout.');
}

run();
