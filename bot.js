const https = require('https');

const FIREBASE_PROJECT_ID = "live--update";
const ONESIGNAL_APP_ID = "39ffebaf-3ca2-445a-b1e9-04a9732357d9";
// ಹೆಡರ್ ಕ್ಯಾರೆಕ್ಟರ್ ಎರರ್ ಬರದಂತೆ ಸ್ಪೇಸ್ ಮತ್ತು ನ್ಯೂಲೈನ್‌ಗಳನ್ನು ಕ್ಲೀನ್ ಮಾಡುವುದು
const ONESIGNAL_REST_KEY = (process.env.ONESIGNAL_KEY || "").replace(/[\r\n\t\s]/g, '');

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
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.on('error', reject);
  });
}

function cleanMarketName(str) {
  return str.replace(/[^A-Za-z]/g, '').toUpperCase();
}

function stripHtml(html) {
  return html.replace(/<br\s*\/?>/gi, '\n')
             .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|td)>/gi, '\n')
             .replace(/<[^>]+>/g, ' ')
             .replace(/&nbsp;/gi, ' ')
             .replace(/\r/g, '');
}

async function fetchAllLiveResults() {
  const results = {};
  const urls = [
    "https://dpboss.net/",
    "https://sattamatkadpboss.org/"
  ];

  for (const url of urls) {
    try {
      const html = await fetchUrl(url, 6000);
      const text = stripHtml(html);
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1. KALYAN 123-45-678
        const fullMatch = line.match(/^([A-Za-z\s]{3,25}?)\s*[:\-]?\s*(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{3})/i);
        if (fullMatch) {
          const cleanName = cleanMarketName(fullMatch[1]);
          if (cleanName.length >= 3 && !results[cleanName]) {
            results[cleanName] = {
              rawName: fullMatch[1].trim(),
              openPana: fullMatch[2],
              openDigit: fullMatch[3][0],
              closeDigit: fullMatch[3][1],
              closePana: fullMatch[4],
              jodi: fullMatch[3]
            };
          }
          continue;
        }

        // 2. KALYAN 123-4
        const halfMatch = line.match(/^([A-Za-z\s]{3,25}?)\s*[:\-]?\s*(\d{3})\s*-\s*(\d{1})(?:[*\-]?)/i);
        if (halfMatch) {
          const cleanName = cleanMarketName(halfMatch[1]);
          if (cleanName.length >= 3 && !results[cleanName]) {
            results[cleanName] = {
              rawName: halfMatch[1].trim(),
              openPana: halfMatch[2],
              openDigit: halfMatch[3],
              closeDigit: null,
              closePana: null,
              jodi: null
            };
          }
          continue;
        }

        // 3. ಮಲ್ಟಿ ಲೈನ್ ರಿಸಲ್ಟ್
        const numOnlyFull = line.match(/^(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{3})$/);
        if (numOnlyFull && i > 0) {
          const prevLine = lines[i - 1];
          if (/^[A-Za-z\s]{3,25}$/.test(prevLine)) {
            const cleanName = cleanMarketName(prevLine);
            if (cleanName.length >= 3 && !results[cleanName]) {
              results[cleanName] = {
                rawName: prevLine.trim(),
                openPana: numOnlyFull[1],
                openDigit: numOnlyFull[2][0],
                closeDigit: numOnlyFull[2][1],
                closePana: numOnlyFull[3],
                jodi: numOnlyFull[2]
              };
            }
          }
          continue;
        }

        const numOnlyHalf = line.match(/^(\d{3})\s*-\s*(\d{1})[*\-]?$/);
        if (numOnlyHalf && i > 0) {
          const prevLine = lines[i - 1];
          if (/^[A-Za-z\s]{3,25}$/.test(prevLine)) {
            const cleanName = cleanMarketName(prevLine);
            if (cleanName.length >= 3 && !results[cleanName]) {
              results[cleanName] = {
                rawName: prevLine.trim(),
                openPana: numOnlyHalf[1],
                openDigit: numOnlyHalf[2],
                closeDigit: null,
                closePana: null,
                jodi: null
              };
            }
          }
        }
      }

      if (Object.keys(results).length > 20) break;
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
  if (!ONESIGNAL_REST_KEY || ONESIGNAL_REST_KEY.length < 10) {
    console.log("OneSignal REST key not provided, skipping notification.");
    return;
  }

  const payload = JSON.stringify({
    app_id: ONESIGNAL_APP_ID,
    included_segments: ["All"],
    headings: { en: title },
    contents: { en: message }
  });

  return new Promise((resolve) => {
    try {
      const req = https.request('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${ONESIGNAL_REST_KEY}`
        }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log("Notification sent response:", data.slice(0, 100));
          resolve(data);
        });
      });
      req.on('error', (err) => {
        console.error("Notification error ignored:", err.message);
        resolve(null);
      });
      req.write(payload);
      req.end();
    } catch (e) {
      console.error("Notification exception caught:", e.message);
      resolve(null);
    }
  });
}

async function checkResultsEngine() {
  console.log("🔍 Checking Live Results from Multi-Sources...");
  const [liveResults, games] = await Promise.all([
    fetchAllLiveResults(),
    getFirebaseGames()
  ]);

  const count = Object.keys(liveResults).length;
  console.log(`Found ${count} live results in markets.`);

  for (const game of games) {
    if (game.isPassed) continue;

    const targetClean = cleanMarketName(game.market);
    let matchedResult = null;

    for (const key in liveResults) {
      if (key.includes(targetClean) || targetClean.includes(key)) {
        matchedResult = liveResults[key];
        break;
      }
    }

    if (!matchedResult) continue;

    const userOpens = (game.open || "").split(/\s+/).filter(Boolean);
    const userCloses = (game.close || "").split(/\s+/).filter(Boolean);
    const userJodis = (game.jodi || "").split(/\s+/).filter(Boolean);
    const userOpenPanas = (game.openPana || "").split(/\s+/).filter(Boolean);
    const userClosePanas = (game.closePana || "").split(/\s+/).filter(Boolean);

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
