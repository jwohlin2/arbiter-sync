const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROFILE_DIR = path.join(__dirname, '..', 'data', 'arbiter-profile');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'arbiter-games.json');
const DEBUG_HTML_FILE = path.join(__dirname, '..', 'data', 'arbiter-page.html');
const ARBITER_URL = 'https://www1.arbitersports.com/Official/GameScheduleEdit.aspx';
const DEFAULT_GAME_HOURS = 2;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseDateTime(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;

  const match = cleaned.match(/(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+[A-Za-z]{3})?\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!match) return null;

  const dt = new Date(`${match[1]} ${match[2].toUpperCase()}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function buildTitle({ away, home, position, sportLevel }) {
  const matchup = away && home ? `${away} at ${home}` : away || home || '';
  if (matchup && position) return `${matchup} - ${position}`;
  if (matchup) return matchup;
  if (sportLevel && position) return `${sportLevel} - ${position}`;
  if (sportLevel) return sportLevel;
  return 'Arbiter Assignment';
}

(async () => {
  if (!fs.existsSync(PROFILE_DIR)) {
    throw new Error(`Missing profile dir: ${PROFILE_DIR}. Run "npm run login" first.`);
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 1200 }
  });

  const page = context.pages()[0] || await context.newPage();

  await page.goto(ARBITER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  const html = await page.content();
  fs.writeFileSync(DEBUG_HTML_FILE, html, 'utf8');

  const title = await page.title();
  const url = page.url();

  const looksLoggedOut =
    /sign\s*in|login/i.test(html) &&
    !/scheduleRow|My Schedule|View By Day/i.test(html);

  if (looksLoggedOut) {
    throw new Error(
      `Arbiter session does not look authenticated. Title="${title}", URL="${url}". ` +
      `Open the saved HTML file and rerun "npm run login".`
    );
  }

  const games = await page.$$eval('tr.scheduleRow', rows => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function textBySelector(root, selector) {
      const el = root.querySelector(selector);
      return clean(el ? el.textContent : '');
    }

    function valueBySelector(root, selector) {
      const el = root.querySelector(selector);
      return clean(el ? el.getAttribute('value') : '');
    }

    function textByIdContains(root, fragment, tagName) {
      const els = Array.from(root.querySelectorAll(tagName ? `${tagName}[id]` : '[id]'));
      const lower = fragment.toLowerCase();
      const el = els.find(node => String(node.id || '').toLowerCase().includes(lower));
      return clean(el ? el.textContent : '');
    }

    function valueByIdContains(root, fragment) {
      const els = Array.from(root.querySelectorAll('input[id]'));
      const lower = fragment.toLowerCase();
      const el = els.find(node => String(node.id || '').toLowerCase().includes(lower));
      return clean(el ? el.getAttribute('value') : '');
    }

    return rows.map(row => {
      const hiddenGameId = valueByIdContains(row, 'hidGame');
      const visibleGameId = textByIdContains(row, 'linkGame');
      const stableId = hiddenGameId || visibleGameId;

      const position = textBySelector(row, 'td.position');
      const dateText = textBySelector(row, 'td.gameDate');
      const sportLevel = textByIdContains(row, 'lblSportLevel');
      const site = textByIdContains(row, 'lnkSite', 'a');
      const home = textByIdContains(row, 'lnkTeam', 'a');
      const away = textByIdContains(row, 'lnkAwayTeam');
      const fees = textByIdContains(row, 'lblFees');
      const status = textByIdContains(row, 'lblStatus');
      const group = textByIdContains(row, 'lblGroupNickname');

      return {
        stableId,
        position,
        dateText,
        sportLevel,
        site,
        home,
        away,
        fees,
        status,
        group
      };
    });
  });

  const normalized = [];
  const seen = new Set();

  for (const raw of games) {
    const start = parseDateTime(raw.dateText);
    if (!start) continue;

    const id = cleanText(raw.stableId) || [
      raw.dateText,
      raw.home,
      raw.away,
      raw.position,
      raw.sportLevel
    ].map(cleanText).join('||');

    if (!id || seen.has(id)) continue;
    seen.add(id);

    const end = new Date(start.getTime() + DEFAULT_GAME_HOURS * 60 * 60 * 1000);

    normalized.push({
      id,
      title: buildTitle(raw),
      start: start.toISOString(),
      end: end.toISOString(),
      location: cleanText(raw.site),
      description: [
        `Arbiter ID: ${id}`,
        raw.group ? `Group: ${cleanText(raw.group)}` : '',
        raw.sportLevel ? `Level: ${cleanText(raw.sportLevel)}` : '',
        raw.position ? `Position: ${cleanText(raw.position)}` : '',
        raw.dateText ? `Date/Time: ${cleanText(raw.dateText)}` : '',
        raw.site ? `Site: ${cleanText(raw.site)}` : '',
        raw.home ? `Home: ${cleanText(raw.home)}` : '',
        raw.away ? `Away: ${cleanText(raw.away)}` : '',
        raw.fees ? `Fee: ${cleanText(raw.fees)}` : '',
        raw.status ? `Status: ${cleanText(raw.status)}` : ''
      ].filter(Boolean).join('\n')
    });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    pulledAt: new Date().toISOString(),
    title,
    url,
    count: normalized.length,
    games: normalized
  }, null, 2));

  console.log(`Pulled ${normalized.length} games.`);
  console.log(`Saved to ${OUTPUT_FILE}`);

  await context.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
