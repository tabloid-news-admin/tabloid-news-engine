const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');
const OUTPUT_PATH = path.join(__dirname, 'index.html');

function readDb() {
  if (!fs.existsSync(DB_PATH)) return { local_articles: [], articles: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    return { local_articles: [], articles: [] };
  }
}

// 1. ADVANCED RESPONSIVE GRID CSS BLUETRINT ARRAY
const stylesArray = [
  '@font-face {',
  '  font-family: \'GH Guardian Headline\';',
  '  src: url(\'https://guim.co.uk\') format(\'woff2\');',
  '  font-weight: 300; font-style: normal; font-display: swap;',
  '}',
  '@font-face {',
  '  font-family: \'GH Guardian Headline\';',
  '  src: url(\'https://guim.co.uk\') format(\'woff2\');',
  '  font-weight: 700; font-style: normal; font-display: swap;',
  '}',
  ':root {',
  '  --bg-canvas: #F6F6F6;',
  '  --guardian-blue: #005689;',
  '  --ink: #121212;',
  '  --charcoal: #333333;',
  '  --muted: #666666;',
  '  --hairline: #DCDCDC;',
  '  --pillar-news: #c70000;',
  '  --pillar-tabloid: #7d00b3;',
  '  --serif: \'GH Guardian Headline\', Georgia, serif;',
  '  --sans: system-ui, -apple-system, \'Segoe UI\', Arial, sans-serif;',
  '}',
  '* { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }',
  'html, body { background: var(--bg-canvas); }',
  'body { color: var(--charcoal); font-family: var(--sans); line-height: 1.5; -webkit-font-smoothing: antialiased; }',
  'a { color: inherit; text-decoration: none; }',
  'a:hover { text-decoration: underline; }',
  '.masthead { width: 100%; background: var(--guardian-blue); color: #fff; }',
  '.masthead-inner { max-width: 1400px; margin: 0 auto; padding: 20px 20px 16px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }',
  '.logo { font-family: var(--serif); font-weight: 300 !important; font-size: clamp(3.4rem, 10vw, 4.6rem); line-height: 0.92; letter-spacing: -1.8px; text-transform: lowercase; color: #fff; }',
  '.masthead-date { font-size: 0.85rem; color: rgba(255, 255, 255, 0.85); padding-bottom: 6px; }',
  '.page { max-width: 1400px; margin: 0 auto; padding: 0 20px 24px; }',
  '.main-layout-grid { display: flex; gap: 24px; margin-top: 24px; align-items: stretch; }',
  '.editorial-lane { flex: 1; min-width: 0; display: flex; align-items: stretch; border-top: 1px solid var(--hairline); }',
  '.kick-lane { flex: 0 0 160px; width: 160px; padding: 0 16px 16px 0; border-right: 1px solid var(--hairline); }',
  '.kick-title { display: block; font-family: var(--serif); font-weight: 700 !important; font-size: 1.6rem; line-height: 1.1; letter-spacing: -0.4px; color: var(--ink); border-top: 6px solid var(--guardian-blue); padding-top: 10px; margin-top: -1px; }',
  '.kick-title.tabloid-accent { border-top-color: var(--pillar-tabloid); }',
  '.content-lane { flex: 1; min-width: 0; }',
  '.grid-clip { overflow: hidden; }',
  '.grid { display: grid; grid-template-columns: repeat(3, 1fr); margin-right: -1px; margin-bottom: -1px; }',
  '.sidebar-grid { display: grid; grid-template-columns: 1fr; margin-right: -1px; margin-bottom: -1px; }',
  '.card { background: transparent; border-right: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); padding: 10px 16px 18px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }',
  '.card:first-child { grid-column: span 2; }',
  '.sidebar-lane .card:first-child { grid-column: span 1; }',
  '.badge { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; font-family: var(--sans); font-size: 0.8rem; font-weight: 700; line-height: 1; }',
  '.badge::before { content: \'\'; display: block; width: 20px; height: 3px; background: currentColor; }',
  '.card-media { margin: 2px 0 0; }',
  '.card-media img { display: block; width: 100%; aspect-ratio: 5 / 3; object-fit: cover; background: var(--hairline); }',
  '.card-headline, .card-headline h2, .card-headline a, .card-headline h2 a { font-family: var(--serif) !important; font-weight: 300 !important; font-size: 1.45rem !important; line-height: 1.15 !important; letter-spacing: -0.4px !important; color: var(--ink) !important; }',
  '.card:first-child .card-headline, .card:first-child .card-headline h2, .card:first-child .card-headline a, .card:first-child .card-headline h2 a { font-family: var(--serif) !important; font-weight: 300 !important; font-size: 2.2rem !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }',
  '.sidebar-lane { flex: 0 0 320px; width: 320px; border-top: 1px solid var(--hairline); }',
  '.sidebar-lane .card-headline, .sidebar-lane .card-headline h2, .sidebar-lane .card-headline a, .sidebar-lane .card-headline h2 a { font-size: 1.35rem !important; letter-spacing: -0.3px !important; }',
  '.card-body { font-family: var(--sans); font-size: 0.94rem; line-height: 1.45; color: var(--charcoal); }',
  '.empty { padding: 40px 0; color: var(--muted); }',
  '@media (max-width: 1200px) {',
  '  .main-layout-grid { flex-direction: column; gap: 40px; }',
  '  .sidebar-lane { flex: none; width: 100%; }',
  '  .sidebar-grid { grid-template-columns: repeat(3, 1fr); }',
  '}',
  '@media (max-width: 900px) {',
  '  .grid { grid-template-columns: repeat(2, 1fr); }',
  '  .sidebar-grid { grid-template-columns: repeat(2, 1fr); }',
  '}',
  '@media (max-width: 680px) {',
  '  .editorial-lane { flex-direction: column; }',
  '  .kick-lane { flex: none; width: 100%; padding: 0 0 12px; border-right: none; border-bottom: 1px solid var(--hairline); }',
  '  .grid { grid-template-columns: 1fr; }',
  '  .sidebar-grid { grid-template-columns: 1fr; }',
  '  .card:first-child { grid-column: span 1; }',
  '  .card, .card:first-child { padding-left: 0; padding-right: 0; }',
  '  .card:first-child .card-headline { font-size: 1.9rem; }',
  '}'
];
const CSS = stylesArray.join('\n');

function compile() {
  const db = readDb();
  
  // 2. PARSE LOCAL NEWS DECK
  const localArticles = db.local_articles || [];
  const filteredLocal = localArticles.filter(art => art);
  let localCardsHtml = '';

  if (filteredLocal.length === 0) {
    localCardsHtml = '<div class="empty">No community updates flagged for dispatch today.</div>';
  } else {
    filteredLocal.forEach(art => {
      let colorCode = '#005689'; 
      if (art.pillar && art.pillar.indexOf('1') !== -1) colorCode = '#c70000';
      if (art.pillar && art.pillar.indexOf('2') !== -1) colorCode = '#e05e00';
      if (art.pillar && art.pillar.indexOf('3') !== -1) colorCode = '#0084c7';
      if (art.pillar && art.pillar.indexOf('4') !== -1) colorCode = '#7d00b3';

      let mediaHtml = '';
      if (art.image_url && art.image_url !== '') {
        mediaHtml = '<div class="card-media"><img src="' + art.image_url + '" alt="News Image"></div>';
      }

      const title = art.one_sentence_summary || art.title || 'Local Update';
      const body = art.justification || art.content || '';
      const source = art.source_url || art.url || '#';
      const pillarLabel = art.pillar || 'LOCAL';

      localCardsHtml += '<div class="card">\n' +
                        '  <div class="badge" style="color: ' + colorCode + ';">' + pillarLabel + '</div>\n' +
                        '  ' + mediaHtml + '\n' +
                        '  <h2 class="card-headline"><a href="' + source + '" target="_blank">' + title + '</a></h2>\n' +
                        '  <p class="card-body">' + body + '</p>\n' +
                        '</div>\n';
    });
  }

  // 3. PARSE NATIONAL TABLOID DECK
  const nationalArticles = db.articles || [];
  const filteredNational = nationalArticles.filter(art => art);
  let nationalCardsHtml = '';

  if (filteredNational.length === 0) {
    nationalCardsHtml = '<div class="empty">No tabloid briefings logged today.</div>';
  } else {
    filteredNational.forEach(art => {
      let mediaHtml = '';
      // Support standard scraped images if captured by national engines
      if (art.image_url && art.image_url !== '') {
        mediaHtml = '<div class="card-media"><img src="' + art.image_url + '" alt="Tabloid Image"></div>';
      } else if (art.image && art.image !== '') {
        mediaHtml = '<div class="card-media"><img src="' + art.image + '" alt="Tabloid Image"></div>';
      }

      const title = art.headline || art.title || art.rewritten_title || 'Tabloid Update';
      // Pull shortened snippet body elements for clean sidebar styling scales
      let bodyText = art.content || art.body || art.article_text || '';
      if (bodyText.length > 140) {
        bodyText = bodyText.substring(0, 137) + '...';
      }
      const source = art.url || art.source_url || '#';

      nationalCardsHtml += '<div class="card">\n' +
                           '  <div class="badge" style="color: var(--pillar-tabloid);">NATIONAL RUMOUR</div>\n' +
                           '  ' + mediaHtml + '\n' +
                           '  <h2 class="card-headline"><a href="' + source + '" target="_blank">' + title + '</a></h2>\n' +
                           '  <p class="card-body">' + bodyText + '</p>\n' +
                           '</div>\n';
    });
  }

  const formattedDate = new Date().toLocaleDateString('en-IE', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  });

  // 4. ASSEMBLE COMPLETE HIGH-FIDELITY SIDEBAR HTML DECK
  const htmlOutput = [
    '<!DOCTYPE html>',
    '<html lang="en-IE">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>The North Dublin Chronicle</title>',
    '<style>' + CSS + '</style>',
    '</head>',
    '<body>',
    '  <div class="masthead">',
    '    <div class="masthead-inner">',
'      the chronicle',
'      ' + formattedDate + '',
'    ',
'  ',
'  ',
'  ',
'    ',
'      ',
'      ',
'      ',
'        ',
'          Dublin local',
'        ',
'        ',
'          ',
'            ',
'              ' + localCardsHtml,
'            ',
'          ',
'        ',
'      ',
'      ',
'      ',
'      ',
'        ',
'          Tabloid digest',
'        ',
'        ',
'          ',
'            ' + nationalCardsHtml,
'          ',
'        ',
'      ',
'      ',
'    ',
'  ',
'',
''
];
fs.writeFileSync(OUTPUT_PATH, htmlOutput.join('\n'), 'utf8');
console.log('Success! Expanded broadsheet compiler layout to include responsive national tabloid sidebar.');
}
compile();