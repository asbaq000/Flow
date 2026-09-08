import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { testNotificationChannels } from '@/lib/notifyTest';

/**
 * Sends the signed-in person a test on every channel and reports, per
 * channel, whether it went — so "are notifications working?" has an answer
 * that does not involve waiting for a colleague to assign you something.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  return ok(await testNotificationChannels(user));
}
