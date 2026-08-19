import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { allUsers } from '@/lib/store';
import { many } from '@/lib/pg';

export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const users = await allUsers();
  // Open-task load per person powers the assignment picker and the People page.
  const loads = await many<{ id: string; open: number }>(
    `SELECT assignee_id AS id, COUNT(*)::int AS open FROM tasks
     WHERE archived = 0 AND status != 'DONE' AND assignee_id IS NOT NULL
     GROUP BY assignee_id`
  );
  const byId = new Map(loads.map((l) => [l.id, l.open]));

  return ok({ users: users.map((u) => ({ ...u, open_tasks: byId.get(u.id) ?? 0 })) });
}
