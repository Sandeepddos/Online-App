const https = require('https');

const FIREBASE_PROJECT_ID = "live--update";
const TELEGRAM_CHANNEL = "CHART_MARKET_MATKA_FIX_DPBOSS";

const VIP_MARKETS = [
  "KALYAN", "MAIN BAZAR", "SRIDEVI", "SRI DEVI",
  "SRIDEVI NIGHT", "RAJDHANI NIGHT", "MILAN NIGHT", "KALYAN NIGHT", "TIME BAZAR"
];

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

function fetchUrl(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.on('error', err => reject(err));
  });
}

function cleanText(html) {
  return html.replace(/<br\s*\/?>/gi, '\n')
             .replace(/<[^>]+>/g, ' ')
             .replace(/&nbsp;/gi, ' ')
             .replace(/\s+/g, ' ');
}

function normalizeMarketName(name) {
  return name.replace(/[^A-Za-z]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

async function fetchWebsiteData() {
  const webData = {};
  const urls = ["https://dpboss.net/", "https://sattamatkadpboss.org/"];
  for (const targetUrl of urls) {
    try {
      const html = await fetchUrl(targetUrl, 5000);
      const text = cleanText(html);
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      lines.forEach(line => {
        const match = line.match(/([A-Z\s]{3,20}?)\s*(?:OTC|FIX|DTC)?\s*[:\-]?\s*([0-9\s,\-–]{3,25})/i);
        if (match) {
          const mKey = normalizeMarketName(match[1]);
          const nums = match[2].replace(/[^0-9]/g, ' ').split(/\s+/).filter(Boolean);
          const digits = nums.filter(n => n.length === 1);
          const panas = nums.filter(n => n.length === 3);
          if (mKey.length >= 3 && digits.length > 0) webData[mKey] = { digits, panas };
        }
      });
      if (Object.keys(webData).length > 0) break;
    } catch (e) {}
  }
  return webData;
}

async function getExistingGamesToday() {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/games`;
    const res = await fetchUrl(url, 6000);
    const data = JSON.parse(res);
    if (!data.documents) return [];
    const todayStr = new Date().toISOString().slice(0, 10);
    return data.documents.filter(d => {
      const created = d.fields.createdAt ? d.fields.createdAt.timestampValue : "";
      return created.startsWith(todayStr);
    }).map(d => ({
      market: d.fields.market ? normalizeMarketName(d.fields.market.stringValue) : ""
    }));
  } catch (e) {
    return [];
  }
}

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

async function runEngine() {
  try {
    console.log("🚀 Starting 3-Way Combined Scanner...");
    const [tgHtml, webData] = await Promise.all([
      fetchUrl(`https://t.me/s/${TELEGRAM_CHANNEL}`, 8000),
      fetchWebsiteData()
    ]);

    const msgRegex = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;
    const messages = [];

    while ((match = msgRegex.exec(tgHtml)) !== null) {
      messages.push(match[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
    }

    console.log(`Retrieved ${messages.length} total messages from Telegram.`);
    if (messages.length === 0) return;

    const existingToday = await getExistingGamesToday();
    const recentMessages = messages.slice(-10);

    for (const msg of recentMessages) {
      // 1. ಮಾರ್ಕೆಟ್ ಹೆಸರು ಹುಡುಕುವುದು (ಯಾವುದೇ ಎಮೋಜಿ ಅಥವಾ ವಿನ್ಯಾಸವಿದ್ದರೂ)
      const firstLine = msg.split('\n')[0] || "";
      let cleanMarket = "";

      const knownMarkets = [
        "SRIDEVI NIGHT", "SRIDEVI DAY", "SRIDEVI MORNING", "SRIDEVI",
        "KALYAN NIGHT", "KALYAN", "MAIN BAZAR", "RAJDHANI NIGHT", "MILAN NIGHT",
        "MILAN DAY", "TIME BAZAR", "MADHUR DAY", "MADHUR NIGHT"
      ];

      for (const km of knownMarkets) {
        if (msg.toUpperCase().includes(km)) {
          cleanMarket = km;
          break;
        }
      }

      if (!cleanMarket) {
        const fallbackMatch = firstLine.match(/([A-Z\s]{3,20}?)(?:NIGHT|DAY|MORNING|BAZAR|OTC)/i);
        if (fallbackMatch) cleanMarket = normalizeMarketName(fallbackMatch[0]);
      }

      if (!cleanMarket) continue;
      cleanMarket = cleanMarket.replace(/\bOTC\b/g, '').trim();

      console.log(`Detected Market: "${cleanMarket}"`);

      // ಇಂದಿನ ಪೋಸ್ಟ್ ಆಗಿದ್ದರೆ ಪರಿಶೀಲನೆ
      if (existingToday.some(g => g.market === cleanMarket)) {
        console.log(`Market "${cleanMarket}" already posted today. Skipping.`);
        continue;
      }

      // 2. ಅಂಕಿಗಳನ್ನು ಹೊರತೆಗೆಯುವುದು
      const sanitized = msg.replace(/[•➜➤:\-–|*👑🎯🔥💥⚡🪴🤞🏻]/g, ' ');
      const lines = sanitized.split('\n').map(l => l.trim()).filter(Boolean);

      let tgDigits = [];
      let tgJodis = [];
      let tgPanas = [];

      lines.forEach(line => {
        if (/SINGLE|FIXX|OTC/i.test(line)) {
          const d = line.replace(/[^0-9]/g, ' ').split(/\s+/).filter(n => n.length === 1);
          tgDigits.push(...d);
        }
        const j = line.match(/\b\d{2}\b/g);
        if (j && !line.toLowerCase().includes('date') && !line.toLowerCase().includes('oct')) {
          tgJodis.push(...j);
        }
        const p = line.match(/\b\d{3}\b/g);
        if (p) tgPanas.push(...p);
      });

      if (tgDigits.length === 0) {
        tgDigits = sanitized.replace(/[^0-9]/g, ' ').split(/\s+/).filter(n => n.length === 1).slice(0, 4);
      }

      // 3. ವೆಬ್‌ಸೈಟ್ ಜೊತೆ ಕಂಬೈನ್
      let webDigits = [];
      let webPanas = [];
      for (let wMarket in webData) {
        if (cleanMarket.includes(wMarket) || wMarket.includes(cleanMarket)) {
          webDigits = webData[wMarket].digits;
          webPanas = webData[wMarket].panas;
          break;
        }
      }

      let matchedDigits = tgDigits.filter(d => webDigits.includes(d));
      let finalOpen = [...new Set([...matchedDigits, ...tgDigits, ...webDigits])].slice(0, 4);

      let derivedClose = tgJodis.map(j => j[1]);
      let finalClose = [...new Set([...derivedClose, ...webDigits])].slice(0, 4);
      if (finalClose.length === 0) {
        finalClose = finalOpen.map(d => ((parseInt(d) + 5) % 10).toString());
      }

      let filteredJodis = tgJodis.filter(j => finalOpen.includes(j[0]));
      if (filteredJodis.length < 4) filteredJodis = tgJodis.slice(0, 8);
      else filteredJodis = filteredJodis.slice(0, 8);

      let finalOpenPanas = [...tgPanas.slice(0, 4)];
      if (finalOpenPanas.length < 3) {
        finalOpen.forEach(d => {
          if (MASTER_PANAS[d]) finalOpenPanas.push(...MASTER_PANAS[d].slice(0, 2));
        });
      }
      finalOpenPanas = [...new Set(finalOpenPanas)].slice(0, 4);

      let finalClosePanas = [...tgPanas.slice(4, 8), ...webPanas];
      finalClose.forEach(d => {
        if (MASTER_PANAS[d]) finalClosePanas.push(...MASTER_PANAS[d].slice(0, 2));
      });
      finalClosePanas = [...new Set(finalClosePanas)].slice(0, 4);

      const isMainGame = VIP_MARKETS.some(m => cleanMarket.includes(m));
      const finalGameType = isMainGame ? "VIP" : "FREE";

      const payload = {
        market: cleanMarket,
        open: finalOpen.join(' '),
        close: finalClose.join(' '),
        jodi: filteredJodis.join(' '),
        openPana: finalOpenPanas.join(' '),
        closePana: finalClosePanas.join(' '),
        gameType: finalGameType
      };

      console.log(`✅ [POSTING TO FIREBASE] ${payload.gameType} -> ${cleanMarket}:`, payload);
      await postGameToFirebase(payload);
    }

    console.log("3-Way Scan Completed Successfully.");
  } catch (err) {
    console.error("Fusion engine error:", err);
  }
}

runEngine();
