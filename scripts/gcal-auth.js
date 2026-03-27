/**
 * Run once: npm run gcal-auth
 * Opens a browser for Google OAuth, then saves the token to data/gcal-token.json.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');

const CREDENTIALS_FILE = path.join(__dirname, '..', 'data', 'gcal-credentials.json');
const TOKEN_FILE = path.join(__dirname, '..', 'data', 'gcal-token.json');
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

if (!fs.existsSync(CREDENTIALS_FILE)) {
  console.error(`Missing: ${CREDENTIALS_FILE}`);
  console.error('Download your OAuth2 credentials from Google Cloud Console and save them there.');
  console.error('See the setup instructions for details.');
  process.exit(1);
}

const { client_id, client_secret } = (() => {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  const creds = raw.installed || raw.web;
  if (!creds) {
    console.error('credentials.json does not contain an "installed" or "web" key.');
    process.exit(1);
  }
  return creds;
})();

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES
});

console.log('\nOpening browser for Google authorization...');
console.log('If it does not open automatically, visit:\n');
console.log(authUrl);
console.log();

// Try to open browser automatically
const { exec } = require('child_process');
exec(`start "" "${authUrl}"`);

// Local server to catch the OAuth redirect
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/?')) {
    res.end('Waiting...');
    return;
  }

  const params = new URL(req.url, REDIRECT_URI).searchParams;
  const code = params.get('code');
  const error = params.get('error');

  if (error || !code) {
    res.end(`<h2>Authorization failed: ${error || 'no code returned'}</h2>`);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

    res.end('<h2>Authorization complete. You can close this tab.</h2>');
    console.log(`Token saved to ${TOKEN_FILE}`);
    console.log('\nRun "npm run gcal-sync" to sync your Arbiter games to Google Calendar.');
  } catch (err) {
    res.end(`<h2>Error: ${err.message}</h2>`);
    console.error(err);
  } finally {
    server.close();
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log(`Waiting for Google to redirect to localhost:${REDIRECT_PORT}...`);
});
