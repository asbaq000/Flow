import { NextResponse } from 'next/server';
import { currentUser, pickRoutingLead } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { allTags, allUsers, createTask, getUser, listTasks } from '@/lib/store';
import { canChooseAssigneeAtCreation, canView, isAssignableRole } from '@/lib/permissions';
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
  /** Only honoured for a Team Lead or the CEO; anyone else's task is routed. */
  assigneeId?: string | null;
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
   * The routing rule stands for everyone who does not hold the authority to
   * assign: the task lands on a Team Lead's desk in Triage, and only from
   * there is it handed down. A Lead or the CEO already has that authority, so
   * when they name a Developer as they write the task it starts assigned and
   * in To Do — nobody triages their own decision. Any assignee from anyone
   * else is ignored on purpose.
   */
  let assignee: { id: string; name: string } | null = null;

  if (body.assigneeId && canChooseAssigneeAtCreation(user)) {
    const target = await getUser(body.assigneeId);
    if (!target || target.org_id !== user.org_id) return fail('That person is not in this workspace', 404);
    if (!isAssignableRole(target.role)) {
      return fail(`Work can only be assigned to a Developer. ${target.name} is not one.`, 400);
    }
    assignee = { id: target.id, name: target.name };
  }

  const routedTo = assignee ? null : await pickRoutingLead(user.org_id, user.id);
  const landedOn = assignee ?? routedTo;

  const task = await createTask(
    user,
    {
      title: body.title,
      description: body.description,
      status: assignee ? 'TODO' : 'TRIAGE',
      priority: body.priority ?? 'MEDIUM',
      assigneeId: landedOn?.id ?? null,
      parentId: body.parentId ?? null,
      dueDate: body.dueDate ?? null,
      estimate: body.estimate ?? null,
      links: body.links ?? [],
      tagIds: body.tagIds ?? [],
    },
    landedOn?.id ?? null
  );

  return ok({
    task,
    routedTo: landedOn ? { id: landedOn.id, name: landedOn.name } : null,
    assignedDirectly: Boolean(assignee),
  }, 201);
}
