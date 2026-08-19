import { fail, ok, readJson } from '@/lib/api';
import { createPasswordReset } from '@/lib/store';
import { appUrl, emailEnabled, sendMail } from '@/lib/email';

export async function POST(req: Request) {
  const { email = '' } = await readJson<{ email?: string }>(req);
  if (!email.trim()) return fail('Enter the email on your account');

  const reset = await createPasswordReset(email);

  // Always answer the same way. Anything that varied by whether the account
  // exists would turn this form into an account-enumeration oracle.
  const generic = {
    ok: true as const,
    message: 'If that email has an account, a reset link is on its way.',
  };

  if (!reset) return ok(generic);

  const url = `${appUrl}/reset?token=${reset.token}`;
  const sent = await sendMail({
    to: reset.user.email,
    subject: 'Reset your Flow password',
    heading: 'Reset your password',
    body: `Hi ${reset.user.name},\n\nUse the link below to choose a new password. It expires in one hour and can only be used once.\n\nIf you did not ask for this, you can ignore this email — nothing has changed.`,
    action: { label: 'Choose a new password', url },
    footer: 'This link expires one hour after it was requested.',
  });

  // With no SMTP configured the link would otherwise be unreachable, so it is
  // printed to the server console for local use.
  if (!sent) console.info(`[reset] password reset link for ${reset.user.email}: ${url}`);

  return ok(generic);
}
