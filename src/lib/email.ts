import nodemailer from 'nodemailer';
import dns from 'node:dns/promises';
import type { Transporter } from 'nodemailer';

/**
 * Outbound email, off by default.
 *
 * Nothing here throws into a request path: if SMTP is not configured, or the
 * provider is down, sending is skipped and logged. Losing a notification email
 * must never cost someone their task assignment.
 *
 * Configure in .env.local (see .env.example):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL
 */

/*
 * Two ways out, tried in that order.
 *
 * The Gmail API goes over HTTPS to the same host the calendar integration
 * already reaches, which is the whole point: SMTP needs a name lookup and a
 * long-lived socket on port 587, and in a serverless container both are
 * fragile — a lookup that answers EBUSY never reaches Gmail at all, and no
 * amount of retrying makes a wedged resolver work. An HTTPS request has none
 * of that surface, and it costs nothing extra: the same Google account, the
 * same OAuth client, one more scope.
 *
 * SMTP stays as the fallback for installs that never set Google up.
 */
const HOST = process.env.SMTP_HOST ?? '';
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER ?? '';
const PASS = process.env.SMTP_PASS ?? '';

const smtpEnabled = Boolean(HOST && USER && PASS);

/** The Gmail API needs the same credentials the calendar already uses. */
const gmailApiEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN
);

export const emailEnabled = gmailApiEnabled || smtpEnabled;

/** Which route a send actually took, so the self-test can say. */
export type MailRoute = 'gmail-api' | 'smtp' | 'none';

export const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

const FROM = process.env.MAIL_FROM || (USER ? `Flow <${USER}>` : 'Flow <no-reply@localhost>');

declare global {
  // eslint-disable-next-line no-var
  var __flow_mailer__: Transporter | undefined;
  // eslint-disable-next-line no-var
  var __flow_mail_host__: { ip: string; at: number } | undefined;
}

/**
 * The address to actually dial, resolved once and kept.
 *
 * Nodemailer would hand the hostname to the OS resolver on every send, and
 * that is the call that fails with EBUSY when a container is short of file
 * descriptors. Asking a DNS server directly (c-ares, not getaddrinfo) once
 * every ten minutes and dialling the address is both cheaper and out of the
 * way of that failure. TLS still validates against the hostname — see
 * `servername` below — so nothing about the certificate check is loosened.
 *
 * If the lookup fails we hand back the hostname and let nodemailer try the
 * ordinary way; a resolver that is down is not made better by refusing to try.
 */
const HOST_TTL_MS = 10 * 60_000;

async function dialAddress(): Promise<string> {
  const cached = global.__flow_mail_host__;
  if (cached && Date.now() - cached.at < HOST_TTL_MS) return cached.ip;
  try {
    const [ip] = await dns.resolve4(HOST);
    if (!ip) return HOST;
    global.__flow_mail_host__ = { ip, at: Date.now() };
    return ip;
  } catch (err) {
    console.warn('[email] could not resolve', HOST, '-', err instanceof Error ? err.message : err);
    return HOST;
  }
}

function transport(host: string): Transporter | null {
  if (!emailEnabled) return null;
  if (!global.__flow_mailer__) {
    global.__flow_mailer__ = nodemailer.createTransport({
      host,
      port: PORT,
      // 465 is implicit TLS; 587 upgrades with STARTTLS.
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
      // Dialling an address, so the certificate is checked against the name.
      tls: { servername: HOST },
      /*
       * Fail fast rather than hang. This runs inside a serverless function
       * with its own time limit; a connection that is never going to open
       * should say so in seconds and let the retry above have its turn,
       * not sit there until the whole request is killed and nobody learns
       * anything.
       */
      connectionTimeout: 10_000,
      greetingTimeout: 8_000,
      socketTimeout: 20_000,
    });
  }
  return global.__flow_mailer__;
}

export interface Mail {
  to: string;
  subject: string;
  heading: string;
  body: string;
  /** Optional call-to-action button. */
  action?: { label: string; url: string };
  footer?: string;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A single, plain, dark-friendly template — no images, no tracking. */
function render(mail: Mail): { html: string; text: string } {
  const action = mail.action
    ? `<tr><td style="padding:24px 0 8px">
         <a href="${escape(mail.action.url)}"
            style="background:#2383e2;color:#fff;text-decoration:none;padding:11px 18px;
                   border-radius:6px;font-weight:600;display:inline-block">
           ${escape(mail.action.label)}
         </a></td></tr>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;
    font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#37352f">
    <table role="presentation" cellpadding="0" cellspacing="0"
           style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e9e9e7;
                  border-radius:8px;padding:28px">
      <tr><td style="font-size:13px;color:#787774;padding-bottom:14px">Flow</td></tr>
      <tr><td style="font-size:19px;font-weight:700;line-height:1.35">${escape(mail.heading)}</td></tr>
      <tr><td style="font-size:14px;line-height:1.6;padding-top:10px;color:#37352f">
        ${escape(mail.body).replace(/\n/g, '<br>')}
      </td></tr>
      ${action}
      <tr><td style="font-size:12px;color:#9b9a97;padding-top:22px;border-top:1px solid #e9e9e7;margin-top:18px">
        ${escape(mail.footer ?? 'You are receiving this because you have a Flow account.')}
      </td></tr>
    </table></body></html>`;

  const text = [
    mail.heading,
    '',
    mail.body,
    mail.action ? `\n${mail.action.label}: ${mail.action.url}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { html, text };
}

/** Fire-and-forget. Returns whether it actually went out. */
export async function sendMail(mail: Mail): Promise<boolean> {
  return (await sendMailDetailed(mail)).ok;
}

export interface MailOutcome {
  ok: boolean;
  /** Why it failed, in words a person can act on. Absent when it worked. */
  error?: string;
  /** How it went out, or would have. */
  route?: MailRoute;
}

/* ------------------------------------------------------------------ */
/* Gmail over HTTPS                                                    */
/* ------------------------------------------------------------------ */

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/** RFC 2047, so a subject with an accent in it does not arrive as mojibake. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** One MIME message: the plain part for mail readers that want it, then the HTML. */
function buildMime(mail: Mail, html: string, text: string): string {
  const boundary = `flow_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  return [
    `From: ${FROM}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function sendViaGmail(mail: Mail): Promise<MailOutcome> {
  const { accessToken } = await import('./googleCalendar');
  const { html, text } = render(mail);

  let token: string;
  try {
    token = await accessToken();
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, route: 'gmail-api', error: `Google would not issue a token: ${raw}` };
  }

  const raw = Buffer.from(buildMime(mail, html, text), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const res = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) return { ok: true, route: 'gmail-api' };

    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    const message = body.error?.message ?? `Gmail answered ${res.status}`;

    /*
     * The one failure somebody has to act on: the refresh token was minted
     * for the calendar alone, so Gmail refuses it. Re-running the auth helper
     * with the send scope is the whole fix, and saying so beats a status code.
     */
    if (res.status === 403 && /scope/i.test(message)) {
      return {
        ok: false,
        route: 'gmail-api',
        error:
          'The Google account is authorised for Calendar but not for sending mail. Add the gmail.send scope in the ' +
          'OAuth consent screen, run "npm run google:auth" again, and replace GOOGLE_REFRESH_TOKEN with the new one. ' +
          `[${message}]`,
      };
    }
    if (res.status === 401) {
      return { ok: false, route: 'gmail-api', error: `Google rejected the token — re-run "npm run google:auth". [${message}]` };
    }
    return { ok: false, route: 'gmail-api', error: message };
  } catch (err) {
    return {
      ok: false,
      route: 'gmail-api',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The same send, but it says what went wrong.
 *
 * Used by the notification self-test, where "it failed" is a useless answer:
 * an app password with the spaces left in and a revoked one both look
 * identical from the outside, and both are one-line fixes once named.
 */
export async function sendMailDetailed(mail: Mail): Promise<MailOutcome> {
  // Gmail over HTTPS first: no name lookup on a mail host, no port 587, and
  // no socket held open — which is the whole class of failure this avoids.
  let gmail: MailOutcome | null = null;
  if (gmailApiEnabled) {
    gmail = await sendViaGmail(mail);
    if (gmail.ok) return gmail;
    console.warn('[email] gmail api failed, falling back to smtp:', gmail.error);
  }

  const tx = smtpEnabled ? transport(await dialAddress()) : null;
  if (!tx) {
    console.info(`[email] not sent: "${mail.subject}" -> ${mail.to}`);
    return gmail ?? { ok: false, route: 'none', error: 'No mail route is configured on this server' };
  }

  const { html, text } = render(mail);
  let last = '';

  /*
   * Two attempts, because the first failure is often not about this email at
   * all: a name lookup that came back EBUSY or EAI_AGAIN is the machine's
   * resolver having a moment, and the same send a second later goes through.
   * A refusal — wrong password, rejected recipient — is not retried; it would
   * fail identically and only delay telling somebody what to fix.
   */
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await tx.sendMail({ from: FROM, to: mail.to, subject: mail.subject, html, text });
      return { ok: true, route: 'smtp' };
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code ?? '';
      if (attempt === 2 || !isTransient(last, code)) break;
      console.warn(`[email] transient failure (${code || 'unknown'}), retrying once:`, last);
      // Drop the cached address and the transporter built on it: if the box we
      // were dialling is the problem, the second attempt should not reuse it.
      global.__flow_mail_host__ = undefined;
      global.__flow_mailer__ = undefined;
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  console.error('[email] send failed:', last);
  // Both roads failed: name the one that is actually fixable.
  if (gmail && !gmail.ok) {
    return { ok: false, route: 'gmail-api', error: `${gmail.error} — and SMTP also failed: ${explain(last)}` };
  }
  return { ok: false, route: 'smtp', error: explain(last) };
}

/** Worth trying again: the network blinked, rather than the server saying no. */
function isTransient(message: string, code: string): boolean {
  const m = (code + ' ' + message).toUpperCase();
  return ['EBUSY', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'EPIPE', 'ENOTFOUND']
    .some((c) => m.includes(c));
}

/** Turns an SMTP server's answer into the thing to actually go and do. */
function explain(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('535') || m.includes('username and password not accepted') || m.includes('invalid login')) {
    return `Gmail rejected the sign-in. Use a 16-character App Password with the spaces removed (not your account password), and check SMTP_USER matches the account it was made on. [${raw}]`;
  }
  if (m.includes('534') || m.includes('application-specific password')) {
    return `Gmail wants an App Password, not the account password. Turn on 2-Step Verification, then create one. [${raw}]`;
  }
  if (m.includes('etimedout') || m.includes('econnrefused') || m.includes('esocket') || m.includes('connection timeout')) {
    return `Could not reach ${process.env.SMTP_HOST ?? 'the mail server'} on port ${process.env.SMTP_PORT ?? '587'}. Check SMTP_HOST and SMTP_PORT (587 for Gmail). [${raw}]`;
  }
  if (m.includes('ebusy') || m.includes('eai_again')) {
    // Seen on Windows when the machine's own resolver is momentarily wedged —
    // a VPN adapter, a security suite hooking DNS, or a network that just
    // changed. It never reached the mail server, so nothing here is about
    // the password.
    return `The machine could not look up ${process.env.SMTP_HOST ?? 'the mail server'} — its DNS answered "busy", not the mail server refusing anything. It was already retried once. Try again; if it keeps happening, check a VPN or security suite intercepting DNS, and run "ipconfig /flushdns". [${raw}]`;
  }
  if (m.includes('enotfound')) {
    return `SMTP_HOST does not resolve — check it for a typo. [${raw}]`;
  }
  if (m.includes('self signed') || m.includes('certificate')) {
    return `The mail server's TLS certificate was refused. [${raw}]`;
  }
  return raw;
}
