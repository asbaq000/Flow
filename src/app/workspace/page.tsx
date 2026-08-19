import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { allTags, allUsers, listNotifications, listTasks } from '@/lib/store';
import { canView } from '@/lib/permissions';
import Workspace from '@/components/Workspace';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const me = await currentUser();
  if (!me) redirect('/login');

  const tasks = (await listTasks({ topLevelOnly: true })).filter((t) => canView(me, t));
  const notifications = await listNotifications(me.id);

  return (
    <Workspace
      me={me}
      initialTasks={tasks}
      initialUsers={await allUsers()}
      initialTags={await allTags()}
      initialNotifications={notifications}
    />
  );
}
