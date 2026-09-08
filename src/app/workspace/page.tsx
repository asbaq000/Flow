import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { allTags, allUsers, getOrganization, listNotifications, listTasks } from '@/lib/store';
import { canView } from '@/lib/permissions';
import Workspace from '@/components/Workspace';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const me = await currentUser();
  if (!me) redirect('/login');

  const tasks = (await listTasks({ orgId: me.org_id, topLevelOnly: true })).filter((t) => canView(me, t));
  const notifications = await listNotifications(me.id);
  const org = await getOrganization(me.org_id);

  return (
    <Workspace
      me={me}
      orgName={org?.name ?? ''}
      initialTasks={tasks}
      initialUsers={await allUsers(me.org_id)}
      initialTags={await allTags(me.org_id)}
      initialNotifications={notifications}
    />
  );
}
