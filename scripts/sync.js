/**
 * Standalone sync — runs pull + Google Calendar sync without the web server.
 * Scheduled via Windows Task Scheduler.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { google } = require('googleapis');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROFILE_DIR = path.join(DATA_DIR, 'arbiter-profile');
const GAMES_FILE = path.join(DATA_DIR, 'arbiter-games.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'gcal-credentials.json');
const TOKEN_FILE = path.join(DATA_DIR, 'gcal-token.json');
const EVENT_MAP_FILE = path.join(DATA_DIR, 'gcal-event-map.json');
const DEBUG_HTML_FILE = path.join(DATA_DIR, 'arbiter-page.html');

const ARBITER_URL = 'https://www1.arbitersports.com/Official/GameScheduleEdit.aspx';
const CALENDAR_ID = 'primary';
const ARBITER_PROP_KEY = 'arbiterId';
const DEFAULT_GAME_HOURS = 2;
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

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

function loadAuthedClient() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  const creds = raw.installed || raw.web;
  const client = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  client.setCredentials(tokens);
  client.on('tokens', updated => {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...tokens, ...updated }, null, 2));
  });
  return client;
}

function loadEventMap() {
  if (!fs.existsSync(EVENT_MAP_FILE)) return {};
  return JSON.parse(fs.readFileSync(EVENT_MAP_FILE, 'utf8'));
}

function saveEventMap(map) {
  fs.writeFileSync(EVENT_MAP_FILE, JSON.stringify(map, null, 2));
}

function toGoogleEvent(game) {
  return {
    summary: game.title,
    location: game.location || undefined,
    description: game.description || undefined,
    start: { dateTime: game.start },
    end: { dateTime: game.end },
    extendedProperties: { private: { [ARBITER_PROP_KEY]: game.id } }
  };
}

(async () => {
  log('Starting sync...');

  // --- Pull from Arbiter ---
  log('Connecting to Arbiter...');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 1200 }
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(ARBITER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  const html = await page.content();
  fs.writeFileSync(DEBUG_HTML_FILE, html, 'utf8');

  const looksLoggedOut =
    /sign\s*in|login/i.test(html) && !/scheduleRow|My Schedule|View By Day/i.test(html);
  if (looksLoggedOut) {
    await context.close();
    throw new Error('Arbiter session expired. Open the app and re-connect Arbiter.');
  }

  const rawGames = await page.$$eval('tr.scheduleRow', rows => {
    function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
    function textById(root, frag, tag) {
      const els = Array.from(root.querySelectorAll(tag ? `${tag}[id]` : '[id]'));
      const el = els.find(n => n.id.toLowerCase().includes(frag.toLowerCase()));
      return clean(el ? el.textContent : '');
    }
    function valById(root, frag) {
      const els = Array.from(root.querySelectorAll('input[id]'));
      const el = els.find(n => n.id.toLowerCase().includes(frag.toLowerCase()));
      return clean(el ? el.getAttribute('value') : '');
    }
    function textBySel(root, sel) {
      const el = root.querySelector(sel);
      return clean(el ? el.textContent : '');
    }
    return rows.map(row => ({
      stableId: valById(row, 'hidGame') || textById(row, 'linkGame'),
      position: textBySel(row, 'td.position'),
      dateText: textBySel(row, 'td.gameDate'),
      sportLevel: textById(row, 'lblSportLevel'),
      site: textById(row, 'lnkSite', 'a'),
      home: textById(row, 'lnkTeam', 'a'),
      away: textById(row, 'lnkAwayTeam'),
      fees: textById(row, 'lblFees'),
      status: textById(row, 'lblStatus'),
      group: textById(row, 'lblGroupNickname')
    }));
  });

  await context.close();

  const games = [];
  const seen = new Set();
  for (const raw of rawGames) {
    const start = parseDateTime(raw.dateText);
    if (!start) continue;
    const id = cleanText(raw.stableId) ||
      [raw.dateText, raw.home, raw.away, raw.position, raw.sportLevel].map(cleanText).join('||');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const end = new Date(start.getTime() + DEFAULT_GAME_HOURS * 60 * 60 * 1000);
    games.push({
      id, title: buildTitle(raw),
      start: start.toISOString(), end: end.toISOString(),
      location: cleanText(raw.site),
      description: [
        `Arbiter ID: ${id}`,
        raw.group && `Group: ${cleanText(raw.group)}`,
        raw.sportLevel && `Level: ${cleanText(raw.sportLevel)}`,
        raw.position && `Position: ${cleanText(raw.position)}`,
        raw.dateText && `Date/Time: ${cleanText(raw.dateText)}`,
        raw.site && `Site: ${cleanText(raw.site)}`,
        raw.home && `Home: ${cleanText(raw.home)}`,
        raw.away && `Away: ${cleanText(raw.away)}`,
        raw.fees && `Fee: ${cleanText(raw.fees)}`,
        raw.status && `Status: ${cleanText(raw.status)}`
      ].filter(Boolean).join('\n')
    });
  }

  fs.writeFileSync(GAMES_FILE, JSON.stringify({
    pulledAt: new Date().toISOString(), count: games.length, games
  }, null, 2));
  log(`Pulled ${games.length} games from Arbiter.`);

  // --- Sync to Google Calendar ---
  log('Syncing to Google Calendar...');
  const auth = loadAuthedClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const eventMap = loadEventMap();

  let created = 0, updated = 0;

  for (const game of games) {
    const eventBody = toGoogleEvent(game);
    const existingGcalId = eventMap[game.id];

    if (existingGcalId) {
      try {
        await calendar.events.patch({
          calendarId: CALENDAR_ID,
          eventId: existingGcalId,
          requestBody: eventBody
        });
        updated++;
      } catch (err) {
        if (err.code === 404 || err.status === 404) {
          const result = await calendar.events.insert({
            calendarId: CALENDAR_ID, requestBody: eventBody
          });
          eventMap[game.id] = result.data.id;
          created++;
        } else throw err;
      }
    } else {
      const result = await calendar.events.insert({
        calendarId: CALENDAR_ID, requestBody: eventBody
      });
      eventMap[game.id] = result.data.id;
      created++;
    }
  }

  saveEventMap(eventMap);
  log(`Created ${created} new events, updated ${updated}.`);
  log('Sync complete.');
})().catch(err => {
  console.error(`[${new Date().toISOString()}] ERROR: ${err.message}`);
  process.exit(1);
});
