const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');
const OUTPUT_PATH = path.join(__dirname, 'index.html');

function readDb() {
  if (!fs.existsSync(DB_PATH)) return { local_articles: [], articles: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) { return { local_articles: [], articles: [] }; }
}

function compile() {
  const db = readDb();
  const formattedDate = new Date().toLocaleDateString('en-IE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // 1. GENERATE LOCAL NEWS STREAM
  let localHtml = '';
  const localArticles = db.local_articles || [];
  if (localArticles.length === 0) {
    localHtml = '<div class="empty">No community updates logged today.</div>';
  } else {
    localArticles.forEach(art => {
      let color = '#005689';
      if (art.pillar && art.pillar.includes('1')) color = '#c70000';
      if (art.pillar && art.pillar.includes('2')) color = '#e05e00';
      if (art.pillar && art.pillar.includes('3')) color = '#0084c7';
      if (art.pillar && art.pillar.includes('4')) color = '#7d00b3';

      let media = art.image_url ? '<div class="card-media"><img src="' + art.image_url + '"></div>' : '';
      localHtml += '<div class="card"><div class="badge" style="color:' + color + '">' + (art.pillar || 'LOCAL') + '</div>' + media + '<h2 class="card-headline"><a href="' + (art.source_url || '#') + '" target="_blank">' + (art.one_sentence_summary || 'Update') + '</a></h2><p class="card-body">' + (art.justification || '') + '</p></div>';
    });
  }

  // 2. GENERATE NATIONAL TABLOID SIDEBAR STREAM
  let tabloidHtml = '';
  const nationalArticles = db.articles || [];
  if (nationalArticles.length === 0) {
    tabloidHtml = '<div class="empty">No national briefings logged today.</div>';
  } else {
    nationalArticles.forEach(art => {
      let imgPath = art.image_url || art.image || '';
      let media = imgPath ? '<div class="card-media"><img src="' + imgPath + '"></div>' : '';
      let bodyText = art.content || art.body || art.article_text || '';
      if (bodyText.length > 140) bodyText = bodyText.substring(0, 137) + '...';

      tabloidHtml += '<div class="card"><div class="badge" style="color:var(--pillar-tabloid)">NATIONAL DIGEST</div>' + media + '<h2 class="card-headline"><a href="' + (art.url || '#') + '" target="_blank">' + (art.headline || art.title || 'Tabloid Rumour') + '</a></h2><p class="card-body">' + bodyText + '</p></div>';
    });
  }

  // 3. COMPILE LINKED EXTERNAL STYLE SHEET BASELINE HTML
  let html = '<!DOCTYPE html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The North Dublin Chronicle</title><link rel="stylesheet" href="style.css"></head><body>';
  html += '<div class="masthead"><div class="masthead-inner"><div class="logo">the chronicle</div><div class="masthead-date">' + formattedDate + '</div></div></div>';
  html += '<div class="page"><div class="main-layout-grid">';
  html += '<div class="editorial-lane"><div class="kick-lane"><span class="kick-title">Dublin local</span></div><div class="content-lane"><div class="grid-clip"><div class="grid">' + localHtml + '</div></div></div></div>';
  html += '<div class="sidebar-lane"><div class="kick-lane" style="width:100%;border:none;padding:0 0 12px;"><span class="kick-title tabloid-accent">Tabloid digest</span></div><div class="grid-clip"><div class="sidebar-grid">' + tabloidHtml + '</div></div></div>';
  html += '</div></div></body></html>';

  fs.writeFileSync(OUTPUT_PATH, html, 'utf8');
  console.log('Success! Compiled hybrid media framework cleanly using external style links.');
}
compile();
