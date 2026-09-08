/**
 * One-time: makes the key pair browser push notifications are signed with.
 *
 *   npm run push:keys
 *
 * Paste the two lines it prints into .env.local and your host's environment.
 * Keep the private one private. Changing it later silently breaks every
 * browser that already subscribed, so generate once and leave it be.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to .env.local (and to your host's environment variables):

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com

Generate these once. Regenerating breaks every browser already subscribed.
`);
