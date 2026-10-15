'use strict';

require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const { urlExists, saveArticle } = require('./database');
const fs = require('fs');

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

const MAX_ARTICLES_PER_RUN = parseInt(process.env.MAX_ARTICLES_PER_RUN || '10', 10);
const MAX_SOURCE_CHARS = 12000; // cap on text sent to the model
const MIN_BODY_CHARS = 300;     // skip pages where scraping clearly failed

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Verify these feed URLs are still current; override via .env if they change.
const FEEDS = [
  {
    track: 'A',
    source: 'RTÉ',
    url: process.env.RTE_FEED_URL || 'https://www.rte.ie/news/rss/news-headlines.xml',
    bodySelectors: ['.article-body p', 'article p', '[class*="article"] p'],
  },
  {
    track: 'B',
    source: 'Dublin Live',
    url: process.env.DUBLIN_LIVE_FEED_URL || 'https://www.dublinlive.ie/?service=rss',
    bodySelectors: ['.article-body p', 'article p', '[class*="article"] p'],
  },
];

// Replace this with your own editorial guidelines.
const TABLOID_GUIDELINES = `
You are a senior investigative political correspondent and front-page news editor writing for a high-impact, right-leaning populist tabloid like The Sun, The New York Post, or Gript Media. 

Your task is to completely rewrite raw mainstream news text into an alternative, comprehensive news report that carries the exact same level of granular detail, numbers, and facts as the original piece, but with a highly visible, aggressive right-leaning national-populist tabloid slant that is hyper-critical of left-wing ideology, progressive talking points, and left-wing political actors.

To deliver maximum punch and tabloid anger while keeping the text flowing naturally like a professional news item, you must strictly enforce these guidelines:

1. SCREAMING HEADLINES (NO EMBEDDED ATTRIBUTIONS):
- Your headline must be short, high-impact, and use all-caps tabloid formatting.
- Focus the headline entirely on the crisis, institutional failure, or establishment hypocrisy. Do not include attribution phrases inside the headline.

2. MUSCULAR TABLOID VOICE & IRISH LOCAL ANCHORS:
- Tone: Blistering, urgent, punchy, and completely unapologetic. Avoid all bland, corporate, mainstream, or clinical language. 
- Active Slant: Do not hide behind mechanical prefaces like "observers claim" or "critics argue." Bake the anti-establishment perspective directly into the narrative using powerful, loaded adjectives and active verbs (e.g., "betrayal," "catastrophe," "breaking point," "systemic rot," "taxpayer squandering," "citizens left behind").
- Local Flavor: Incorporate authentic regional terminology when critiquing systems. Use terms like "the Civil Service gravy train," "NGO spending rackets," "Leinster House elites," "taxpayer fleecing," and "working-class communities left abandoned" to ground the populism locally.

3. THE RIGHT-WING POPULIST CONTRAST & LEFT-CRITIQUE RULE:
- Every single rewrite must draw a sharp, aggressive narrative line between everyday hard-working citizens/frontline workers, and the out-of-touch, progressive, or left-wing establishment figures causing or exploiting the mess.
- Anti-Left Filter: You must be explicitly hyper-critical of left-wing talking points, progressive virtue-signaling, globalist narratives, and left-wing political parties (including Sinn Féin, People Before Profit, the Social Democrats, and Labour). 
- Framing Protests & Activism: Mainstream progressive or left-wing causes (such as pro-Palestinian displays at sporting events or climate protests) must never be treated with respect or positivity. Frame them aggressively as out-of-touch, divisive virtues-signaling distractions organized by radical left activists, detached from the everyday pressing bread-and-butter realities of regular citizens.
- Framing Left-Wing Politicians: Interventions by left-wing politicians (like Sinn Féin or PBP representatives) must never be presented as helpful or positive solutions. Frame their actions critically—expose them as opportunistic, grandstanding, tax-and-spend populism, or soft-on-crime posturing that undermines local security and fiscal sanity.

4. DYNAMIC LENGTH & ANTI-PADDING CONTROLS:
- Length Rule: Treat length strictly as a dynamic requirement. Do NOT pad out text to reach a specific sentence count. If a story has rich data, write a comprehensive 6-to-10 sentence report. If a story lacks heavy content, limit the write-up strictly to 3-to-5 punchy sentences. 
- Anti-Fluff Guardrail: If a story lacks enough content, do NOT fill space with generic editorial commentary or speculative fluff. State the available raw facts aggressively, deliver the punch, and stop immediately. 

5. ZERO BOILERPLATE / ZERO PHRASE REPETITION:
- You are strictly BANNED from repeating fixed emotional templates, idioms, or predictable filler phrases across different news items. 
- Never use the exact formulas: "Locals say fury has hit a boiling point", "Locals are furious", or variants of "boiling point". Invent fresh, unique action-driven descriptions for every individual story.

6. FACTUAL ANCHORS & BORDER REALITY:
- Maintain 100% factual accuracy regarding names, dates, numbers, and locations. Never invent raw data or fabricate elements out of thin air.
- Immigration & Resource Strain: When the raw content naturally touches upon local services, community capacity, public safety, planning permissions, or civic infrastructure, color the narrative with a distinct skepticism toward open borders and unchecked migration (both legal and illegal). Explicitly frame these crises as the inevitable consequence of a failed establishment policy supported by progressive elites that imposes an unsustainable burden on already collapsing housing markets and bottlenecked healthcare systems.
- If a story lacks an infrastructure or resource link entirely (like a soft-news piece or culture festival), frame it as an ideological distraction: "While hard-pressed families struggle with a cost-of-living crisis, establishment insiders spend taxpayer cash on vanity projects."

7. TECHNICAL RESTRAINT:
- Output ONLY the rewritten news stories. Do not include any conversational introductions, transitional sentences, or meta-commentary between items. Start directly with the headline of the first story.
`.trim();

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': USER_AGENT },
});

function cleanText(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** Scrape the full article page: body text + lead image. */
async function scrapeArticle(url, bodySelectors) {
  const { data: html } = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-IE,en;q=0.9' },
    timeout: 20000,
    maxRedirects: 5,
  });

  const $ = cheerio.load(html);

  // Image: Open Graph first, then Twitter card, then first article image.
  const image_url =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('article img').first().attr('src') ||
    null;

  // Body: try each selector until one yields enough text.
  let paragraphs = [];
  for (const selector of bodySelectors) {
    paragraphs = $(selector)
      .map((_, el) => cleanText($(el).text()))
      .get()
      .filter((p) => p.length > 40);
    if (paragraphs.join(' ').length >= MIN_BODY_CHARS) break;
  }

  // Last resort: every paragraph on the page.
  if (paragraphs.join(' ').length < MIN_BODY_CHARS) {
    paragraphs = $('p')
      .map((_, el) => cleanText($(el).text()))
      .get()
      .filter((p) => p.length > 60);
  }

  const text = paragraphs.join('\n\n');
  return { text, image_url };
}

/** One feed, one loop: dedupe check -> scrape -> bundle. Returns new, scraped articles. */
async function collectFromFeed(feed) {
  console.log(`\n[Track ${feed.track}] ${feed.source}: fetching feed...`);
  const bundles = [];

  let parsed;
  try {
    parsed = await parser.parseURL(feed.url);
  } catch (err) {
    console.error(`[Track ${feed.track}] Could not read feed: ${err.message}`);
    return bundles;
  }

  console.log(`[Track ${feed.track}] ${parsed.items.length} items in feed.`);

  for (const item of parsed.items) {
    if (bundles.length >= MAX_ARTICLES_PER_RUN) break;

    const url = item.link;
    if (!url) continue;

    if (urlExists(url)) {
      console.log(`  skip (already processed): ${url}`);
      continue;
    }

    try {
      const { text, image_url } = await scrapeArticle(url, feed.bodySelectors);
      if (text.length < MIN_BODY_CHARS) {
        console.warn(`  skip (body too short, likely blocked or paywalled): ${url}`);
        continue;
      }
      bundles.push({
        source: feed.source,
        source_url: url,
        title: item.title || '',
        image_url: image_url || item.enclosure?.url || null,
        original_text: text,
      });
      console.log(`  new: ${item.title}`);
    } catch (err) {
      console.error(`  scrape failed for ${url}: ${err.message}`);
    }

    await sleep(1000); // be polite to the source sites
  }

  return bundles;
}

/** Call Together AI, with retry on rate limits / transient errors. */
async function rewriteAsTabloid(article, attempt = 1) {
  const userPrompt = article.original_text.slice(0, MAX_SOURCE_CHARS);

  try {
    // Dynamically pull the latest rules directly from our external text file
    const dynamicGuidelines = fs.readFileSync('prompt.txt', 'utf8');

    const { data } = await axios.post(
      TOGETHER_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: dynamicGuidelines }, // Swapped to use our new file content
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
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

    const copy = data?.choices?.[0]?.message?.content?.trim();
    if (!copy) throw new Error('Empty response from model');
    return copy;
  } catch (err) {
    const status = err.response?.status;
    const retryable = status === 429 || (status >= 500 && status < 600) || err.code === 'ECONNABORTED';
    if (retryable && attempt < 4) {
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`  AI call failed (${status || err.code}), retrying in ${wait / 1000}s...`);
      await sleep(wait);
      return rewriteAsTabloid(article, attempt + 1);
    }
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(detail);
  }
}


// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  if (!TOGETHER_API_KEY) {
    console.error('Missing TOGETHER_API_KEY. Add it to your .env file.');
    process.exit(1);
  }

  // TRACK A (RTÉ) and TRACK B (Dublin Live)
  const newArticles = [];
  for (const feed of FEEDS) {
    newArticles.push(...(await collectFromFeed(feed)));
  }

  if (newArticles.length === 0) {
    console.log('\nNo new articles. Nothing to do.');
    return;
  }

  console.log(`\nSending ${newArticles.length} new article(s) to the AI correspondent...`);

  // THE AI CORRESPONDENT HANDSHAKE + SAVE STATE
  let saved = 0;
  for (const article of newArticles) {
    try {
      const rewritten_copy = await rewriteAsTabloid(article);
      saveArticle({ ...article, rewritten_copy, model: MODEL });
      saved++;
      console.log(`  saved: ${article.source_url}`);
    } catch (err) {
      // Not saved, so it will be retried on the next run.
      console.error(`  rewrite failed for ${article.source_url}: ${err.message}`);
    }
  }

  console.log(`\nDone. ${saved}/${newArticles.length} article(s) rewritten and recorded.`);
  // Add this line to force the terminal to shut down cleanly when running manually:
process.exit(0); 
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});