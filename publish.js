const fs = require('fs');

function generateGuardianStylePaper() {
  if (!fs.existsSync('database.json')) {
    console.log("Error: database.json ledger not found.");
    return;
  }

  const rawData = JSON.parse(fs.readFileSync('database.json', 'utf8'));
  
  // Isolate our approved local North Dublin streams
  const localArticles = rawData.local_articles || [];
  
  // Isolate our screaming national tabloid updates if present
  const nationalArticles = Array.isArray(rawData) ? rawData : (rawData.articles || []);

  // Filter local items to ensure only approved newsworthy rows print out
  const filteredLocal = localArticles.filter(art => art && art.is_newsworthy);

  let htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The North Dublin Chronicle</title>
    <!-- Importing high-end Guardian-replica serif and sans-serif Google web fonts -->
    <link href="https://googleapis.com" rel="stylesheet">
    <style>
      :root {
        --guardian-blue: #005689;
        --guardian-dark-blue: #09314f;
        --pillar-news: #c70000;
        --pillar-events: #e05e00;
        --pillar-sports: #0084c7;
        --pillar-education: #7d00b3;
        --bg-cream: #f6f6f6;
        --text-dark: #121212;
        --border-gray: #dfdfdf;
      }
      
      body {
        font-family: 'Open Sans', sans-serif;
        background-color: var(--bg-cream);
        color: var(--text-dark);
        margin: 0;
        padding: 0;
      }

      /* Masthead Styling replicating The Guardian layout structure */
      header {
        background-color: var(--guardian-blue);
        color: white;
        padding: 20px 40px;
        border-bottom: 5px solid var(--guardian-dark-blue);
      }
      
      .logo-area {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
      }
      
      header h1 {
        font-family: 'Lora', serif;
        font-size: 2.8rem;
        font-weight: 700;
        margin: 0;
        letter-spacing: -1px;
      }
      
      .date-badge {
        font-family: 'Open Sans', sans-serif;
        font-size: 0.9rem;
        font-weight: 600;
        opacity: 0.9;
      }

      .main-container {
        max-width: 1300px;
        margin: 0 auto;
        padding: 30px 20px;
      }

      .section-heading {
        font-family: 'Lora', serif;
        font-size: 1.6rem;
        font-weight: 700;
        color: var(--guardian-blue);
        border-bottom: 2px solid var(--guardian-blue);
        padding-bottom: 5px;
        margin-top: 40px;
        margin-bottom: 20px;
      }

      /* Asymmetrical 3-Column Newspaper Grid Layout Layout */
      .news-grid {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr;
        gap: 24px;
      }

      @media (max-width: 900px) {
        .news-grid { grid-template-columns: 1fr; }
      }

      /* Card layouts carrying structural lines and top category headers */
      .article-card {
        background: white;
        border-top: 4px solid var(--guardian-blue);
        padding: 15px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }

      /* Assigning dynamic colors to your 5 local news pillars */
      .article-card.news-pillar { border-top-color: var(--pillar-news); }
      .article-card.events-pillar { border-top-color: var(--pillar-events); }
      .article-card.sports-pillar { border-top-color: var(--pillar-sports); }
      .article-card.education-pillar { border-top-color: var(--pillar-education); }
      
      .pillar-badge {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 8px;
        color: var(--guardian-blue);
      }
      
      .news-pillar .pillar-badge { color: var(--pillar-news); }
      .events-pillar .pillar-badge { color: var(--pillar-events); }
      .sports-pillar .pillar-badge { color: var(--pillar-sports); }
      .education-pillar .pillar-badge { color: var(--pillar-education); }

      .article-title {
        font-family: 'Lora', serif;
        font-size: 1.4rem;
        font-weight: 700;
        line-height: 1.25;
        margin: 0 0 12px 0;
        color: #000;
      }

      /* Lead story spans wider and has larger font sizing specs */
      .news-grid .article-card:first-child {
        grid-column: span 1;
        background: #fff;
      }
      
      .news-grid .article-card:first-child .article-title {
        font-size: 1.9rem;
      }

      .article-body {
        font-size: 0.95rem;
        line-height: 1.55;
        color: #333;
        margin-bottom: 15px;
      }

      .meta-footer {
        border-top: 1px solid var(--border-gray);
        padding-top: 10px;
        font-size: 0.8rem;
        color: #666;
        display: flex;
        justify-content: space-between;
      }
      
      .meta-footer a {
        color: var(--guardian-blue);
        text-decoration: none;
        font-weight: 600;
      }
    </style>
  </head>
  <body>

    <header>
      <div class="logo-area">
        <h1>the north dublin chronicle</h1>
        <div class="date-badge">${new Date().toLocaleDateString('en-IE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>
    </header>

    <div class="main-container">
      
      <div class="section-heading">Ballymun, Finglas & Glasnevin Community Monitor</div>
      
      <div class="news-grid">
  `;

  // Inject our approved newsworthy local JSON items straight into the DOM grid template
  if (filteredLocal.length === 0) {
    htmlContent += `
      <div class="article-card" style="grid-column: span 3; text-align: center; padding: 40px;">
        <h2 class="article-title" style="font-style: italic;">No community updates flagged for dispatch today.</h2>
        <p class="article-body">The infrastructure filters are currently monitoring live RSS and social feeds waiting for newsworthy zoning entries.</p>
      </div>
    `;
  } else {
       filteredLocal.forEach(art => {
      let pClass = "news-pillar";
      if (art.pillar.includes("2")) pClass = "events-pillar";
      if (art.pillar.includes("3")) pClass = "sports-pillar";
      if (art.pillar.includes("4")) pClass = "education-pillar";

      // 🚨 IMAGE EXTRACTION INJECTION START
      let imageElement = '';
      if (art.image_url && art.image_url !== '') {
        imageElement = `<img src="${art.image_url}" style="width: 100%; height: 200px; object-fit: cover; margin-bottom: 12px; border-bottom: 1px solid var(--border-gray);" alt="Local News Image">`;
      }
      // 🚨 IMAGE EXTRACTION INJECTION END

      htmlContent += `
        <div class="article-card ${pClass}">
          <div>
            <div class="pillar-badge">${art.pillar}</div>
            ${imageElement} <!-- Injects the captured source image right here -->
            <h2 class="article-title">${art.one_sentence_summary}</h2>
            <p class="article-body">${art.justification}</p>
          </div>
          <div class="meta-footer">
            <span>Focus: <strong>${art.entities_mentioned.join(', ') || 'Local area'}</strong></span>
            <a href="${art.source_url || '#'}" target="_blank">View Source →</a>
          </div>
        </div>
      `;
    });
  }

  htmlContent += `
      </div>
    </div>
  </body>
  </html>
  `;


  fs.writeFileSync('index.html', htmlContent);
  console.log("Success! Generated 'index.html' with full Guardian typography styling layout specs.");
}

generateGuardianStylePaper();
