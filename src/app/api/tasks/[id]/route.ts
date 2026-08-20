import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { allUsers, deleteTask, getTask, getUser, listActivity, listComments, setTaskTags, updateTask } from '@/lib/store';
import {
  abilitiesFor, canArchive, canAssign, canChangeStatus, canDelete, canEditContent, canEditPriority,
  canView, isAssignableRole, canSetStatus,
} from '@/lib/permissions';
import type { TaskPatch } from '@/lib/store';
import type { Priority, Status } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);

  // Independent of each other, so they go out together rather than in a chain.
  // `members` rides along too: the panel needs it to offer @mentions, and
  // deriving it here costs nothing on top of the task we already hydrated.
  const [comments, activity, everyone] = await Promise.all([
    listComments(id),
    listActivity(id),
    allUsers(),
  ]);

  return ok({
    task,
    comments,
    activity,
    members: everyone.filter((u) => canView(u, task)),
    abilities: abilitiesFor(user, task),
  });
}

interface PatchBody {
  title?: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  assigneeId?: string | null;
  dueDate?: number | null;
  estimate?: number | null;
  position?: number;
  archived?: boolean;
  tagIds?: string[];
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);

  const body = await readJson<PatchBody>(req);
  const patch: TaskPatch = {};

  if (body.title !== undefined || body.description !== undefined) {
    if (!canEditContent(user, task)) return fail('You cannot edit this task', 403);
    if (body.title !== undefined) patch.title = body.title.trim() || 'Untitled';
    if (body.description !== undefined) patch.description = body.description;
  }
  if (body.status !== undefined) {
    if (!canChangeStatus(user, task)) return fail('Only the assignee or a Team Lead can move this task', 403);
    // A developer drives their own work up to SUBMITTED — closing it is a
    // review decision, taken through /review, not a self-declaration.
    if (!canSetStatus(user, task, body.status)) {
      return fail(
        body.status === 'DONE'
          ? 'Submit this for review instead — only a Team Lead can mark it done'
          : `You cannot move this task to ${body.status.replace('_', ' ').toLowerCase()}`,
        403
      );
    }
    patch.status = body.status;
  }
  if (body.priority !== undefined) {
    if (!canEditPriority(user, task)) return fail('You cannot change priority on this task', 403);
    patch.priority = body.priority;
  }
  if (body.assigneeId !== undefined) {
    if (!canAssign(user)) return fail('Only a Team Lead can reassign work', 403);

    if (body.assigneeId) {
      // Work only flows down to Developers — never sideways to an Employee.
      const target = await getUser(body.assigneeId);
      if (!target) return fail('That person is not in this workspace', 404);
      if (!isAssignableRole(target.role)) {
        return fail(`Work can only be assigned to a Developer. ${target.name} is not one.`, 400);
      }
    }

    patch.assignee_id = body.assigneeId;
    // Picking up a triaged task moves it into the active board automatically.
    if (body.assigneeId && task.status === 'TRIAGE' && body.status === undefined) patch.status = 'TODO';
  }
  if (body.dueDate !== undefined) {
    if (!canEditContent(user, task)) return fail('You cannot edit this task', 403);
    patch.due_date = body.dueDate;
  }
  if (body.estimate !== undefined) {
    if (!canEditContent(user, task)) return fail('You cannot edit this task', 403);
    patch.estimate = body.estimate;
  }
  if (body.position !== undefined) patch.position = body.position;
  if (body.archived !== undefined) {
    if (!canArchive(user, task)) return fail('You cannot archive this task', 403);
    patch.archived = body.archived ? 1 : 0;
  }
  if (body.tagIds !== undefined) {
    if (!canEditContent(user, task)) return fail('You cannot edit this task', 403);
    await setTaskTags(id, body.tagIds);
  }

  const updated = await updateTask(user, id, patch);
  return ok({ task: updated, abilities: updated ? abilitiesFor(user, updated) : null });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canDelete(user, task)) return fail('You cannot delete this task', 403);

  await deleteTask(id);
  return ok({ ok: true });
}
