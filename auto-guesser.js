const https = require('https');

const FIREBASE_PROJECT_ID = "live--update";
const TELEGRAM_CHANNEL = "CHART_MARKET_MATKA_FIX_DPBOSS";

// ಕೇವಲ ಮುಖ್ಯ ಆಟಗಳು ಮಾತ್ರ VIP (Strict Main Games)
const VIP_MARKETS = [
  "KALYAN",
  "MAIN BAZAR",
  "SRIDEVI",
  "SRI DEVI",
  "RAJDHANI NIGHT",
  "MILAN NIGHT",
  "KALYAN NIGHT",
  "TIME BAZAR"
];

// ಮಾಸ್ಟರ್ ಪ್ಯಾನಾ ಬುಕ್
const MASTER_PANAS = {
  "0": ["127", "136", "145", "235", "389", "479", "569", "578"],
  "1": ["128", "137", "146", "236", "245", "380", "470", "560"],
  "2": ["129", "138", "147", "237", "246", "345", "480", "570"],
  "3": ["120", "139", "148", "238", "247", "346", "490", "580"],
  "4": ["130", "149", "158", "239", "248", "257", "347", "590"],
  "5": ["140", "159", "230", "249", "258", "348", "357", "690"],
  "6": ["150", "169", "240", "259", "349", "358", "457", "790"],
  "7": ["160", "179", "250", "269", "340", "359", "368", "458"],
  "8": ["170", "189", "260", "279", "350", "369", "459", "567"],
  "9": ["180", "199", "270", "289", "360", "379", "450", "568"]
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
}

function cleanText(html) {
  return html.replace(/<br\s*\/?>/gi, '\n')
             .replace(/<[^>]+>/g, ' ')
             .replace(/&nbsp;/gi, ' ')
             .replace(/\s+/g, ' ');
}

// 1. DPBoss ಚಾರ್ಟ್ ಟ್ರೆಂಡ್ ಸ್ಕ್ಯಾನ್
async function fetchChartTrendDigits(marketName) {
  try {
    const formattedName = marketName.toLowerCase().replace(/\s+/g, '-');
    const chartUrl = `https://dpboss.net/${formattedName}-panel-chart.php`;
    const html = await fetchUrl(chartUrl);

    const jodiMatches = html.match(/\b\d{2}\b/g) || [];
    const recentJodis = jodiMatches.slice(-20);

    const digitFrequency = {};
    recentJodis.forEach(jodi => {
      digitFrequency[jodi[0]] = (digitFrequency[jodi[0]] || 0) + 1;
      digitFrequency[jodi[1]] = (digitFrequency[jodi[1]] || 0) + 1;
    });

    return Object.keys(digitFrequency).sort((a, b) => digitFrequency[b] - digitFrequency[a]).slice(0, 4);
  } catch (e) {
    return [];
  }
}

// 2. SattaMatka.mobi ಸ್ಕ್ಯಾನ್
async function fetchWebsiteData() {
  const webData = {};
  try {
    const html = await fetchUrl("https://sattamatka.mobi/");
    const text = cleanText(html);
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach(line => {
      const match = line.match(/([A-Z\s]{3,20}?)\s*(?:OTC|FIX|DTC)?\s*[:\-]?\s*([0-9\s,\-–]{3,25})/i);
      if (match) {
        const market = match[1].trim().toUpperCase().replace(/[^A-Z\s]/g, '');
        const nums = match[2].replace(/[^0-9]/g, ' ').split(/\s+/).filter(Boolean);
        const digits = nums.filter(n => n.length === 1);
        const panas = nums.filter(n => n.length === 3);
        if (market.length >= 3 && digits.length > 0) {
          webData[market] = { digits, panas };
        }
      }
    });
  } catch (e) {
    console.log("Website log:", e.message);
  }
  return webData;
}

// 3. ಇಂದಿನ ಗೇಮ್‌ಗಳನ್ನು ಪರಿಶೀಲಿಸುವುದು (ದಿನಾಂಕ ಆಧಾರಿತ 24 ಗಂಟೆ ಫಿಲ್ಟರ್)
async function getExistingGamesToday() {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/games`;
    const res = await fetchUrl(url);
    const data = JSON.parse(res);
    if (!data.documents) return [];

    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    return data.documents.filter(d => {
      const created = d.fields.createdAt ? d.fields.createdAt.timestampValue : "";
      return created.startsWith(todayStr);
    }).map(d => ({
      market: d.fields.market ? d.fields.market.stringValue.toUpperCase() : ""
    }));
  } catch (e) {
    return [];
  }
}

// 4. Firebase ಗೆ ಸೇರಿಸುವುದು
async function postGameToFirebase(game) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/games`;
  
  const payload = JSON.stringify({
    fields: {
      market: { stringValue: game.market },
      open: { stringValue: game.open },
      close: { stringValue: game.close },
      jodi: { stringValue: game.jodi },
      openPana: { stringValue: game.openPana },
      closePana: { stringValue: game.closePana },
      gameType: { stringValue: game.gameType },
      isPassed: { booleanValue: false },
      createdAt: { timestampValue: new Date().toISOString() }
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 5. ಮುಖ್ಯ ಎಂಜಿನ್
async function runEngine() {
  try {
    console.log("24-Hour Scan Started: Reading Telegram, Website & Charts...");
    const [tgHtml, webData] = await Promise.all([
      fetchUrl(`https://t.me/s/${TELEGRAM_CHANNEL}`),
      fetchWebsiteData()
    ]);

    const msgRegex = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;
    const messages = [];

    while ((match = msgRegex.exec(tgHtml)) !== null) {
      messages.push(match[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
    }

    if (messages.length === 0) return;

    const existingToday = await getExistingGamesToday();
    const recentMessages = messages.slice(-15); // ದಿನದ ಎಲ್ಲಾ ಲೇಟೆಸ್ಟ್ ಪೋಸ್ಟ್‌ಗಳು

    for (const msg of recentMessages) {
      const marketMatch = msg.match(/(?:⚡|\*|\b)([A-Za-z\s]{3,20}?)(?:Day|Night|Morning|Bazar|Market)/i);
      if (!marketMatch) continue;

      const fullMarket = marketMatch[0].replace(/[^A-Za-z\s]/g, '').trim().toUpperCase();

      // ಇವತ್ತು ಆ ಮಾರ್ಕೆಟ್ ಈಗಾಗಲೇ ಪೋಸ್ಟ್ ಆಗಿದ್ದರೆ ಸ್ಕಿಪ್ ಮಾಡಿ
      if (existingToday.some(g => g.market === fullMarket)) continue;

      const lines = msg.split('\n').map(l => l.trim()).filter(Boolean);
      let tgDigits = [];
      let tgJodis = [];
      let tgPanas = [];

      lines.forEach(line => {
        if (line.includes('_') || /^\d(\s*_\s*|\s+)\d/.test(line)) {
          const digits = line.replace(/[^0-9]/g, ' ').split(/\s+/).filter(d => d.length === 1);
          if (digits.length >= 2) tgDigits.push(...digits);
        }
        const jodiMatches = line.match(/\b\d{2}\b/g);
        if (jodiMatches && !line.toLowerCase().includes('date')) tgJodis.push(...jodiMatches);
        const panaMatches = line.match(/\b\d{3}\b/g);
        if (panaMatches) tgPanas.push(...panaMatches);
      });

      if (tgDigits.length === 0 && tgJodis.length === 0) continue;

      // ಚಾರ್ಟ್ ಹಾಗೂ ವೆಬ್‌ಸೈಟ್ ವಿಶ್ಲೇಷಣೆ
      const chartTrendDigits = await fetchChartTrendDigits(fullMarket);
      let matchedWeb = null;
      for (let m in webData) {
        if (fullMarket.includes(m) || m.includes(fullMarket)) {
          matchedWeb = webData[m];
          break;
        }
      }
      const webDigits = matchedWeb ? matchedWeb.digits : [];

      // ಸೂಪರ್ ಸ್ಟ್ರಾಂಗ್ ಅಂಕಿಗಳ ಆಯ್ಕೆ
      let doubleMatch = tgDigits.filter(d => webDigits.includes(d) || chartTrendDigits.includes(d));
      let superDigits = [...new Set([...doubleMatch, ...tgDigits])].slice(0, 3);

      // ಕ್ಲೋಸ್ ಅಂಕಿಗಳು
      let derivedClose = tgJodis.map(j => j[1]);
      let finalCloseDigits = [...new Set([...derivedClose, ...chartTrendDigits, ...webDigits])].slice(0, 4);
      if (finalCloseDigits.length === 0) {
        finalCloseDigits = superDigits.map(d => ((parseInt(d) + 5) % 10).toString());
      }

      // ಜೋಡಿಗಳು
      let filteredJodis = tgJodis.filter(j => superDigits.includes(j[0]));
      if (filteredJodis.length < 4) filteredJodis = tgJodis.slice(0, 6);
      else filteredJodis = filteredJodis.slice(0, 6);

      // ಪ್ಯಾನಾಗಳು
      let finalOpenPanas = [...tgPanas];
      if (finalOpenPanas.length < 3) {
        superDigits.forEach(d => {
          if (MASTER_PANAS[d]) finalOpenPanas.push(...MASTER_PANAS[d].slice(0, 2));
        });
      }
      finalOpenPanas = [...new Set(finalOpenPanas)].slice(0, 3);

      let finalClosePanas = matchedWeb ? [...matchedWeb.panas] : [];
      finalCloseDigits.forEach(d => {
        if (MASTER_PANAS[d]) finalClosePanas.push(...MASTER_PANAS[d].slice(0, 2));
      });
      finalClosePanas = [...new Set(finalClosePanas)].slice(0, 3);

      // ಕೇವಲ ಮುಖ್ಯ ಆಟಗಳು ಮಾತ್ರ VIP, ಉಳಿದೆಲ್ಲವೂ FREE
      const cleanName = fullMarket.replace(/_/g, ' ').trim();
      const isMainGame = VIP_MARKETS.some(m => {
        if (m === "KALYAN" && cleanName.includes("GOLD")) return false;
        return cleanName.includes(m);
      });

      const finalGameType = isMainGame ? "VIP" : "FREE";

      const payload = {
        market: fullMarket,
        open: superDigits.join(' '),
        close: finalCloseDigits.join(' '),
        jodi: filteredJodis.join(' '),
        openPana: finalOpenPanas.join(' '),
        closePana: finalClosePanas.join(' '),
        gameType: finalGameType
      };

      console.log(`Posting ${payload.gameType} game for ${fullMarket}`);
      await postGameToFirebase(payload);
    }
  } catch (err) {
    console.error("Engine run error:", err);
  }
}

runEngine();
