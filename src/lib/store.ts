import { many, one, run, tx, nextTaskSeq } from './pg';
import { newId } from './ids';
import type {
  ActivityItem, Comment, Notification, Priority, ProgressKind, ProgressUpdate, SheetEntry,
  Status, Tag, Task, TaskFull, TaskLink, TaskSheet, User, VoiceNote,
} from './types';
import { docToPlain } from './types';
import { normalizeUrl } from './url';
import { publish } from './events';
import { appUrl, sendMail } from './email';

const USER_COLS = 'id, email, name, role, avatar_color, title, created_at';

/**
 * Every hydrated task, comment, voice note and progress update needs its
 * author. Resolved one query at a time that is hundreds of round trips to
 * paint one board — and the connection pool is deliberately tiny, so they
 * queue rather than fan out. A workspace has a handful of people who change
 * rarely, so the whole table is worth holding briefly in memory.
 */
const USER_CACHE_TTL_MS = 15_000;

declare global {
  // eslint-disable-next-line no-var
  var __flow_user_cache__: { at: number; byId: Map<string, User> } | undefined;
}

export function invalidateUserCache() {
  global.__flow_user_cache__ = undefined;
}

async function userCache(): Promise<Map<string, User>> {
  const cached = global.__flow_user_cache__;
  if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) return cached.byId;

  const rows = await many<User>(`SELECT ${USER_COLS} FROM users`);
  const byId = new Map(rows.map((u) => [u.id, u]));
  global.__flow_user_cache__ = { at: Date.now(), byId };
  return byId;
}

export async function getUser(id: string | null): Promise<User | null> {
  if (!id) return null;
  return (await userCache()).get(id) ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  // Sign-in path: always authoritative, never the cache.
  return one<User>(`SELECT ${USER_COLS} FROM users WHERE email = ?`, [email.trim().toLowerCase()]);
}

export async function allUsers(): Promise<User[]> {
  const users = [...(await userCache()).values()];
  const rank = { CEO: 0, MANAGER: 1, TEAM_LEAD: 2 } as Record<string, number>;
  return users.sort(
    (a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3) || a.name.localeCompare(b.name)
  );
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

const groupBy = <T>(rows: T[], key: (row: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
};

/**
 * Hydrates a whole set of tasks in a fixed number of queries rather than a
 * fixed number *per task*. The pool is intentionally tiny (Supabase caps
 * connections and Vercel runs many instances), so per-task fan-out does not
 * actually run in parallel — it queues, and a board of 30 tasks turns into
 * hundreds of serialised round trips.
 */
async function hydrateAll(tasks: Task[], depth = 1): Promise<TaskFull[]> {
  if (!tasks.length) return [];
  const ids = tasks.map((t) => t.id);
  const parentIds = [...new Set(tasks.map((t) => t.parent_id).filter(Boolean))] as string[];

  const [
    tagRows, linkRows, collabRows, commentCounts, voiceRows, progressRows, subtaskRows, parentRows, users,
  ] = await Promise.all([
    many<Tag & { task_id: string }>(
      `SELECT t.*, tt.task_id FROM tags t JOIN task_tags tt ON tt.tag_id = t.id
       WHERE tt.task_id = ANY(?) ORDER BY t.name`,
      [ids]
    ),
    many<TaskLink>('SELECT * FROM task_links WHERE task_id = ANY(?) ORDER BY position, id', [ids]),
    many<{ task_id: string; user_id: string }>(
      'SELECT task_id, user_id FROM task_assignees WHERE task_id = ANY(?)',
      [ids]
    ),
    many<{ task_id: string; c: number }>(
      'SELECT task_id, COUNT(*)::int AS c FROM comments WHERE task_id = ANY(?) GROUP BY task_id',
      [ids]
    ),
    // Only briefing notes here — the ones under comments travel with the comment.
    many<VoiceNote>(
      `SELECT ${VOICE_COLS} FROM voice_notes
       WHERE task_id = ANY(?) AND comment_id IS NULL ORDER BY created_at`,
      [ids]
    ),
    many<ProgressUpdate>(
      `SELECT ${PROGRESS_COLS} FROM progress_updates WHERE task_id = ANY(?) ORDER BY created_at DESC`,
      [ids]
    ),
    depth > 0
      ? many<Task>(
          'SELECT * FROM tasks WHERE parent_id = ANY(?) AND archived = 0 ORDER BY position, created_at',
          [ids]
        )
      : Promise.resolve([] as Task[]),
    parentIds.length
      ? many<{ id: string; title: string }>('SELECT id, title FROM tasks WHERE id = ANY(?)', [parentIds])
      : Promise.resolve([] as { id: string; title: string }[]),
    userCache(),
  ]);

  const subtasks = await hydrateAll(subtaskRows, depth - 1);

  const tagsBy = groupBy(tagRows, (r) => r.task_id);
  const linksBy = groupBy(linkRows, (r) => r.task_id);
  const collabBy = groupBy(collabRows, (r) => r.task_id);
  const voiceBy = groupBy(voiceRows, (r) => r.task_id);
  const progressBy = groupBy(progressRows, (r) => r.task_id);
  const subtasksBy = groupBy(subtasks, (s) => s.parent_id!);
  const countBy = new Map(commentCounts.map((r) => [r.task_id, r.c]));
  const parentTitles = new Map(parentRows.map((r) => [r.id, r.title]));
  const withAuthor = <T extends { author_id: string | null }>(rows: T[]) =>
    rows.map((r) => ({ ...r, author: users.get(r.author_id ?? '') ?? null }));

  return tasks.map((task) => ({
    ...task,
    creator: users.get(task.creator_id ?? '') ?? null,
    assignee: users.get(task.assignee_id ?? '') ?? null,
    collaborators: (collabBy.get(task.id) ?? [])
      .map((c) => users.get(c.user_id))
      .filter(Boolean)
      .sort((a, b) => a!.name.localeCompare(b!.name)) as User[],
    tags: tagsBy.get(task.id) ?? [],
    links: linksBy.get(task.id) ?? [],
    subtasks: subtasksBy.get(task.id) ?? [],
    comment_count: countBy.get(task.id) ?? 0,
    voice_notes: withAuthor(voiceBy.get(task.id) ?? []),
    progress_updates: withAuthor(progressBy.get(task.id) ?? []),
    parent_title: task.parent_id ? parentTitles.get(task.parent_id) ?? null : null,
  }));
}

async function hydrate(task: Task, depth = 1): Promise<TaskFull> {
  return (await hydrateAll([task], depth))[0];
}

export async function getTask(id: string): Promise<TaskFull | null> {
  const row = await one<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
  return row ? hydrate(row) : null;
}

export interface TaskQuery {
  archived?: boolean;
  topLevelOnly?: boolean;
  assigneeId?: string;
  status?: Status;
  search?: string;
}

export async function listTasks(q: TaskQuery = {}): Promise<TaskFull[]> {
  const where: string[] = ['t.archived = ' + (q.archived ? 1 : 0)];
  const params: unknown[] = [];
  if (q.topLevelOnly) where.push('t.parent_id IS NULL');
  if (q.status) {
    where.push('t.status = ?');
    params.push(q.status);
  }
  if (q.assigneeId) {
    where.push(
      '(t.assignee_id = ? OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))'
    );
    params.push(q.assigneeId, q.assigneeId);
  }

  const rows = await many<Task>(
    `SELECT t.* FROM tasks t WHERE ${where.join(' AND ')} ORDER BY t.position, t.created_at DESC`,
    params
  );

  let tasks = await hydrateAll(rows);

  if (q.search && q.search.trim()) {
    const needle = q.search.trim().toLowerCase();
    tasks = tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        docToPlain(t.description).toLowerCase().includes(needle) ||
        String(t.seq).includes(needle) ||
        t.tags.some((tag) => tag.name.toLowerCase().includes(needle))
    );
  }
  return tasks;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  assigneeId?: string | null;
  parentId?: string | null;
  dueDate?: number | null;
  startDate?: number | null;
  estimate?: number | null;
  links?: { url: string; label?: string }[];
  tagIds?: string[];
}

export async function createTask(
  actor: User,
  input: CreateTaskInput,
  routedTo: string | null
): Promise<TaskFull> {
  const now = Date.now();
  const id = newId('t_');
  const assignee = input.assigneeId !== undefined ? input.assigneeId : routedTo;
  const title = input.title.trim() || 'Untitled';

  const [seq, maxPos] = await Promise.all([
    nextTaskSeq(),
    one<{ p: number }>('SELECT COALESCE(MAX(position), 0) AS p FROM tasks'),
  ]);

  await run(
    `INSERT INTO tasks
       (id, seq, title, description, status, priority, creator_id, assignee_id, parent_id,
        due_date, start_date, estimate, progress, position, archived, created_at, updated_at,
        submitted_at, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,0,?,?,NULL,NULL)`,
    [
      id, seq, title,
      input.description ?? '[]',
      input.status ?? 'TRIAGE',
      input.priority ?? 'MEDIUM',
      actor.id,
      assignee ?? null,
      input.parentId ?? null,
      input.dueDate ?? null,
      input.startDate ?? null,
      input.estimate ?? null,
      (maxPos?.p ?? 0) + 1000,
      now, now,
    ]
  );

  // Links and tags are independent of each other and of the activity log, so
  // they all go out at once instead of one blocking round trip per row.
  const links = (input.links ?? [])
    .map((link, i) => ({ ...link, url: normalizeUrl(link.url ?? ''), position: i }))
    // Drop unusable/unsafe links rather than reject the whole task.
    .filter((link) => link.url);

  await Promise.all([
    ...links.map((link) =>
      run('INSERT INTO task_links (id, task_id, url, label, position) VALUES (?,?,?,?,?)', [
        newId('l_'), id, link.url, (link.label ?? '').trim().slice(0, 120), link.position,
      ])
    ),
    ...(input.tagIds ?? []).map((tagId) =>
      run('INSERT INTO task_tags (task_id, tag_id) VALUES (?,?) ON CONFLICT DO NOTHING', [id, tagId])
    ),
    logActivity(id, actor.id, 'created', {}),
    ...(assignee && assignee !== actor.id
      ? [
          logActivity(id, actor.id, 'assigned', { to: assignee }),
          notify(assignee, actor.id, 'assigned', id, null, `${actor.name} assigned you "${title}"`),
        ]
      : []),
  ]);

  if (assignee && assignee !== actor.id) {
    void emailAssignment(actor, assignee, { id, seq, title });
  }
  publish({ type: 'task.created', taskId: id, actorId: actor.id });

  return (await getTask(id))!;
}

export type TaskPatch = Partial<{
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assignee_id: string | null;
  due_date: number | null;
  start_date: number | null;
  estimate: number | null;
  position: number;
  archived: number;
  parent_id: string | null;
}>;

const PATCHABLE = new Set([
  'title', 'description', 'status', 'priority', 'assignee_id',
  'due_date', 'start_date', 'estimate', 'position', 'archived', 'parent_id',
]);

const statusLabel = (s: Status) => s.replace('_', ' ').toLowerCase();

export async function updateTask(
  actor: User,
  id: string,
  patch: TaskPatch
): Promise<TaskFull | null> {
  const before = await one<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!before) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCHABLE.has(key) || value === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (!sets.length) return getTask(id);

  // Completion and submission timestamps follow the status transition.
  if (patch.status && patch.status !== before.status) {
    sets.push('completed_at = ?');
    params.push(patch.status === 'DONE' ? Date.now() : null);
    sets.push('submitted_at = ?');
    params.push(patch.status === 'SUBMITTED' ? Date.now() : null);
    // Approving means finished, whatever the last report claimed.
    if (patch.status === 'DONE') sets.push('progress = 100');
  }

  sets.push('updated_at = ?');
  params.push(Date.now(), id);
  await run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);

  if (patch.status && patch.status !== before.status) {
    await logActivity(id, actor.id, 'status', { from: before.status, to: patch.status });
    const msg = `${actor.name} moved "${before.title}" to ${statusLabel(patch.status)}`;
    if (before.assignee_id) await notify(before.assignee_id, actor.id, 'status', id, null, msg);
    // creator_id is null once that person has been removed from the workspace.
    if (before.creator_id && before.creator_id !== before.assignee_id) {
      await notify(before.creator_id, actor.id, 'status', id, null, msg);
    }
  }
  if (patch.assignee_id !== undefined && patch.assignee_id !== before.assignee_id) {
    await logActivity(id, actor.id, 'assigned', { from: before.assignee_id, to: patch.assignee_id });
    if (patch.assignee_id) {
      await notify(patch.assignee_id, actor.id, 'assigned', id, null,
        `${actor.name} assigned you "${before.title}"`);
      void emailAssignment(actor, patch.assignee_id, { id, seq: before.seq, title: before.title });
    }
  }
  if (patch.priority && patch.priority !== before.priority) {
    await logActivity(id, actor.id, 'priority', { from: before.priority, to: patch.priority });
  }
  if (patch.due_date !== undefined && patch.due_date !== before.due_date) {
    await logActivity(id, actor.id, 'due_date', { to: patch.due_date });
  }
  if (patch.archived === 1 && before.archived === 0) {
    await logActivity(id, actor.id, 'archived', {});
  }

  publish({ type: 'task.updated', taskId: id, actorId: actor.id });
  return getTask(id);
}

export async function deleteTask(id: string) {
  await run('DELETE FROM tasks WHERE id = ?', [id]);
  publish({ type: 'task.deleted', taskId: id });
}

/** Team Lead splits one task into several pieces, each handed to its own Dev. */
export async function splitTask(
  actor: User,
  parentId: string,
  pieces: { title: string; assigneeId: string | null; estimate?: number | null }[]
): Promise<TaskFull | null> {
  const parent = await one<Task>('SELECT * FROM tasks WHERE id = ?', [parentId]);
  if (!parent) return null;

  const base = await one<{ p: number }>(
    'SELECT COALESCE(MAX(position), 0) AS p FROM tasks WHERE parent_id = ?',
    [parentId]
  );
  const basePos = base?.p ?? 0;

  let created = 0;
  for (const [i, piece] of pieces.entries()) {
    if (!piece.title.trim()) continue;
    created += 1;

    const now = Date.now();
    const id = newId('t_');
    const seq = await nextTaskSeq();
    const title = piece.title.trim();

    await run(
      `INSERT INTO tasks (id, seq, title, description, status, priority, creator_id, assignee_id,
                          parent_id, due_date, estimate, progress, position, archived, created_at, updated_at)
       VALUES (?,?,?,'[]',?,?,?,?,?,?,?,0,?,0,?,?)`,
      [
        id, seq, title,
        piece.assigneeId ? 'TODO' : 'TRIAGE',
        parent.priority, actor.id, piece.assigneeId ?? null, parentId,
        parent.due_date, piece.estimate ?? null, basePos + (i + 1) * 1000, now, now,
      ]
    );

    if (piece.assigneeId) {
      await run(
        'INSERT INTO task_assignees (task_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING',
        [id, piece.assigneeId]
      );
      await notify(piece.assigneeId, actor.id, 'assigned', id, null,
        `${actor.name} assigned you "${title}" (split from "${parent.title}")`);
      void emailAssignment(actor, piece.assigneeId, { id, seq, title });
    }
    await logActivity(id, actor.id, 'created', { split_from: parentId });
  }

  if (!created) return getTask(parentId);

  await logActivity(parentId, actor.id, 'split', { count: created });
  // The parent becomes a container tracked through its children.
  await run(
    `UPDATE tasks SET status = CASE WHEN status = 'TRIAGE' THEN 'IN_PROGRESS' ELSE status END,
     updated_at = ? WHERE id = ?`,
    [Date.now(), parentId]
  );
  publish({ type: 'task.updated', taskId: parentId, actorId: actor.id });
  return getTask(parentId);
}

/* ------------------------------------------------------------------ */
/* Links & tags                                                        */
/* ------------------------------------------------------------------ */

export async function addLink(taskId: string, url: string, label: string): Promise<TaskLink> {
  const id = newId('l_');
  const pos = await one<{ p: number }>(
    'SELECT COALESCE(MAX(position), 0) AS p FROM task_links WHERE task_id = ?',
    [taskId]
  );
  await run('INSERT INTO task_links (id, task_id, url, label, position) VALUES (?,?,?,?,?)', [
    id, taskId, url, label, (pos?.p ?? 0) + 1,
  ]);
  return (await one<TaskLink>('SELECT * FROM task_links WHERE id = ?', [id]))!;
}

export async function getLink(id: string): Promise<TaskLink | null> {
  return one<TaskLink>('SELECT * FROM task_links WHERE id = ?', [id]);
}

export async function removeLink(id: string) {
  await run('DELETE FROM task_links WHERE id = ?', [id]);
}

export async function allTags(): Promise<Tag[]> {
  return many<Tag>('SELECT * FROM tags ORDER BY name');
}

export async function upsertTag(name: string, color: string): Promise<Tag> {
  const existing = await one<Tag>('SELECT * FROM tags WHERE name = ?', [name]);
  if (existing) return existing;
  const id = newId('g_');
  await run('INSERT INTO tags (id, name, color) VALUES (?,?,?)', [id, name, color]);
  return { id, name, color: color as Tag['color'] };
}

export async function setTaskTags(taskId: string, tagIds: string[]) {
  await run('DELETE FROM task_tags WHERE task_id = ?', [taskId]);
  for (const tagId of tagIds) {
    await run('INSERT INTO task_tags (task_id, tag_id) VALUES (?,?) ON CONFLICT DO NOTHING', [
      taskId, tagId,
    ]);
  }
}

/* ------------------------------------------------------------------ */
/* Comments & mentions                                                 */
/* ------------------------------------------------------------------ */

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

export async function listComments(taskId: string): Promise<Comment[]> {
  const rows = await many<Comment>(
    'SELECT * FROM comments WHERE task_id = ? ORDER BY created_at',
    [taskId]
  );
  if (!rows.length) return [];

  // One query for every comment's audio, not one query per comment.
  const [voiceRows, users] = await Promise.all([
    many<VoiceNote>(
      `SELECT ${VOICE_COLS} FROM voice_notes WHERE comment_id = ANY(?) ORDER BY created_at`,
      [rows.map((c) => c.id)]
    ),
    userCache(),
  ]);
  const voiceBy = groupBy(voiceRows, (v) => v.comment_id!);

  return rows.map((c) => ({
    ...c,
    author: users.get(c.author_id ?? '') ?? null,
    voice_notes: (voiceBy.get(c.id) ?? []).map((v) => ({
      ...v,
      author: users.get(v.author_id ?? '') ?? null,
    })),
  }));
}

export async function addComment(actor: User, taskId: string, body: string): Promise<Comment> {
  const id = newId('c_');
  const now = Date.now();
  await run(
    'INSERT INTO comments (id, task_id, author_id, body, resolved, created_at, updated_at) VALUES (?,?,?,?,0,?,?)',
    [id, taskId, actor.id, body, now, now]
  );

  const task = await one<{ seq: number; title: string; assignee_id: string | null; creator_id: string }>(
    'SELECT seq, title, assignee_id, creator_id FROM tasks WHERE id = ?',
    [taskId]
  );
  const title = task ? task.title : 'a task';

  const notified = new Set<string>([actor.id]);

  // Explicit @mentions take precedence over the implicit participant fan-out.
  for (const match of body.matchAll(MENTION_RE)) {
    const userId = match[2];
    if (notified.has(userId)) continue;
    notified.add(userId);
    await notify(userId, actor.id, 'mention', taskId, id, `${actor.name} mentioned you on "${title}"`);
    if (task) void emailMention(actor, userId, { id: taskId, seq: task.seq, title }, body);
  }
  for (const participant of [task?.assignee_id, task?.creator_id]) {
    if (!participant || notified.has(participant)) continue;
    notified.add(participant);
    await notify(participant, actor.id, 'comment', taskId, id, `${actor.name} commented on "${title}"`);
  }

  await logActivity(taskId, actor.id, 'commented', {});
  publish({ type: 'comment.added', taskId, actorId: actor.id });

  const row = (await one<Comment>('SELECT * FROM comments WHERE id = ?', [id]))!;
  return { ...row, author: actor, voice_notes: await listVoiceNotes({ commentId: id }) };
}

export async function getComment(id: string): Promise<Comment | null> {
  return one<Comment>('SELECT * FROM comments WHERE id = ?', [id]);
}

export async function deleteComment(id: string) {
  const row = await one<{ task_id: string }>('SELECT task_id FROM comments WHERE id = ?', [id]);
  await run('DELETE FROM comments WHERE id = ?', [id]);
  publish({ type: 'comment.removed', taskId: row?.task_id ?? null });
}

export async function setCommentResolved(id: string, resolved: boolean) {
  await run('UPDATE comments SET resolved = ?, updated_at = ? WHERE id = ?', [
    resolved ? 1 : 0, Date.now(), id,
  ]);
}

/* ------------------------------------------------------------------ */
/* Notifications & activity                                            */
/* ------------------------------------------------------------------ */

export async function notify(
  userId: string, actorId: string | null, type: string,
  taskId: string | null, commentId: string | null, message: string
) {
  if (userId === actorId) return;
  await run(
    `INSERT INTO notifications (id, user_id, actor_id, type, task_id, comment_id, message, read, created_at)
     VALUES (?,?,?,?,?,?,?,0,?)`,
    [newId('n_'), userId, actorId, type, taskId, commentId, message, Date.now()]
  );
  publish({ type: 'notification', taskId, userId, actorId });
}

export async function listNotifications(userId: string, limit = 60): Promise<Notification[]> {
  const rows = await many<Notification>(
    `SELECT n.*, t.title AS task_title, t.seq AS task_seq FROM notifications n
     LEFT JOIN tasks t ON t.id = n.task_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return Promise.all(rows.map(async (n) => ({ ...n, actor: await getUser(n.actor_id) })));
}

export async function markNotifications(userId: string, ids: string[] | 'all') {
  if (ids === 'all') {
    await run('UPDATE notifications SET read = 1 WHERE user_id = ?', [userId]);
    return;
  }
  for (const id of ids) {
    await run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
  }
}

export async function logActivity(
  taskId: string, actorId: string | null, type: string, meta: unknown
) {
  await run('INSERT INTO activity (id, task_id, actor_id, type, meta, created_at) VALUES (?,?,?,?,?,?)', [
    newId('a_'), taskId, actorId, type, JSON.stringify(meta ?? {}), Date.now(),
  ]);
}

export async function listActivity(taskId: string): Promise<ActivityItem[]> {
  const rows = await many<ActivityItem>(
    'SELECT * FROM activity WHERE task_id = ? ORDER BY created_at DESC LIMIT 100',
    [taskId]
  );
  const users = await userCache();
  return rows.map((a) => ({ ...a, actor: users.get(a.actor_id ?? '') ?? null }));
}

/* ------------------------------------------------------------------ */
/* Voice notes                                                         */
/* ------------------------------------------------------------------ */

const VOICE_COLS =
  'id, task_id, comment_id, author_id, mime, duration_ms, byte_size, created_at, ' +
  'transcript, transcript_lang, transcript_status';

export interface VoiceNoteQuery {
  taskId?: string;
  commentId?: string;
  /** Restrict to notes on the brief itself, excluding ones under comments. */
  onTaskOnly?: boolean;
}

/** Metadata only — the audio itself is streamed by getVoiceNoteData. */
export async function listVoiceNotes(q: VoiceNoteQuery): Promise<VoiceNote[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.taskId) { where.push('task_id = ?'); params.push(q.taskId); }
  if (q.commentId) { where.push('comment_id = ?'); params.push(q.commentId); }
  if (q.onTaskOnly) where.push('comment_id IS NULL');
  if (!where.length) return [];

  const rows = await many<VoiceNote>(
    `SELECT ${VOICE_COLS} FROM voice_notes WHERE ${where.join(' AND ')} ORDER BY created_at`,
    params
  );
  const users = await userCache();
  return rows.map((v) => ({ ...v, author: users.get(v.author_id ?? '') ?? null }));
}

export async function getVoiceNote(id: string): Promise<VoiceNote | null> {
  const row = await one<VoiceNote>(`SELECT ${VOICE_COLS} FROM voice_notes WHERE id = ?`, [id]);
  return row ? { ...row, author: await getUser(row.author_id) } : null;
}

export async function getVoiceNoteData(
  id: string
): Promise<{ mime: string; data: Uint8Array } | null> {
  return one<{ mime: string; data: Uint8Array }>(
    'SELECT mime, data FROM voice_notes WHERE id = ?',
    [id]
  );
}

export async function addVoiceNote(input: {
  taskId: string;
  commentId: string | null;
  authorId: string;
  mime: string;
  durationMs: number;
  data: Buffer;
}): Promise<VoiceNote> {
  const id = newId('v_');
  await run(
    `INSERT INTO voice_notes (id, task_id, comment_id, author_id, mime, duration_ms, byte_size, data, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id, input.taskId, input.commentId, input.authorId, input.mime,
      Math.max(0, Math.round(input.durationMs)), input.data.byteLength, input.data, Date.now(),
    ]
  );
  publish({ type: 'voice.added', taskId: input.taskId, actorId: input.authorId });
  return (await getVoiceNote(id))!;
}

export async function deleteVoiceNote(id: string) {
  const row = await one<{ task_id: string }>('SELECT task_id FROM voice_notes WHERE id = ?', [id]);
  await run('DELETE FROM voice_notes WHERE id = ?', [id]);
  publish({ type: 'voice.removed', taskId: row?.task_id ?? null });
}

/* ---------- transcription ---------- */

/**
 * Claims a note for transcription so two browsers opening the same task at
 * once don't both spend CPU (and, for the uploader, mobile battery)
 * transcribing the same recording. `RETURNING id` doubles as the "did this
 * actually match a row" check — no separate rowcount plumbing needed.
 */
export async function claimVoiceTranscription(id: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `UPDATE voice_notes SET transcript_status = 'pending'
     WHERE id = ? AND transcript_status IN ('none', 'failed')
     RETURNING id`,
    [id]
  );
  return !!row;
}

export async function setVoiceTranscript(
  id: string,
  patch: { status: 'done'; transcript: string; lang: string | null } | { status: 'failed' | 'none' }
): Promise<VoiceNote | null> {
  if (patch.status === 'done') {
    await run(
      'UPDATE voice_notes SET transcript_status = ?, transcript = ?, transcript_lang = ? WHERE id = ?',
      ['done', patch.transcript.slice(0, 8000), patch.lang, id]
    );
  } else {
    await run('UPDATE voice_notes SET transcript_status = ? WHERE id = ?', [patch.status, id]);
  }

  const note = await getVoiceNote(id);
  if (note) publish({ type: 'voice.transcribed', taskId: note.task_id, actorId: note.author_id });
  return note;
}

/* ------------------------------------------------------------------ */
/* Progress reports & the review workflow                              */
/* ------------------------------------------------------------------ */

const PROGRESS_COLS =
  'id, task_id, author_id, kind, percent, done_summary, remaining, blockers, hours_spent, created_at';

export async function listProgressUpdates(taskId: string): Promise<ProgressUpdate[]> {
  const rows = await many<ProgressUpdate>(
    `SELECT ${PROGRESS_COLS} FROM progress_updates WHERE task_id = ? ORDER BY created_at DESC`,
    [taskId]
  );
  const users = await userCache();
  return rows.map((r) => ({ ...r, author: users.get(r.author_id ?? '') ?? null }));
}

export interface ProgressInput {
  percent?: number;
  doneSummary?: string;
  remaining?: string;
  blockers?: string;
  hoursSpent?: number | null;
}

const clampPercent = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

export async function addProgressUpdate(
  actor: User,
  taskId: string,
  kind: ProgressKind,
  input: ProgressInput
): Promise<ProgressUpdate> {
  const id = newId('p_');
  const percent = clampPercent(input.percent);

  await run(
    `INSERT INTO progress_updates
       (id, task_id, author_id, kind, percent, done_summary, remaining, blockers, hours_spent, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id, taskId, actor.id, kind, percent,
      (input.doneSummary ?? '').trim().slice(0, 4000),
      (input.remaining ?? '').trim().slice(0, 4000),
      (input.blockers ?? '').trim().slice(0, 2000),
      input.hoursSpent ?? null,
      Date.now(),
    ]
  );

  // A reviewer's verdict must not rewrite the developer's own percentage.
  if (kind === 'update' || kind === 'submitted') {
    await run('UPDATE tasks SET progress = ?, updated_at = ? WHERE id = ?', [
      percent, Date.now(), taskId,
    ]);
  }

  await logActivity(taskId, actor.id, `progress_${kind}`, { percent });
  publish({ type: 'progress.added', taskId, actorId: actor.id });

  // A plain update (as opposed to a submission, which has its own review
  // notice) is still something leads should hear about without polling.
  if (kind === 'update') {
    const task = await one<{ seq: number; title: string }>(
      'SELECT seq, title FROM tasks WHERE id = ?',
      [taskId]
    );
    if (task) void emailProgressPosted(actor, { id: taskId, seq: task.seq, title: task.title });
  }

  const row = (await one<ProgressUpdate>(
    `SELECT ${PROGRESS_COLS} FROM progress_updates WHERE id = ?`,
    [id]
  ))!;
  return { ...row, author: actor };
}

/** Dev hands the task to a lead. Nobody but a reviewer can close it. */
export async function submitForReview(
  actor: User,
  taskId: string,
  input: ProgressInput
): Promise<TaskFull | null> {
  const task = await one<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return null;

  await addProgressUpdate(actor, taskId, 'submitted', { ...input, percent: input.percent ?? 100 });
  await updateTask(actor, taskId, { status: 'SUBMITTED' });

  const reviewers = await many<{ id: string }>(
    `SELECT id FROM users WHERE role IN ('TEAM_LEAD','CEO')`
  );
  for (const r of reviewers) {
    await notify(r.id, actor.id, 'review_requested', taskId, null,
      `${actor.name} submitted "${task.title}" for review`);
  }
  void emailReviewRequested(actor, { id: taskId, seq: task.seq, title: task.title });

  return getTask(taskId);
}

export async function approveSubmission(
  actor: User,
  taskId: string,
  note: string
): Promise<TaskFull | null> {
  const task = await one<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return null;

  await addProgressUpdate(actor, taskId, 'approved', { percent: 100, doneSummary: note });
  await updateTask(actor, taskId, { status: 'DONE' });

  if (task.assignee_id) {
    await notify(task.assignee_id, actor.id, 'approved', taskId, null,
      `${actor.name} approved "${task.title}" — it is done`);
    void emailTaskDone(actor, task.assignee_id, { id: taskId, seq: task.seq, title: task.title });
  }
  if (task.creator_id && task.creator_id !== task.assignee_id) {
    await notify(task.creator_id, actor.id, 'approved', taskId, null,
      `${actor.name} approved "${task.title}"`);
  }

  return getTask(taskId);
}

export async function requestChanges(
  actor: User,
  taskId: string,
  note: string
): Promise<TaskFull | null> {
  const task = await one<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return null;

  await addProgressUpdate(actor, taskId, 'changes_requested', {
    percent: task.progress,
    remaining: note,
  });
  await updateTask(actor, taskId, { status: 'CHANGES_REQUESTED' });

  if (task.assignee_id) {
    await notify(task.assignee_id, actor.id, 'changes_requested', taskId, null,
      `${actor.name} asked for changes on "${task.title}"`);
  }

  return getTask(taskId);
}

/* ------------------------------------------------------------------ */
/* Developer task sheet                                                */
/* ------------------------------------------------------------------ */

interface SheetRow extends Task {
  parent_title: string | null;
  comment_count: number;
  assigned_by: string | null;
}

async function toSheetEntry(row: SheetRow): Promise<SheetEntry> {
  const turnaround = row.completed_at ? row.completed_at - row.created_at : null;
  const onTime =
    row.completed_at && row.due_date ? row.completed_at <= row.due_date + 86_400_000 : null;

  return {
    id: row.id,
    seq: row.seq,
    title: row.title,
    status: row.status,
    priority: row.priority,
    parent_title: row.parent_title,
    tags: await many<Tag>(
      'SELECT t.* FROM tags t JOIN task_tags tt ON tt.tag_id = t.id WHERE tt.task_id = ? ORDER BY t.name',
      [row.id]
    ),
    created_at: row.created_at,
    completed_at: row.completed_at,
    due_date: row.due_date,
    turnaround_ms: turnaround,
    on_time: onTime,
    comment_count: row.comment_count,
    assigned_by: row.assigned_by,
  };
}

export async function taskSheet(userId: string): Promise<TaskSheet | null> {
  const user = await getUser(userId);
  if (!user) return null;

  const rows = await many<SheetRow>(
    `SELECT t.*,
            (SELECT p.title FROM tasks p WHERE p.id = t.parent_id)                   AS parent_title,
            (SELECT COUNT(*)::int FROM comments c WHERE c.task_id = t.id)            AS comment_count,
            (SELECT u.name FROM users u WHERE u.id = (
               SELECT a.actor_id FROM activity a
               WHERE a.task_id = t.id AND a.type = 'assigned'
               ORDER BY a.created_at DESC LIMIT 1))                                  AS assigned_by
     FROM tasks t
     WHERE t.archived = 0
       AND (t.assignee_id = ?
            OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?))
     ORDER BY COALESCE(t.completed_at, t.updated_at) DESC`,
    [userId, userId]
  );

  const entries = await Promise.all(rows.map(toSheetEntry));
  const completed = entries.filter((e) => e.status === 'DONE');
  const active = entries.filter((e) => e.status !== 'DONE');

  const now = Date.now();
  const since = (days: number) => now - days * 86_400_000;

  const rated = completed.filter((e) => e.on_time !== null);
  const turnarounds = completed
    .map((e) => e.turnaround_ms)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  return {
    user,
    completed,
    active,
    stats: {
      completed_total: completed.length,
      completed_7d: completed.filter((e) => (e.completed_at ?? 0) >= since(7)).length,
      completed_30d: completed.filter((e) => (e.completed_at ?? 0) >= since(30)).length,
      active_total: active.length,
      overdue: active.filter((e) => e.due_date !== null && e.due_date < now).length,
      on_time_rate: rated.length ? rated.filter((e) => e.on_time).length / rated.length : null,
      median_turnaround_ms: turnarounds.length ? turnarounds[Math.floor(turnarounds.length / 2)] : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Outbound email                                                      */
/* ------------------------------------------------------------------ */

/**
 * Tells a developer work has landed on them. Fire-and-forget: the assignment is
 * already committed, so a mail failure must not surface as a failed request.
 */
export async function emailAssignment(
  actor: User,
  assigneeId: string,
  task: { id: string; seq: number; title: string }
) {
  if (assigneeId === actor.id) return;
  const assignee = await getUser(assigneeId);
  if (!assignee) return;

  await sendMail({
    to: assignee.email,
    subject: `${actor.name} assigned you TSK-${task.seq}: ${task.title}`,
    heading: 'A task was assigned to you',
    body: `${actor.name} assigned you "${task.title}" (TSK-${task.seq}).\n\nOpen it to see the brief, report progress, and submit it for review when it is ready.`,
    action: { label: 'Open the task', url: `${appUrl}/workspace?task=${task.id}` },
    footer: 'You are receiving this because the task was assigned to you in Flow.',
  });
}

/** Anyone @mentioned in a comment gets an email — regardless of their role. */
export async function emailMention(
  actor: User,
  userId: string,
  task: { id: string; seq: number; title: string },
  commentBody: string
) {
  if (userId === actor.id) return;
  const target = await getUser(userId);
  if (!target) return;

  const plain = commentBody.replace(MENTION_RE, (_m, name: string) => `@${name}`).trim();

  await sendMail({
    to: target.email,
    subject: `${actor.name} mentioned you on TSK-${task.seq}: ${task.title}`,
    heading: 'You were mentioned',
    body: `${actor.name} mentioned you on "${task.title}" (TSK-${task.seq}):\n\n"${plain}"`,
    action: { label: 'Open the task', url: `${appUrl}/workspace?task=${task.id}` },
    footer: 'You are receiving this because you were mentioned in a comment on Flow.',
  });
}

/** Every Team Lead/CEO gets word the moment a developer submits work or reports progress. */
async function emailLeads(
  actor: User,
  task: { id: string; seq: number; title: string },
  subject: string,
  heading: string,
  body: string
) {
  const leads = await many<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE role IN ('TEAM_LEAD','CEO')`
  );
  await Promise.all(
    leads
      .filter((l) => l.id !== actor.id)
      .map((l) =>
        sendMail({
          to: l.email,
          subject,
          heading,
          body,
          action: { label: 'Review the task', url: `${appUrl}/workspace?task=${task.id}` },
          footer: 'You are receiving this because you can review work in Flow.',
        })
      )
  );
}

/** A developer submitted a task and is waiting on a Team Lead/CEO to review it. */
export async function emailReviewRequested(actor: User, task: { id: string; seq: number; title: string }) {
  await emailLeads(
    actor,
    task,
    `${actor.name} submitted TSK-${task.seq} for review`,
    'A task is waiting on your review',
    `${actor.name} submitted "${task.title}" (TSK-${task.seq}) for review.\n\nTake a look and either approve it or send it back with changes.`
  );
}

/** A developer posted a progress update (without submitting) — leads should still see it. */
export async function emailProgressPosted(actor: User, task: { id: string; seq: number; title: string }) {
  await emailLeads(
    actor,
    task,
    `${actor.name} posted an update on TSK-${task.seq}`,
    'A task got a progress update',
    `${actor.name} posted a progress update on "${task.title}" (TSK-${task.seq}).`
  );
}

/** The assignee finds out their submitted work was approved and the task is done. */
export async function emailTaskDone(actor: User, assigneeId: string, task: { id: string; seq: number; title: string }) {
  if (assigneeId === actor.id) return;
  const assignee = await getUser(assigneeId);
  if (!assignee) return;

  await sendMail({
    to: assignee.email,
    subject: `${actor.name} approved TSK-${task.seq}: ${task.title}`,
    heading: 'Your task was approved',
    body: `${actor.name} approved "${task.title}" (TSK-${task.seq}) — it is done.`,
    action: { label: 'Open the task', url: `${appUrl}/workspace?task=${task.id}` },
    footer: 'You are receiving this because you were the assignee on this task in Flow.',
  });
}

/* ------------------------------------------------------------------ */
/* Password reset                                                      */
/* ------------------------------------------------------------------ */

const RESET_TTL_MS = 1000 * 60 * 60; // one hour

export async function createPasswordReset(
  email: string
): Promise<{ user: User; token: string } | null> {
  const user = await getUserByEmail(email);
  if (!user) return null;

  const token = newId('r_') + newId('');

  // Any older link for this person stops working the moment a new one is made.
  await run('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
  await run(
    'INSERT INTO password_resets (token, user_id, expires_at, used_at, created_at) VALUES (?,?,?,NULL,?)',
    [token, user.id, Date.now() + RESET_TTL_MS, Date.now()]
  );

  return { user, token };
}

export async function consumePasswordReset(token: string, passwordHash: string): Promise<boolean> {
  const row = await one<{ user_id: string; expires_at: number; used_at: number | null }>(
    'SELECT user_id, expires_at, used_at FROM password_resets WHERE token = ?',
    [token]
  );
  if (!row || row.used_at || row.expires_at < Date.now()) return false;

  await tx(async (t) => {
    await t.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, row.user_id]);
    await t.run('UPDATE password_resets SET used_at = ? WHERE token = ?', [Date.now(), token]);
    // Changing a password signs every existing session out.
    await t.run('DELETE FROM sessions WHERE user_id = ?', [row.user_id]);
  });

  return true;
}

/* ------------------------------------------------------------------ */
/* Offboarding                                                         */
/* ------------------------------------------------------------------ */

export interface RemovalSummary {
  name: string;
  email: string;
  /** Open tasks that were handed back to a Team Lead. */
  reassigned: number;
}

/**
 * Removes someone who has left, without erasing what they did.
 *
 * Their open work is routed back to a Team Lead rather than silently
 * disappearing, and the account row is deleted. Foreign keys are ON DELETE SET
 * NULL for authorship, so their tasks, comments, recordings and progress
 * reports all survive and simply read "Removed user".
 */
export async function removeUser(actor: User, targetId: string): Promise<RemovalSummary | null> {
  const target = await getUser(targetId);
  if (!target) return null;

  // Hand back anything still open so no work is orphaned by the departure.
  const open = await many<{ id: string; title: string }>(
    `SELECT id, title FROM tasks
     WHERE assignee_id = ? AND status != 'DONE' AND archived = 0`,
    [targetId]
  );

  const lead = await one<{ id: string }>(
    `SELECT id FROM users WHERE role = 'TEAM_LEAD' AND id != ?
     ORDER BY created_at ASC LIMIT 1`,
    [targetId]
  );
  const fallback = lead?.id ?? (actorCanHold(actor) ? actor.id : null);

  for (const task of open) {
    await run(
      `UPDATE tasks SET assignee_id = ?, status = 'TRIAGE', updated_at = ? WHERE id = ?`,
      [fallback, Date.now(), task.id]
    );
    await logActivity(task.id, actor.id, 'reassigned_on_offboard', {
      from: target.name,
      reason: 'account removed',
    });
    if (fallback && fallback !== actor.id) {
      await notify(fallback, actor.id, 'assigned', task.id, null,
        `"${task.title}" came back to triage — ${target.name} was removed from the workspace`);
    }
  }

  await run('DELETE FROM users WHERE id = ?', [targetId]);
  invalidateUserCache();
  publish({ type: 'task.updated', taskId: null, actorId: actor.id });

  return { name: target.name, email: target.email, reassigned: open.length };
}

/** A Lead or the CEO can hold triage; a Manager cannot. */
const actorCanHold = (u: User) => u.role === 'TEAM_LEAD' || u.role === 'CEO';

export async function countByRole(role: string): Promise<number> {
  const row = await one<{ c: number }>('SELECT COUNT(*)::int AS c FROM users WHERE role = ?', [role]);
  return row?.c ?? 0;
}
