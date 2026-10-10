const https = require('https');

const FIREBASE_PROJECT_ID = "live--update";
const TELEGRAM_CHANNEL = "CHART_MARKET_MATKA_FIX_DPBOSS";

// ಕೇವಲ ಮುಖ್ಯ ಆಟಗಳು ಮಾತ್ರ VIP
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

async function getExistingDocId(marketName) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/games`;
    const res = await fetchUrl(url, 6000);
    const data = JSON.parse(res);
    if (!data.documents) return null;

    const todayStr = new Date().toISOString().slice(0, 10);
    for (const doc of data.documents) {
      const m = doc.fields && doc.fields.market ? normalizeMarketName(doc.fields.market.stringValue) : "";
      const created = doc.fields && doc.fields.createdAt ? doc.fields.createdAt.timestampValue : "";
      if (m === marketName && created.startsWith(todayStr)) {
        return doc.name;
      }
    }
  } catch (e) {}
  return null;
}

async function saveGameToFirebase(game, existingDocPath) {
  const isUpdate = Boolean(existingDocPath);
  const url = isUpdate 
    ? `https://firestore.googleapis.com/v1/${existingDocPath}`
    : `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/games`;

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
      method: isUpdate ? 'PATCH' : 'POST',
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

    if (messages.length === 0) return;
    const recentMessages = messages.slice(-10);

    for (const msg of recentMessages) {
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

      if (!cleanMarket) continue;
      cleanMarket = cleanMarket.replace(/\bOTC\b/g, '').trim();

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

      if (finalOpen.length === 0 && finalClose.length > 0) finalOpen = [...finalClose];
      if (finalClose.length === 0 && finalOpen.length > 0) finalClose = finalOpen.map(d => ((parseInt(d) + 5) % 10).toString());
      if (finalOpen.length === 0) finalOpen = ["9", "0", "8", "7"];
      if (finalClose.length === 0) finalClose = ["1", "2", "3", "5"];

      let filteredJodis = tgJodis.filter(j => finalOpen.includes(j[0]));
      if (filteredJodis.length < 4) filteredJodis = tgJodis.length > 0 ? tgJodis.slice(0, 8) : [];

      if (filteredJodis.length === 0) {
        finalOpen.forEach(o => {
          finalClose.forEach(c => {
            if (filteredJodis.length < 8) filteredJodis.push(`${o}${c}`);
          });
        });
      }

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

      const existingDocPath = await getExistingDocId(cleanMarket);
      console.log(`⚡ [SYNCING] ${cleanMarket} (${existingDocPath ? 'UPDATING EXISTING' : 'INSERTING NEW'})...`);
      await saveGameToFirebase(payload, existingDocPath);
      console.log(`✅ [SUCCESS] ${cleanMarket} fully saved to Firebase!`);
    }

    console.log("3-Way Scan Completed Successfully.");
  } catch (err) {
    console.error("Fusion engine error:", err);
  }
}

runEngine();
