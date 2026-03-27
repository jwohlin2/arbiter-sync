/**
 * One-time debug script — dumps a game detail page to data/game-detail-debug.html
 * so we can identify the right selectors before building the email scraper.
 *
 * Usage: node scripts/debug-game-detail.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROFILE_DIR = path.join(__dirname, '..', 'data', 'arbiter-profile');
const OUT_FILE = path.join(__dirname, '..', 'data', 'game-detail-debug.html');
const TEXT_FILE = path.join(__dirname, '..', 'data', 'game-detail-debug.txt');

// Grab the first game ID from arbiter-games.json
const games = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'arbiter-games.json'), 'utf8')
).games;

const firstId = games[0].id; // e.g. "112675,10686,1971027"
const [groupId, gameId] = firstId.split(',');

const URL = `https://www1.arbitersports.com/Official/GameView.aspx?groupID=${groupId}&gameID=${gameId}&userID=`;

(async () => {
  console.log(`Fetching game detail for gameID=${gameId}, groupID=${groupId}`);
  console.log(URL);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 }
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  const html = await page.content();
  const text = await page.evaluate(() => document.body.innerText);

  fs.writeFileSync(OUT_FILE, html, 'utf8');
  fs.writeFileSync(TEXT_FILE, text, 'utf8');

  console.log(`\nSaved HTML to: ${OUT_FILE}`);
  console.log(`Saved text to: ${TEXT_FILE}`);
  console.log('\n--- Page text ---\n');
  console.log(text.slice(0, 3000));

  await context.close();
})().catch(err => { console.error(err); process.exit(1); });
