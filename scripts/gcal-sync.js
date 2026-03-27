/**
 * Run any time: npm run gcal-sync
 * Reads data/arbiter-games.json and upserts events into Google Calendar.
 * Uses extendedProperties to track Arbiter IDs so events are never duplicated.
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_FILE = path.join(__dirname, '..', 'data', 'gcal-credentials.json');
const TOKEN_FILE = path.join(__dirname, '..', 'data', 'gcal-token.json');
const GAMES_FILE = path.join(__dirname, '..', 'data', 'arbiter-games.json');

// Set this to a specific calendar ID (email format) to use a non-primary calendar.
// Leave as 'primary' to add to your main calendar.
const CALENDAR_ID = 'primary';

// Arbiter games default to 2 hours — adjust per sport if needed.
const ARBITER_PROP_KEY = 'arbiterId';

function loadAuth() {
  for (const f of [CREDENTIALS_FILE, TOKEN_FILE, GAMES_FILE]) {
    if (!fs.existsSync(f)) {
      const hint = f === CREDENTIALS_FILE
        ? 'Download from Google Cloud Console and save to data/gcal-credentials.json'
        : f === TOKEN_FILE
          ? 'Run "npm run gcal-auth" first'
          : 'Run "npm run pull" first';
      throw new Error(`Missing file: ${f}\n${hint}`);
    }
  }

  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  const creds = raw.installed || raw.web;
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'http://localhost:3000'
  );
  oauth2Client.setCredentials(tokens);

  // Auto-save refreshed tokens
  oauth2Client.on('tokens', updated => {
    const merged = { ...tokens, ...updated };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(merged, null, 2));
  });

  return oauth2Client;
}

function toGoogleEvent(game) {
  return {
    summary: game.title,
    location: game.location || undefined,
    description: game.description || undefined,
    start: { dateTime: game.start },
    end: { dateTime: game.end },
    extendedProperties: {
      private: { [ARBITER_PROP_KEY]: game.id }
    }
  };
}

async function fetchExistingEvents(calendar) {
  const existing = new Map(); // arbiterId -> { gcalId, etag }
  let pageToken;

  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      privateExtendedProperty: `${ARBITER_PROP_KEY}=*`,
      maxResults: 250,
      pageToken,
      fields: 'nextPageToken,items(id,etag,extendedProperties)'
    });

    for (const event of res.data.items || []) {
      const arbiterId = event.extendedProperties?.private?.[ARBITER_PROP_KEY];
      if (arbiterId) existing.set(arbiterId, { gcalId: event.id, etag: event.etag });
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return existing;
}

(async () => {
  const auth = loadAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const { games } = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
  console.log(`Loaded ${games.length} games from arbiter-games.json`);

  console.log('Fetching existing Arbiter events from Google Calendar...');
  const existing = await fetchExistingEvents(calendar);
  console.log(`Found ${existing.size} existing Arbiter events in calendar`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const game of games) {
    const eventBody = toGoogleEvent(game);
    const match = existing.get(game.id);

    if (!match) {
      await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: eventBody });
      console.log(`  Created: ${game.title}`);
      created++;
    } else {
      // Update — Google Calendar handles no-op updates gracefully
      await calendar.events.patch({
        calendarId: CALENDAR_ID,
        eventId: match.gcalId,
        requestBody: eventBody
      });
      console.log(`  Updated: ${game.title}`);
      updated++;
    }
  }

  console.log(`\nDone. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
