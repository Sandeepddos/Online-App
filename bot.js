const https = require('https');

const FIREBASE_PROJECT_ID = "live--update";
const ONESIGNAL_APP_ID = "63d76378-c0b7-4950-af4d-25eb0be82845";
const ONESIGNAL_REST_KEY = process.env.ONESIGNAL_KEY || "";

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
    req.on('error', reject);
  });
}

function cleanMarketName(str) {
  return str.replace(/[^A-Za-z]/g, '').toUpperCase();
}

// 2 ಮೂಲಗಳಿಂದ ಏಕಕಾಲದಲ್ಲಿ ರಿಸಲ್ಟ್ ತರುವುದು (Multi-Source Live Fetch)
async function fetchAllLiveResults() {
  const results = {};
  const urls = [
    "https://dpboss.net/",
    "https://sattamatkadpboss.org/"
  ];

  for (const url of urls) {
    try {
      const html = await fetchUrl(url, 6000);
      const regex = /([A-Za-z\s]{3,25})\s*[:\-]?\s*([0-9]{3})\s*-\s*([0-9]{2})\s*-\s*([0-9]{3})/gi;
      let m;
      while ((m = regex.exec(html)) !== null) {
        const cleanName = cleanMarketName(m[1]);
        if (!results[cleanName]) {
          results[cleanName] = {
            rawName: m[1].trim(),
            openPana: m[2],
            openDigit: m[3][0],
            closeDigit: m[3][1],
            closePana: m[4],
            jodi: m[3]
          };
        }
      }

      // ಹಾಫ್ ರಿಸಲ್ಟ್ (Open ಮಾತ್ರ ಬಂದಾಗ: 123-4 or 123-4*)
      const halfRegex = /([A-Za-z\s]{3,25})\s*[:\-]?\s*([0-9]{3})\s*-\s*([0-9]{1})\s*[-*]/gi;
      let hm;
      while ((hm = halfRegex.exec(html)) !== null) {
        const cleanName = cleanMarketName(hm[1]);
        if (!results[cleanName]) {
          results[cleanName] = {
            rawName: hm[1].trim(),
            openPana: hm[2],
            openDigit: hm[3],
            closeDigit: null,
            closePana: null,
            jodi: null
          };
        }
      }
    } catch (e) {}
  }
  return results;
}

async function getFirebaseGames() {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/games`;
    const res = await fetchUrl(url, 6000);
    const data = JSON.parse(res);
    if (!data.documents) return [];

    return data.documents.map(doc => ({
      docPath: doc.name,
      market: doc.fields.market ? doc.fields.market.stringValue : "",
      open: doc.fields.open ? doc.fields.open.stringValue : "",
      close: doc.fields.close ? doc.fields.close.stringValue : "",
      jodi: doc.fields.jodi ? doc.fields.jodi.stringValue : "",
      openPana: doc.fields.openPana ? doc.fields.openPana.stringValue : "",
      closePana: doc.fields.closePana ? doc.fields.closePana.stringValue : "",
      isPassed: doc.fields.isPassed ? doc.fields.isPassed.booleanValue : false,
      passMessage: doc.fields.passMessage ? doc.fields.passMessage.stringValue : ""
    }));
  } catch (e) {
    return [];
  }
}

async function updateGamePassStatus(docPath, passMessage) {
  const url = `https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=isPassed&updateMask.fieldPaths=passMessage`;
  const payload = JSON.stringify({
    fields: {
      isPassed: { booleanValue: true },
      passMessage: { stringValue: passMessage }
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'PATCH',
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

async function sendNotification(title, message) {
  if (!ONESIGNAL_REST_KEY) return;
  const payload = JSON.stringify({
    app_id: ONESIGNAL_APP_ID,
    included_segments: ["All"],
    headings: { en: title },
    contents: { en: message }
  });

  return new Promise((resolve) => {
    const req = https.request('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_KEY}`
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

async function checkResultsEngine() {
  console.log("🔍 Checking Live Results from Multi-Sources...");
  const [liveResults, games] = await Promise.all([
    fetchAllLiveResults(),
    getFirebaseGames()
  ]);

  console.log(`Found ${Object.keys(liveResults).length} live results in markets.`);

  for (const game of games) {
    if (game.isPassed) continue; // ಈಗಾಗಲೇ ಪಾಸ್ ಆಗಿದ್ದರೆ ಬಿಡುವುದು

    const targetClean = cleanMarketName(game.market);
    let matchedResult = null;

    // ಸುಲಭವಾಗಿ ಹೆಸರು ಮ್ಯಾಚ್ ಮಾಡುವ ಲಾಜಿಕ್
    for (const key in liveResults) {
      if (key.includes(targetClean) || targetClean.includes(key)) {
        matchedResult = liveResults[key];
        break;
      }
    }

    if (!matchedResult) continue;

    const userOpens = game.open.split(/\s+/);
    const userCloses = game.close.split(/\s+/);
    const userJodis = game.jodi.split(/\s+/);
    const userOpenPanas = game.openPana.split(/\s+/);
    const userClosePanas = game.closePana.split(/\s+/);

    let passType = "";

    // 1. Jodi Pass
    if (matchedResult.jodi && userJodis.includes(matchedResult.jodi)) {
      passType = `🔥 JODI BLAST [${matchedResult.jodi}]`;
    }
    // 2. Open Pana Pass
    else if (matchedResult.openPana && userOpenPanas.includes(matchedResult.openPana)) {
      passType = `💥 OPEN PANA BLAST [${matchedResult.openPana}]`;
    }
    // 3. Close Pana Pass
    else if (matchedResult.closePana && userClosePanas.includes(matchedResult.closePana)) {
      passType = `💥 CLOSE PANA BLAST [${matchedResult.closePana}]`;
    }
    // 4. Open Single Digit Pass
    else if (matchedResult.openDigit && userOpens.includes(matchedResult.openDigit)) {
      passType = `✔ OPEN BLAST [${matchedResult.openDigit}]`;
    }
    // 5. Close Single Digit Pass
    else if (matchedResult.closeDigit && userCloses.includes(matchedResult.closeDigit)) {
      passType = `✔ CLOSE BLAST [${matchedResult.closeDigit}]`;
    }

    if (passType) {
      console.log(`🎉 MATCH FOUND! ${game.market} -> ${passType}`);
      await updateGamePassStatus(game.docPath, passType);
      await sendNotification(`💥 ${game.market} PASS BLAST!`, `${game.market} ನಲ್ಲಿ ${passType} ಯಶಸ್ವಿಯಾಗಿ ಪಾಸ್ ಆಗಿದೆ!`);
    }
  }

  console.log("Result Checker completed successfully.");
}

checkResultsEngine();
