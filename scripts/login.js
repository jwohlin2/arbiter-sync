const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

const PROFILE_DIR = path.join(__dirname, '..', 'data', 'arbiter-profile');
const ARBITER_URL = 'https://www1.arbitersports.com/Official/GameScheduleEdit.aspx';

function waitForEnter(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

(async () => {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null
  });

  const page = context.pages()[0] || await context.newPage();

  await page.goto(ARBITER_URL, { waitUntil: 'domcontentloaded' });

  console.log('\nLog into Arbiter in the opened browser window.');
  console.log('Complete Google sign-in / MFA if prompted.');
  console.log('Then make sure you can see your Arbiter schedule page.\n');

  await waitForEnter('Press Enter here once the schedule page is fully visible... ');

  const finalUrl = page.url();
  console.log(`Final URL: ${finalUrl}`);

  await page.screenshot({
    path: path.join(__dirname, '..', 'data', 'arbiter-login-proof.png'),
    fullPage: true
  });

  console.log('Saved browser profile and proof screenshot.');
  await context.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
