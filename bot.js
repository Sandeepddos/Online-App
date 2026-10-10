const https = require('https');

const FIREBASE_PROJECT_ID = "live--update";
const ONESIGNAL_APP_ID = "39ffebaf-3ca2-445a-b1e9-04a9732357d9";
const ONESIGNAL_KEY = "os_v2_app_hh76xlz4ujcfvmpjasuxgi2x3hkmgwjfl6tuu7mxsr6fjubf2l2ul64buzzy767k45xroappzd6vhmquavplz7mel5ahlwjttjhcq4i";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, (res) => {
      // Redirect handle ಮಾಡುವುದು
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location));
      }
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

function parseResultsFromHTML(html) {
  // HTML ಟ್ಯಾಗ್‌ಗಳನ್ನು ತೆಗೆದು ಶುದ್ಧ ಟೆಕ್ಸ್ಟ್ ಮಾಡುವುದು
  const cleanText = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
                        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/&nbsp;/gi, ' ')
                        .replace(/\s+/g, ' ');

  const results = {};
  // ರಿಸಲ್ಟ್ ಪ್ಯಾಟರ್ನ್ ಹುಡುಕುವುದು (ಉದಾ: MILAN MORNING 246-21-128 ಅಥವಾ 133-7)
  const regex = /([A-Z\s]{3,25}?)\s+(\d{3}\s*[-–]\s*\d{1,2}(?:\s*[-–]\s*\d{3})?|\d{1,2}\s*[-–]\s*\d{3}|\d{3}\s*[-–]\s*\d{1,2})/gi;
  let match;

  while ((match = regex.exec(cleanText)) !== null) {
    const market = match[1].replace(/[^A-Z\s]/g, '').trim();
    const score = match[2].replace(/\s+/g, '').replace(/[–]/g, '-');
    if (market.length >= 3 && !/HTTP|WWW|COM|DATE|TODAY|PLAY|DOWNLOAD|CALL|ADMIN/i.test(market)) {
      results[market] = score;
    }
  }
  return results;
}

async function runBot() {
  try {
    console.log("Checking DPBoss live results...");
    let results = {};

    // 1st Source
    try {
      const html1 = await fetchUrl("https://sattamatkadpboss.org/");
      results = parseResultsFromHTML(html1);
    } catch(e) {
      console.log("Source 1 failed, trying source 2...");
    }

    // 2nd Source (Backup)
    if (Object.keys(results).length === 0) {
      try {
        const html2 = await fetchUrl("https://dpboss.net/");
        results = parseResultsFromHTML(html2);
      } catch(e) {
        console.log("Source 2 failed...");
      }
    }

    console.log("Found Results count:", Object.keys(results).length);
    console.log("Found Results Sample:", Object.entries(results).slice(0, 10));

    // Firebase ಗೇಮ್‌ಗಳನ್ನು ತರುವುದು
    const firebaseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/games`;
    const fbRes = await fetchUrl(firebaseUrl);
    const fbData = JSON.parse(fbRes);

    if (!fbData.documents || fbData.documents.length === 0) {
      console.log("No games found in Firebase database.");
      return;
    }

    for (let doc of fbData.documents) {
      const fields = doc.fields;
      if (fields.isPassed && fields.isPassed.booleanValue === true) continue;

      const market = (fields.market ? fields.market.stringValue : "").trim().toUpperCase();
      const docName = doc.name;

      let liveScore = null;
      for (let m in results) {
        if (m.includes(market) || market.includes(m)) {
          liveScore = results[m];
          break;
        }
      }

      if (!liveScore) {
        console.log(`No live result on DPBoss yet for: ${market}`);
        continue;
      }

      console.log(`Checking match for ${market} with result ${liveScore}`);

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
        console.log(`🎉 Market ${market} PASSED! Updating Firebase...`);
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

        postPush(`🏆 ${market} BLAST RESULT!`, `DPBoss Result: [${liveScore}] Passed: ${matchedNumbers.join(', ')}`);
      }
    }

  } catch (err) {
    console.error("Bot run error:", err);
  }
}

runBot();
