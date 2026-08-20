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
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 5555;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/**
 * Standalone scripts do not get Next.js's env loading. Both filenames are
 * read because Next.js honours both, so either is a reasonable place to
 * have put the credentials.
 */
function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      // Non-greedy, so a Windows CRLF ending cannot smuggle a \r into the
      // value — a stray carriage return in a token fails in a way that looks
      // like the token itself is simply wrong.
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      // First file wins, matching Next.js's precedence.
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

loadEnvFiles();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local (or .env) first.

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

/**
 * Winds the listener down before leaving.
 *
 * Calling process.exit() straight from a request handler kills the loop while
 * the socket is still closing, which trips a libuv assertion on Windows
 * ("!(handle->flags & UV_HANDLE_CLOSING)") after the work has already
 * succeeded — alarming to read, and easy to mistake for a real failure.
 */
function finish(code) {
  server.close();
  setTimeout(() => process.exit(code), 250);
}

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
    finish(1);
    return;
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
    /*
     * Google only issues a refresh token the first time an account grants
     * this client. A repeat run comes back without one until the old grant
     * is revoked, so say that rather than just dumping the response.
     */
    console.error(`
Google did not return a refresh token${body.error ? ` (${body.error})` : ''}.

This normally means the account has already granted access to this app, and
Google only hands out a refresh token on the first grant. Revoke it, then run
this again:

  https://myaccount.google.com/permissions  ->  Flow  ->  Remove access
`);
    finish(1);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' }).end(
    '<p style="font:15px system-ui">Done. The refresh token is in your terminal — you can close this tab.</p>'
  );

  console.log(`
Add this to .env.local (or .env) and to your host's environment variables:

GOOGLE_REFRESH_TOKEN=${body.refresh_token}

Keep it secret: it books meetings as this Google account. Do not paste it
into a chat, an issue, or a commit — if it leaks, revoke Flow at
https://myaccount.google.com/permissions and run this again.
`);

  finish(0);
});

/**
 * Opens the consent screen directly.
 *
 * The URL is ~300 characters, which terminals wrap across lines — copying it
 * by hand tends to lose a chunk, and Google answers a truncated URL with a
 * bare "400. That's an error", which says nothing about the real cause. On
 * Windows this goes through rundll32 rather than `start` so that the
 * ampersands in the query string are never handed to a shell.
 */
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`
Port ${PORT} is already taken, almost always by an earlier run of this script
still waiting for its redirect.

Switch to that terminal window and press Ctrl+C, then run this again. The
port has to be free because Google sends the authorisation back to it.
`);
  } else {
    console.error('\nCould not start the callback server:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  // A copy-paste fallback that survives line wrapping, for when the browser
  // cannot be opened for us (or opens as the wrong Google account).
  const urlFile = path.join(os.tmpdir(), 'flow-google-auth-url.txt');
  fs.writeFileSync(urlFile, authUrl, 'utf8');

  const opened = openBrowser(authUrl);

  console.log(`
${opened ? 'Opening the consent screen in your browser...' : 'Could not open a browser automatically.'}

Sign in as the Google account that owns the Cloud project, then choose
Advanced -> Go to Flow (unsafe) -> Allow.

If no browser opened, or it opened as the wrong account, the full link is in:
  ${urlFile}
(open that file, copy the single line inside — do not retype it)

Waiting for the redirect on ${REDIRECT_URI} ...
`);
});
