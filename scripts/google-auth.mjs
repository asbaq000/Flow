/**
 * One-time helper: turns a Google OAuth client into the refresh token Flow
 * needs to book meetings.
 *
 * Run it once, on your own machine, with the dedicated Google account:
 *
 *   npm run google:auth
 *
 * It opens a consent screen, catches the redirect, and prints the refresh
 * token to paste into .env.local (and your host's environment variables).
 * Nothing here is used at runtime.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5555;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** Standalone scripts do not get Next.js's .env.local loading. */
function loadEnvLocal() {
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadEnvLocal();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.

  console.cloud.google.com -> APIs & Services
    1. Enable the Google Calendar API
    2. OAuth consent screen -> External -> add scope ${SCOPE}
       Set publishing status to "In production", or the refresh token
       this script gives you will stop working after 7 days.
    3. Credentials -> Create OAuth client ID -> Web application
       Authorised redirect URI: ${REDIRECT_URI}
`);
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    // offline + consent is what makes Google hand back a refresh token at all;
    // without prompt=consent a second run returns only an access token.
    access_type: 'offline',
    prompt: 'consent',
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end('Not here');
    return;
  }

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
      .end(`<p>Authorisation failed: ${error ?? 'no code returned'}</p>`);
    console.error(`\nAuthorisation failed: ${error ?? 'no code returned'}`);
    server.close();
    process.exit(1);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const body = await tokenRes.json();

  if (!tokenRes.ok || !body.refresh_token) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
      .end('<p>No refresh token came back. Check the console.</p>');
    console.error('\nGoogle did not return a refresh token:', body);
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/html' }).end(
    '<p style="font:15px system-ui">Done. The refresh token is in your terminal — you can close this tab.</p>'
  );

  console.log(`
Add this to .env.local and to your host's environment variables:

GOOGLE_REFRESH_TOKEN=${body.refresh_token}

Keep it secret: it books meetings as this Google account.
`);

  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`
Open this in the browser, signed in as the dedicated Google account:

${authUrl}

Waiting for the redirect on ${REDIRECT_URI} ...
`);
});
