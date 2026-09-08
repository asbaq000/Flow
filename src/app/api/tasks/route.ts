import { NextResponse } from 'next/server';
import { currentUser, pickRoutingLead } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { allTags, allUsers, createTask, listTasks } from '@/lib/store';
import { canView } from '@/lib/permissions';
import type { Priority } from '@/lib/types';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const url = new URL(req.url);
  const archived = url.searchParams.get('archived') === '1';
  const search = url.searchParams.get('q') ?? undefined;

  const tasks = (await listTasks({ orgId: user.org_id, archived, topLevelOnly: true, search })).filter((t) =>
    canView(user, t)
  );

  return ok({ tasks, users: await allUsers(user.org_id), tags: await allTags(user.org_id), me: user });
}

interface CreateBody {
  title?: string;
  description?: string;
  priority?: Priority;
  parentId?: string | null;
  dueDate?: number | null;
  estimate?: number | null;
  links?: { url: string; label?: string }[];
  tagIds?: string[];
}

export async function POST(req: Request): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const body = await readJson<CreateBody>(req);
  if (!body.title || !body.title.trim()) return fail('A task needs a title');

  /*
   * The routing rule, without exception: every task lands on a Team Lead's desk
   * in Triage first — no matter who raised it, including a Lead. Only from
   * there does a Lead hand it down to a Developer. Any assignee supplied by the
   * client is ignored on purpose.
   */
  const routedTo = await pickRoutingLead(user.org_id, user.id);

  const task = await createTask(
    user,
    {
      title: body.title,
      description: body.description,
      status: 'TRIAGE',
      priority: body.priority ?? 'MEDIUM',
      assigneeId: routedTo?.id ?? null,
      parentId: body.parentId ?? null,
      dueDate: body.dueDate ?? null,
      estimate: body.estimate ?? null,
      links: body.links ?? [],
      tagIds: body.tagIds ?? [],
    },
    routedTo?.id ?? null
  );

  return ok({ task, routedTo: routedTo ? { id: routedTo.id, name: routedTo.name } : null }, 201);
}
