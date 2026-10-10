const https = require('https');

// ಫೈರ್‌ಬೇಸ್ ಕಾನ್ಫಿಗ್
const FIREBASE_PROJECT_ID = "live--update";
const ONESIGNAL_APP_ID = "39ffebaf-3ca2-445a-b1e9-04a9732357d9";
const ONESIGNAL_KEY = "os_v2_app_hh76xlz4ujcfvmpjasuxgi2x3hkmgwjfl6tuu7mxsr6fjubf2l2ul64buzzy767k45xroappzd6vhmquavplz7mel5ahlwjttjhcq4i";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
}

function postPush(title, message) {
  const payload = JSON.stringify({
    app_id: ONESIGNAL_APP_ID,
    included_segments: ["Total Subscriptions"],
    headings: { en: title },
    contents: { en: message },
    url: "https://sandeeppkdos.github.io/Online-App/"
  });

  const req = https.request({
    hostname: 'onesignal.com',
    path: '/api/v1/notifications',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Key ' + ONESIGNAL_KEY
    }
  });
  req.write(payload);
  req.end();
}

async function runBot() {
  try {
    console.log("Checking DPBoss live results...");
    const html = await fetchUrl("https://sattamatkadpboss.org/");
    
    // DPBoss ರಿಸಲ್ಟ್ ಎಳೆಯುವ ಲಾಜಿಕ್
    const regex = /([A-Z\s]{3,25})\s*[:\-–]?\s*(\d{3}\s*[-–]\s*\d{1,2}(?:\s*[-–]\s*\d{3})?|\d{1,2}\s*[-–]\s*\d{3}|\d{3}\s*[-–]\s*\d{1,2})/gi;
    let results = {};
    let match;

    while ((match = regex.exec(html)) !== null) {
      const mkt = match[1].replace(/[\*\_\:\(\)]/g, '').trim().toUpperCase();
      const score = match[2].replace(/\s+/g, '').replace(/[–]/g, '-');
      if (mkt.length >= 3 && !/HTTP|WWW|DATE|TODAY/i.test(mkt)) {
        results[mkt] = score;
      }
    }

    console.log("Found Results:", results);

    // Firebase ನಿಂದ ಆಕ್ಟಿವ್ ಗೇಮ್‌ಗಳನ್ನು ತರುವುದು
    const firebaseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/games`;
    const fbRes = await fetchUrl(firebaseUrl);
    const fbData = JSON.parse(fbRes);

    if (!fbData.documents) {
      console.log("No games in database.");
      return;
    }

    for (let doc of fbData.documents) {
      const fields = doc.fields;
      if (fields.isPassed && fields.isPassed.booleanValue === true) continue;

      const market = (fields.market ? fields.market.stringValue : "").trim().toUpperCase();
      const docName = doc.name; // Full doc path

      let liveScore = null;
      for (let m in results) {
        if (m.includes(market) || market.includes(m)) {
          liveScore = results[m];
          break;
        }
      }

      if (!liveScore) continue;

      console.log(`Matching game ${market} with result ${liveScore}`);

      const parts = liveScore.split('-');
      let matched = false;
      let matchedNumbers = [];

      const openPana = fields.openPana ? fields.openPana.stringValue : "";
      const open = fields.open ? fields.open.stringValue : "";
      const jodi = fields.jodi ? fields.jodi.stringValue : "";
      const close = fields.close ? fields.close.stringValue : "";
      const closePana = fields.closePana ? fields.closePana.stringValue : "";

      parts.forEach(p => {
        if (p.length === 3) {
          if (openPana.includes(p)) { matched = true; matchedNumbers.push(`Open Pana: ${p}`); }
          if (closePana.includes(p)) { matched = true; matchedNumbers.push(`Close Pana: ${p}`); }
        } else if (p.length === 2) {
          if (jodi.includes(p)) { matched = true; matchedNumbers.push(`Jodi: ${p}`); }
          if (open.includes(p[0])) { matched = true; matchedNumbers.push(`Open Digit: ${p[0]}`); }
          if (close.includes(p[1])) { matched = true; matchedNumbers.push(`Close Digit: ${p[1]}`); }
        } else if (p.length === 1) {
          if (open.includes(p)) { matched = true; matchedNumbers.push(`Open Digit: ${p}`); }
          if (close.includes(p)) { matched = true; matchedNumbers.push(`Close Digit: ${p}`); }
        }
      });

      if (matched) {
        console.log(`Market ${market} PASSED! Updating Firebase...`);
        // Firebase ಅಪ್‌ಡೇಟ್ ಮಾಡುವುದು
        const updatePayload = JSON.stringify({
          fields: {
            ...fields,
            isPassed: { booleanValue: true },
            passType: { stringValue: "AUTO_DPBOSS" },
            passedNumber: { stringValue: matchedNumbers.join(", ") }
          }
        });

        const patchReq = https.request(`https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=isPassed&updateMask.fieldPaths=passType&updateMask.fieldPaths=passedNumber`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' }
        });
        patchReq.write(updatePayload);
        patchReq.end();

        // ಪುಶ್ ನೋಟಿಫಿಕೇಶನ್
        postPush(`🏆 ${market} BLAST RESULT!`, `DPBoss Result: [${liveScore}] Passed: ${matchedNumbers.join(', ')}`);
      }
    }

  } catch (err) {
    console.error("Bot run error:", err);
  }
}

runBot();
