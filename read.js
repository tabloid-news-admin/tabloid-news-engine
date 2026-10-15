const fs = require('fs');

if (fs.existsSync('database.json')) {
    const rawData = JSON.parse(fs.readFileSync('database.json', 'utf8'));
    const articles = Array.isArray(rawData) ? rawData : (rawData.articles || Object.values(rawData));
    
    if (!Array.isArray(articles)) {
        console.log("Could not find a valid list of articles inside database.json.");
        process.exit(1);
    }

    let outputText = "=== MY AUTOMATED TABLOID NEWSPAPER ===\n\n";
    
    articles.forEach((article, index) => {
        if (!article) return;
        
        const title = article.title || "Untitled Story";
        const url = article.source_url || article.url || "No URL source";
        
        // Target the exact parameter we know holds your working text
        let text = article.rewritten_copy || article.aiContent || article.content || "No content generated";

        outputText += `📰 STORY ${index + 1}: ${title.toUpperCase()}\n`;
        outputText += `🔗 Source: ${url}\n\n`;
        outputText += `${text}\n`; // The formatted text wraps here
        outputText += `\n==================================================\n\n`;
    });
    
    fs.writeFileSync('newspaper.txt', outputText);
    console.log("Success! Open 'newspaper.txt' in your sidebar to read your clean articles.");
} else {
    console.log("No database.json file found yet.");
}
