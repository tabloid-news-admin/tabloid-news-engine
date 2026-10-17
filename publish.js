// publish.js
// Compiles database.json into a flat, Guardian-style broadsheet at index.html
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');
const OUT_PATH = path.join(__dirname, 'index.html');

const SITE_NAME = 'The Tabloid';
const MAX_LOCAL = 40;
const MAX_NATIONAL = 24;

// ---------- Helpers ----------
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Field names vary between engines, so take the first one that exists.
// Adjust these lists if your database objects use different keys.
const pick = (obj, keys) => {
  for (const k of keys) if (obj && obj[k]) return obj[k];
  return '';
};
const getHeadline = (a) => pick(a, ['headline', 'title', 'rewritten_title']);
const getBody = (a) => pick(a, ['body', 'summary', 'standfirst', 'rewritten', 'content']);
const getPillar = (a) => pick(a, ['pillar', 'category']) || 'News';
const getLink = (a) => pick(a, ['source_url', 'url', 'link']);
const getTime = (a) => Date.parse(pick(a, ['processed_at', 'published_at', 'date'])) || 0;

// Map any pillar name onto the three palette colours.
function pillarClass(name) {
  const n = String(name).toLowerCase();
  if (/sport|gaa|football|rugby|soccer|athletic/.test(n)) return 'sports';
  if (/event|communit|culture|what.?s on|arts|entertain|life/.test(n)) return 'events';
  return 'news';
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-IE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ---------- Card template ----------
function renderCard(art, index, { lead = false } = {}) {
  const headline = getHeadline(art);
  const body = getBody(art);
  const pillar = getPillar(art);
  const link = getLink(art);
  const cls = pillarClass(pillar);

  // Image block only when image_url is present
  const imgBlock = art.image_url
    ? `<figure class="card-media"><img src="${esc(art.image_url)}" alt="${esc(headline)}" loading="lazy"></figure>`
    : '';

  const headlineHtml = link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(headline)}</a>`
    : esc(headline);

  return `
    <article class="card${lead ? ' card-lead' : ''}">
      <span class="badge badge-${cls}">${esc(pillar)}</span>
      <h2 class="card-headline">${headlineHtml}</h2>
      ${imgBlock}
      ${body ? `<p class="card-body">${esc(body)}</p>` : ''}
    </article>`;
}

function renderSection(title, items) {
  if (!items.length) return '';
  return `
    <section class="section">
      <h3 class="section-title">${esc(title)}</h3>
      <div class="grid-clip">
        <div class="grid">
          ${items.map((a, i) => renderCard(a, i, { lead: i === 0 })).join('\n')}
        </div>
      </div>
    </section>`;
}

// ---------- CSS ----------
const CSS = `
:root {
  --bg-canvas: #f6f6f6;
  --guardian-blue: #005689;
  --text-headline: #121212;
  --line-hairline: #dcdcdc;
  --pillar-news: #c70000;
  --pillar-events: #e05e00;
  --pillar-sports: #0084c7;
  --text-body: #333333;
  --text-muted: #666666;
}
* { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
html { background: var(--bg-canvas); }
body {
  background: var(--bg-canvas);
  color: var(--text-body);
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1.5;
}
a { color: inherit; text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--guardian-blue); outline-offset: 2px; }

/* Masthead */
.masthead { background: var(--guardian-blue); color: #ffffff; }
.masthead-inner {
  max-width: 1300px;
  margin: 0 auto;
  padding: 18px 20px 14px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.logo {
  font-family: 'Lora', Georgia, 'Times New Roman', serif;
  font-weight: 700;
  font-size: clamp(2.6rem, 7vw, 4.6rem);
  line-height: 0.95;
  letter-spacing: -1px;
  color: #ffffff;
}
.masthead-date {
  font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.85);
  padding-bottom: 6px;
}
.masthead-rule { border-top: 1px solid rgba(255, 255, 255, 0.3); }

/* Page frame: flat continuous canvas */
.page { max-width: 1300px; margin: 0 auto; padding: 0 20px 40px; }
.section { padding-top: 22px; }
.section-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--guardian-blue);
  letter-spacing: -0.3px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line-hairline);
}

/* Hairline grid: separation by borders only */
.grid-clip { overflow: hidden; }
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-right: -1px;   /* hides the trailing right hairline */
  margin-bottom: -1px;  /* hides the trailing bottom hairline */
}
.card {
  background: transparent;
  padding: 14px 16px 18px;
  border-right: 1px solid var(--line-hairline);
  border-bottom: 1px solid var(--line-hairline);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.card:first-child { padding-left: 0; }
.card-lead { grid-column: span 2; }

/* Pillar badges: short colour rule + coloured label */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1;
}
.badge::before { content: ''; display: block; width: 22px; height: 3px; background: currentColor; }
.badge-news { color: var(--pillar-news); }
.badge-events { color: var(--pillar-events); }
.badge-sports { color: var(--pillar-sports); }

/* Headlines: directly under the badge, tight and heavy */
.card-headline {
  font-family: 'Lora', Georgia, 'Times New Roman', serif;
  font-weight: 700;
  font-size: 1.4rem;
  line-height: 1.15;
  letter-spacing: -0.2px;
  color: var(--text-headline);
}
.card-lead .card-headline { font-size: 2.1rem; letter-spacing: -0.5px; }

.card-media { margin-top: 4px; }
.card-media img {
  display: block;
  width: 100%;
  aspect-ratio: 5 / 3;
  object-fit: cover;
  background: var(--line-hairline);
}
.card-body { font-size: 0.98rem; line-height: 1.45; color: var(--text-body); }

.footer {
  max-width: 1300px;
  margin: 0 auto;
  padding: 16px 20px 40px;
  border-top: 1px solid var(--line-hairline);
  font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.empty { padding: 40px 0; color: var(--text-muted); }

@media (max-width: 1000px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
  .card-lead { grid-column: span 2; }
}
@media (max-width: 620px) {
  .grid { grid-template-columns: 1fr; }
  .card-lead { grid-column: span 1; }
  .card, .card:first-child { padding-left: 0; padding-right: 0; }
  .card-lead .card-headline { font-size: 1.7rem; }
}
`;

// ---------- Build ----------
function build() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('database.json not found.');
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const byNewest = (a, b) => getTime(b) - getTime(a);

  const filteredLocal = (db.local_articles || [])
    .filter((a) => getHeadline(a))
    .sort(byNewest)
    .slice(0, MAX_LOCAL);

  const national = (db.articles || [])
    .filter((a) => getHeadline(a))
    .sort(byNewest)
    .slice(0, MAX_NATIONAL);

  // Local cards are rendered through the same template, so image_url shows only when present
  const localSection = renderSection('Dublin local', filteredLocal);
  const nationalSection = renderSection('National', national);

  const html = `<!DOCTYPE html>
<html lang="en-IE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(SITE_NAME)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<header class="masthead">
  <div class="masthead-inner">
    <div class="logo">${esc(SITE_NAME)}</div>
    <div class="masthead-date">${esc(formatDate())}</div>
  </div>
  <div class="masthead-rule"></div>
</header>
<main class="page">
  ${localSection}
  ${nationalSection}
  ${!localSection && !nationalSection ? '<p class="empty">No stories yet. Run engine.js or local_engine.js, then publish again.</p>' : ''}
</main>
<footer class="footer">Last compiled ${esc(new Date().toLocaleString('en-IE'))}</footer>
</body>
</html>`;

  fs.writeFileSync(OUT_PATH, html, 'utf8');
  console.log(`Published index.html: ${filteredLocal.length} local, ${national.length} national.`);
  process.exit(0);
}

build();