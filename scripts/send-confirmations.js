/**
 * Standalone script — sends day-before confirmation emails for tomorrow's games.
 * Run daily at 9 AM via Task Scheduler (alongside sync.js).
 */

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { google }   = require('googleapis');
const { scrapeGameDetail, parseGameId } = require('./game-detail');

const MY_EMAIL   = 'jwohlin2@gmail.com';
const ARRIVAL_MINUTES_BEFORE = 45;
const TZ = 'America/New_York';

const DATA_DIR         = path.join(__dirname, '..', 'data');
const PROFILE_DIR      = path.join(DATA_DIR, 'arbiter-profile');
const GAMES_FILE       = path.join(DATA_DIR, 'arbiter-games.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'gcal-credentials.json');
const TOKEN_FILE       = path.join(DATA_DIR, 'gcal-token.json');
const EMAIL_LOG_FILE   = path.join(DATA_DIR, 'email-sent-log.json');
const CONFIG_FILE      = path.join(DATA_DIR, 'config.json');
const REDIRECT_URI     = 'http://localhost:3000/oauth2callback';

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { signerName: 'John Wohlin', signerPhone: '724-510-6001', autoEmail: false };
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function isTomorrow(isoString) {
  const opts = { timeZone: TZ };
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return new Date(isoString).toLocaleDateString('en-US', opts) ===
         tomorrow.toLocaleDateString('en-US', opts);
}

function fmt(isoString, opts) {
  return new Date(isoString).toLocaleString('en-US', { timeZone: TZ, ...opts });
}

function buildEmailData(game, { contactName, hostEmails, crewEmails }) {
  const config   = loadConfig();
  const hour     = parseInt(fmt(new Date().toISOString(), { hour: 'numeric', hour12: false }));
  const greeting = hour < 12 ? 'Morning' : 'Afternoon';

  const matchup  = game.title.match(/^(.+?) at (.+?) - (.+)$/);
  const awayTeam = matchup ? matchup[1].trim() : '';
  const homeTeam = matchup ? matchup[2].trim() : '';
  const position = matchup ? matchup[3].trim() : (game.title.match(/ - (.+)$/)?.[1] || 'Official');

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
    `To: ${to}`,
    `Cc: ${cc}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    '',
    body
  ].join('\r\n');

  const encoded = Buffer.from(raw).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
}

function loadAuth() {
  const raw    = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  const creds  = raw.installed || raw.web;
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const client = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);
  client.setCredentials(tokens);
  client.on('tokens', updated =>
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...tokens, ...updated }, null, 2))
  );
  return client;
}

function loadEmailLog() {
  if (!fs.existsSync(EMAIL_LOG_FILE)) return {};
  return JSON.parse(fs.readFileSync(EMAIL_LOG_FILE, 'utf8'));
}

(async () => {
  const config = loadConfig();
  if (!config.autoEmail) { log('Auto-email is disabled. Skipping.'); return; }

  if (!fs.existsSync(GAMES_FILE)) { log('No games file. Run sync first.'); return; }

  const { games } = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
  const tomorrow  = games.filter(g => isTomorrow(g.start) && / - Referee$/i.test(g.title));

  if (!tomorrow.length) { log('No games tomorrow.'); return; }
  log(`${tomorrow.length} game(s) tomorrow.`);

  const emailLog = loadEmailLog();
  const unsent   = tomorrow.filter(g => !emailLog[g.id]?.sentAt);

  if (!unsent.length) { log('Confirmations already sent for all tomorrow games.'); return; }

  const auth    = loadAuth();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true, viewport: { width: 1440, height: 900 }
  });
  const page = context.pages()[0] || await context.newPage();

  for (const game of unsent) {
    const { groupId, gameId } = parseGameId(game.id);
    log(`Game ${gameId}: ${game.title}`);

    const detail = await scrapeGameDetail(page, groupId, gameId);

    if (!detail.hostEmails.length) {
      log(`  No host contacts found — skipping. Add them manually in the app.`);
      emailLog[game.id] = { sentAt: null, skipped: true, reason: 'No host contacts on Arbiter' };
      fs.writeFileSync(EMAIL_LOG_FILE, JSON.stringify(emailLog, null, 2));
      continue;
    }

    const emailData = buildEmailData(game, detail);
    await sendGmail(auth, emailData);

    emailLog[game.id] = {
      sentAt: new Date().toISOString(),
      to: emailData.to,
      cc: emailData.cc,
      subject: emailData.subject
    };
    fs.writeFileSync(EMAIL_LOG_FILE, JSON.stringify(emailLog, null, 2));
    log(`  Sent to: ${emailData.to}`);
  }

  await context.close();
  log('Done.');
})().catch(err => {
  console.error(`[${new Date().toISOString()}] ERROR: ${err.message}`);
  process.exit(1);
});
