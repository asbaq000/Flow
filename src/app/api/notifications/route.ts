import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { listNotifications } from '@/lib/store';

export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const notifications = await listNotifications(user.id);
  return ok({ notifications, unread: notifications.filter((n) => !n.read).length });
}
