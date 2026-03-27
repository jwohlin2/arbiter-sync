const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { chromium } = require('playwright');
const { google } = require('googleapis');
const { scrapeGameDetail, parseGameId } = require('./scripts/game-detail');

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, 'data');
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
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.send'
];

const MY_EMAIL  = 'jwohlin2@gmail.com';
const ARRIVAL_MINUTES_BEFORE = 45;
const TZ = 'America/New_York';
const EMAIL_LOG_FILE  = path.join(DATA_DIR, 'email-sent-log.json');
const CONFIG_FILE     = path.join(DATA_DIR, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { signerName: 'John Wohlin', signerPhone: '724-510-6001', autoEmail: false };
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let arbiterBrowserCtx = null;
let syncInProgress = false;
let lastSyncLog = [];

// ---------------------------------------------------------------------------
// Helpers — Arbiter data extraction
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helpers — Google Calendar
// ---------------------------------------------------------------------------
function getOAuth2Client() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  const creds = raw.installed || raw.web;
  return new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);
}

function loadAuthedClient() {
  const client = getOAuth2Client();
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

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Routes — status
// ---------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
  const arbiterReady = fs.existsSync(PROFILE_DIR) &&
    fs.readdirSync(PROFILE_DIR).length > 0;
  const gcalCredsMissing = !fs.existsSync(CREDENTIALS_FILE);
  const gcalReady = fs.existsSync(TOKEN_FILE);
  let gmailReady = false;
  if (gcalReady) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      gmailReady = !!(tokens.scope && tokens.scope.includes('gmail'));
    } catch (_) {}
  }

  let lastSync = null;
  let gameCount = 0;
  if (fs.existsSync(GAMES_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
      lastSync = data.pulledAt;
      gameCount = data.count || 0;
    } catch (_) {}
  }

  res.json({
    arbiterReady,
    arbiterBrowserOpen: arbiterBrowserCtx !== null,
    gcalReady,
    gcalCredsMissing,
    gmailReady,
    syncInProgress,
    lastSync,
    gameCount,
    lastSyncLog
  });
});

// ---------------------------------------------------------------------------
// Routes — Arbiter login
// ---------------------------------------------------------------------------
app.post('/api/arbiter-start', async (req, res) => {
  if (arbiterBrowserCtx) return res.json({ ok: true });

  try {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    arbiterBrowserCtx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: null
    });
    const page = arbiterBrowserCtx.pages()[0] || await arbiterBrowserCtx.newPage();
    await page.goto(ARBITER_URL, { waitUntil: 'domcontentloaded' });
    res.json({ ok: true });
  } catch (err) {
    arbiterBrowserCtx = null;
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/arbiter-done', async (req, res) => {
  if (!arbiterBrowserCtx) return res.status(400).json({ ok: false, error: 'No browser open' });
  try { await arbiterBrowserCtx.close(); } catch (_) {}
  arbiterBrowserCtx = null;
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Routes — Google Calendar OAuth
// ---------------------------------------------------------------------------
app.get('/api/gcal-auth', (req, res) => {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return res.status(400).send('gcal-credentials.json not found in data folder.');
  }
  const url = getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`/?error=${encodeURIComponent(error || 'no_code')}`);
  }
  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    res.redirect('/?gcal=authorized');
  } catch (err) {
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
});

// ---------------------------------------------------------------------------
// Routes — Sync
// ---------------------------------------------------------------------------
app.post('/api/sync', async (req, res) => {
  if (syncInProgress) return res.status(409).json({ ok: false, error: 'Sync already in progress' });

  syncInProgress = true;
  lastSyncLog = [];
  const log = msg => { console.log(msg); lastSyncLog.push(msg); };

  try {
    // --- Pull from Arbiter ---
    log('Connecting to Arbiter...');
    if (!fs.existsSync(PROFILE_DIR)) throw new Error('Arbiter not connected. Complete login first.');

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
      throw new Error('Arbiter session expired. Re-connect Arbiter and try again.');
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
    if (!fs.existsSync(TOKEN_FILE)) throw new Error('Google Calendar not authorized. Connect Google Calendar first.');

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
            // Event was deleted from calendar — recreate it
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
    log('Done.');

    res.json({ ok: true, log: lastSyncLog });
  } catch (err) {
    log(`Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message, log: lastSyncLog });
  } finally {
    syncInProgress = false;
  }
});

// ---------------------------------------------------------------------------
// Routes — Config
// ---------------------------------------------------------------------------
app.get('/api/config', (req, res) => res.json(loadConfig()));

app.post('/api/config', (req, res) => {
  const { signerName, signerPhone, autoEmail } = req.body;
  const config = { signerName: signerName || '', signerPhone: signerPhone || '', autoEmail: !!autoEmail };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Routes — Games list
// ---------------------------------------------------------------------------
app.get('/api/games', (req, res) => {
  if (!fs.existsSync(GAMES_FILE)) return res.json({ games: [] });
  const { games } = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
  const emailLog = fs.existsSync(EMAIL_LOG_FILE)
    ? JSON.parse(fs.readFileSync(EMAIL_LOG_FILE, 'utf8')) : {};

  const now = new Date();
  const upcoming = games
    .filter(g => new Date(g.start) >= now && / - Referee$/i.test(g.title))
    .map(g => ({ ...g, emailStatus: emailLog[g.id] || null }));

  res.json({ games: upcoming });
});

// ---------------------------------------------------------------------------
// Routes — Email helpers
// ---------------------------------------------------------------------------
function buildEmailData(game, { contactName, hostEmails, crewEmails }) {
  const config  = loadConfig();
  const hour    = parseInt(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  const greeting = hour < 12 ? 'Morning' : 'Afternoon';

  const matchup  = game.title.match(/^(.+?) at (.+?) - (.+)$/);
  const awayTeam = matchup ? matchup[1].trim() : '';
  const homeTeam = matchup ? matchup[2].trim() : '';
  const position = matchup ? matchup[3].trim() : (game.title.match(/ - (.+)$/)?.[1] || 'Official');

  function fmt(iso, opts) {
    return new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...opts });
  }

  const gameDate    = fmt(game.start, { month: 'numeric', day: 'numeric', year: '2-digit' });
  const gameTime    = fmt(game.start, { hour: 'numeric', minute: '2-digit', hour12: true });
  const arrivalISO  = new Date(new Date(game.start).getTime() - ARRIVAL_MINUTES_BEFORE * 60000).toISOString();
  const arrivalTime = fmt(arrivalISO, { hour: 'numeric', minute: '2-digit', hour12: true });

  const firstName = contactName ? contactName.split(' ')[0] : '';
  const namePart  = firstName ? ` ${firstName},` : ',';

  const subject = `Game Confirmation for ${homeTeam} vs. ${awayTeam} on ${gameDate}`;
  const body =
`Good ${greeting}${namePart}

I will be the ${position} for your game against ${awayTeam} on ${gameDate} at ${gameTime}.

My crew and I plan to arrive at ${game.location} by ${arrivalTime}.

Please let me know if there are any issues we should be aware of, including site changes, parking instructions, special events, pregame ceremonies, or any adjustments to the start time. If the game is canceled, postponed, or rescheduled, please reply all to this email as soon as possible. We look forward to working with you.

Best,
${config.signerName}
${config.signerPhone}`;

  const ccEmails = [...new Set(crewEmails.filter(e => e !== MY_EMAIL.toLowerCase()))];

  return { to: hostEmails.join(', '), cc: ccEmails.join(', '), subject, body };
}

async function sendGmail(auth, { to, cc, subject, body }) {
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = [
    `To: ${to}`, `Cc: ${cc}`, `Subject: ${subject}`,
    `MIME-Version: 1.0`, `Content-Type: text/plain; charset=UTF-8`, '', body
  ].join('\r\n');
  const encoded = Buffer.from(raw).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
}

// POST /api/game/:id/preview — build email preview from scraped detail
app.post('/api/game/:id/preview', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  if (!fs.existsSync(GAMES_FILE)) return res.status(404).json({ ok: false, error: 'No games file' });

  const { games } = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
  const game = games.find(g => g.id === id);
  if (!game) return res.status(404).json({ ok: false, error: 'Game not found' });

  const detail = req.body;
  const emailData = buildEmailData(game, {
    contactName: detail.contactName || '',
    hostEmails:  detail.hostEmails  || [],
    crewEmails:  detail.crewEmails  || []
  });
  res.json({ ok: true, ...emailData });
});

// GET /api/game/:id/detail — scrape game detail page
app.get('/api/game/:id/detail', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const { groupId, gameId } = parseGameId(id);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true, viewport: { width: 1440, height: 900 }
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    const detail = await scrapeGameDetail(page, groupId, gameId);
    res.json({ ok: true, ...detail });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    await context.close();
  }
});

// POST /api/game/:id/send-email — send confirmation email
app.post('/api/game/:id/send-email', async (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const { to, cc, subject, body } = req.body;

  if (!to) return res.status(400).json({ ok: false, error: 'No recipient (to) provided.' });

  try {
    const auth = loadAuthedClient();
    await sendGmail(auth, { to, cc, subject, body });

    const emailLog = fs.existsSync(EMAIL_LOG_FILE)
      ? JSON.parse(fs.readFileSync(EMAIL_LOG_FILE, 'utf8')) : {};
    emailLog[id] = { sentAt: new Date().toISOString(), to, cc, subject };
    fs.writeFileSync(EMAIL_LOG_FILE, JSON.stringify(emailLog, null, 2));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });

app.listen(PORT, () => {
  console.log(`Arbiter Sync running at http://localhost:${PORT}`);
  exec(`start "" "http://localhost:${PORT}"`);
});
