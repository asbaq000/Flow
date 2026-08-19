import nodemailer from 'nodemailer';
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

const HOST = process.env.SMTP_HOST ?? '';
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER ?? '';
const PASS = process.env.SMTP_PASS ?? '';

export const emailEnabled = Boolean(HOST && USER && PASS);

export const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

const FROM = process.env.MAIL_FROM || (USER ? `Flow <${USER}>` : 'Flow <no-reply@localhost>');

declare global {
  // eslint-disable-next-line no-var
  var __flow_mailer__: Transporter | undefined;
}

function transport(): Transporter | null {
  if (!emailEnabled) return null;
  if (!global.__flow_mailer__) {
    global.__flow_mailer__ = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      // 465 is implicit TLS; 587 upgrades with STARTTLS.
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
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
  const tx = transport();
  if (!tx) {
    console.info(`[email] skipped (SMTP not configured): "${mail.subject}" -> ${mail.to}`);
    return false;
  }
  try {
    const { html, text } = render(mail);
    await tx.sendMail({ from: FROM, to: mail.to, subject: mail.subject, html, text });
    return true;
  } catch (err) {
    console.error('[email] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
