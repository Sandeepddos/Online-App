const https = require('https');

const FIREBASE_PROJECT_ID = "live--update";
const TELEGRAM_CHANNEL = "CHART_MARKET_MATKA_FIX_DPBOSS";

// ಕೇವಲ ಮುಖ್ಯ ಆಟಗಳು ಮಾತ್ರ VIP
const VIP_MARKETS = [
  "KALYAN",
  "MAIN BAZAR",
  "SRIDEVI",
  "SRI DEVI",
  "SRIDEVI NIGHT",
  "RAJDHANI NIGHT",
  "MILAN NIGHT",
  "KALYAN NIGHT",
  "TIME BAZAR"
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, timeoutMs));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });

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

async function fetchChartTrendDigits(normalizedMarket) {
  try {
    const slug = normalizedMarket.toLowerCase().replace(/\s+/g, '-');
    const chartUrl = `https://dpboss.net/${slug}-panel-chart.php`;
    const html = await fetchUrl(chartUrl, 5000);

    const jodiMatches = html.match(/\b\d{2}\b/g) || [];
    if (jodiMatches.length === 0) return [];

    const recentJodis = jodiMatches.slice(-30);
    const counts = {};
    recentJodis.forEach(jodi => {
      counts[jodi[0]] = (counts[jodi[0]] || 0) + 1;
      counts[jodi[1]] = (counts[jodi[1]] || 0) + 1;
    });

    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 4);
  } catch (e) {
    return [];
  }
}

async function fetchWebsiteData() {
  const webData = {};
  const urls = ["https://dpboss.net/", "https://sattamatkadpboss.org/"];

  for (const targetUrl of urls) {
    try {
      const html = await fetchUrl(targetUrl, 6000);
      const text = cleanText(html);
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      
      lines.forEach(line => {
        const match = line.match(/([A-Z\s]{3,20}?)\s*(?:OTC|FIX|DTC)?\s*[:\-]?\s*([0-9\s,\-–]{3,25})/i);
        if (match) {
          const mKey = normalizeMarketName(match[1]);
          const nums = match[2].replace(/[^0-9]/g, ' ').split(/\s+/).filter(Boolean);
          const digits = nums.filter(n => n.length === 1);
          const panas = nums.filter(n => n.length === 3);
          if (mKey.length >= 3 && digits.length > 0) {
            webData[mKey] = { digits, panas };
          }
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

    if (messages.length === 0) return;

    const existingToday = await getExistingGamesToday();
    const recentMessages = messages.slice(-15);

    for (const msg of recentMessages) {
      // ಮಾರ್ಕೆಟ್ ಹೆಸರಿನಲ್ಲಿ ಬರುವ ಎಮೋಜಿಗಳನ್ನು ತೆಗೆದು ನೇರವಾಗಿ ಹೆಸರನ್ನು ಕಂಡುಹಿಡಿಯುವ ಸುಧಾರಿತ ರೆಜೆಕ್ಸ್
      const marketMatch = msg.match(/(?:👑|⚡|\*|🎯|\b)([A-Za-z\s]{3,20}?)(?:NIGHT|DAY|MORNING|BAZAR|OTC)/i);
      if (!marketMatch) continue;

      let cleanMarket = normalizeMarketName(marketMatch[0]);
      cleanMarket = cleanMarket.replace(/\bOTC\b/g, '').trim();

      if (cleanMarket.length < 3) continue;

      if (existingToday.some(g => g.market === cleanMarket)) {
        continue;
      }

      // ಟೆಲಿಗ್ರಾಂನ ವಿಶೇಷ ಚಿಹ್ನೆಗಳನ್ನು (•, ➜, ➤) ಸ್ಪೇಸ್‌ಗಳಾಗಿ ಬದಲಾಯಿಸಿ ಸಂಖ್ಯೆಗಳನ್ನು ಪ್ರತ್ಯೇಕಿಸುವುದು
      const sanitizedText = msg.replace(/[•➜➤:\-–|*👑🎯🔥💥⚡]/g, ' ');
      const lines = sanitizedText.split('\n').map(l => l.trim()).filter(Boolean);

      let tgDigits = [];
      let tgJodis = [];
      let tgPanas = [];

      lines.forEach(line => {
        // ಸಿಂಗಲ್ ಅಂಕಿಗಳನ್ನು (SINGLE, OTC, FIXX) ಓದುವುದು
        if (/SINGLE|FIXX|OTC/i.test(line)) {
          const digits = line.replace(/[^0-9]/g, ' ').split(/\s+/).filter(d => d.length === 1);
          tgDigits.push(...digits);
        }
        
        // ಜೋಡಿಗಳನ್ನು ಗುರುತಿಸುವುದು
        const jodis = line.match(/\b\d{2}\b/g);
        if (jodis && !line.toLowerCase().includes('date') && !line.toLowerCase().includes('oct')) {
          tgJodis.push(...jodis);
        }

        // ಪ್ಯಾನಾಗಳನ್ನು (PENAL ಅಥವಾ PANA) ಗುರುತಿಸುವುದು
        const panas = line.match(/\b\d{3}\b/g);
        if (panas) {
          tgPanas.push(...panas);
        }
      });

      // ಸಾಲುಗಳಲ್ಲಿ ಸಿಗದಿದ್ದರೆ ಸಂಪೂರ್ಣ ಮೆಸೇಜ್‌ನಿಂದ ಒಮ್ಮೆ ಕ್ರಾಸ್-ಚೆಕ್
      if (tgDigits.length === 0) {
        const fallbackDigits = sanitizedText.replace(/[^0-9]/g, ' ').split(/\s+/).filter(d => d.length === 1);
        tgDigits.push(...fallbackDigits.slice(0, 4));
      }

      if (tgDigits.length === 0 && tgJodis.length === 0) continue;

      // ವೆಬ್‌ಸೈಟ್ ಮತ್ತು DPBoss ಚಾರ್ಟ್ ಮ್ಯಾಚಿಂಗ್
      let webDigits = [];
      let webPanas = [];
      for (let wMarket in webData) {
        if (cleanMarket.includes(wMarket) || wMarket.includes(cleanMarket)) {
          webDigits = webData[wMarket].digits;
          webPanas = webData[wMarket].panas;
          break;
        }
      }

      const chartDigits = await fetchChartTrendDigits(cleanMarket);

      // 3-ವೇ ಕಂಬೈನ್ ಲಾಜಿಕ್
      let matchedDigits = tgDigits.filter(d => webDigits.includes(d) || chartDigits.includes(d));
      let finalOpen = [...new Set([...matchedDigits, ...tgDigits, ...webDigits])].slice(0, 4);

      let derivedClose = tgJodis.map(j => j[1]);
      let finalClose = [...new Set([...derivedClose, ...chartDigits, ...webDigits])].slice(0, 4);
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

      // VIP ಅಥವಾ FREE
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

      console.log(`✅ [POSTED ${payload.gameType}] ${cleanMarket}:`, payload);
      await postGameToFirebase(payload);
    }

    console.log("3-Way Scan Completed Successfully.");

  } catch (err) {
    console.error("Fusion engine error:", err);
  }
}

runEngine();
