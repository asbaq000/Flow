'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity as ActivityIcon, Archive, ArrowUpRight, Check, ChevronRight, Clock, ExternalLink,
  CalendarDays, FileText, GitBranch, Link2, Loader2, Mic, MoreHorizontal, Pencil, Plus, Split,
  Trash2, UserRound, X,
} from 'lucide-react';
import type { ActivityItem, Block, Comment, Tag, TaskFull, User } from '@/lib/types';
import { TAG_COLORS, parseDoc } from '@/lib/types';
import { isAssignableRole } from '@/lib/permissions';
import type { TaskAbilities } from '@/lib/permissions';
import { api, serializeDoc } from '@/lib/client';
import { useLiveEvents } from '@/lib/useLiveEvents';
import { Avatar, Empty, Popover, PriorityPicker, StatusBadge, StatusPicker, TagChip, UserPicker, roleShort } from './ui';
import BlockEditor from './BlockEditor';
import CommentThread from './CommentThread';
import ProgressPanel from './ProgressPanel';
import { VoiceNoteList, VoiceRecorder } from './VoiceNotes';
import { autoTranscribe, useTranscriber } from '@/lib/useTranscriber';
import { formatDateTime, fromDateInput, timeAgo, toDateInput } from './views/shared';

type Tab = 'description' | 'links' | 'activity';

interface Props {
  taskId: string;
  me: User;
  users: User[];
  tags: Tag[];
  /** Bumped by the workspace after an out-of-band change (e.g. a split) to force a reload. */
  reloadToken?: number;
  onClose: () => void;
  onChanged: (task: TaskFull) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
  onSplit: (task: TaskFull) => void;
  onOpenTask: (id: string) => void;
  onTagCreated: (tag: Tag) => void;
}

export default function TaskPanel({
  taskId, me, users, tags, reloadToken = 0, onClose, onChanged, onArchive, onDelete, onSplit, onOpenTask, onTagCreated,
}: Props) {
  const [task, setTask] = useState<TaskFull | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [abilities, setAbilities] = useState<TaskAbilities | null>(null);
  // Only people on this task may be @mentioned — see /api/tasks/[id]/members.
  const [members, setMembers] = useState<User[]>([]);
  const [tab, setTab] = useState<Tab>('description');
  const [doc, setDoc] = useState<Block[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [editingDesc, setEditingDesc] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  /* ---------- load ---------- */

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.tasks.get(taskId);
      setTask(data.task);
      setComments(data.comments);
      setActivity(data.activity);
      setAbilities(data.abilities);
      setDoc(parseDoc(data.task.description));
      try {
        const { members: m } = await api.tasks.members(taskId);
        setMembers(m);
      } catch {
        // Non-fatal: the composer just offers nobody rather than everybody.
        setMembers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load task');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
    // reloadToken is a deliberate trigger, not data the loader reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, reloadToken]);

  // Opening a different task always starts back in read-only mode.
  useEffect(() => setEditingDesc(false), [taskId]);

  /**
   * Live refresh of the collaborative parts of the panel. Deliberately does
   * NOT touch the title or description: overwriting those from the server
   * while someone is mid-sentence would destroy their typing.
   */
  const refreshCollab = useCallback(async () => {
    try {
      const [{ comments: freshComments }, { activity: freshActivity }, { updates }] =
        await Promise.all([
          api.comments.list(taskId),
          api.activity.list(taskId),
          api.progress.list(taskId),
        ]);
      setComments(freshComments);
      setActivity(freshActivity);
      setTask((prev) => (prev ? { ...prev, progress_updates: updates } : prev));
    } catch {
      /* transient — the next event or the fallback interval retries */
    }
  }, [taskId]);

  /** Status, assignee and progress can change under you; the brief cannot. */
  const refreshTaskMeta = useCallback(async () => {
    try {
      const fresh = await api.tasks.get(taskId);
      setAbilities(fresh.abilities);
      setTask((prev) =>
        prev
          ? { ...fresh.task, title: prev.title, description: prev.description }
          : fresh.task
      );
    } catch {
      /* ignore */
    }
  }, [taskId]);

  useLiveEvents(
    useCallback(
      (event) => {
        if (event.taskId && event.taskId !== taskId) return;
        if (event.type === 'comment.added' || event.type === 'comment.removed' ||
            event.type === 'progress.added' || event.type === 'voice.added' ||
            event.type === 'voice.removed' || event.type === 'voice.transcribed') {
          refreshCollab();
        }
        if (event.type === 'task.updated' || event.type === 'progress.added' ||
            // task.voice_notes (the brief's own recordings, as opposed to a
            // comment's) only comes back from this call — refreshCollab alone
            // would leave a note added or transcribed by someone else stuck
            // on stale data.
            event.type === 'voice.added' || event.type === 'voice.removed' ||
            event.type === 'voice.transcribed') {
          refreshTaskMeta();
        }
      },
      [taskId, refreshCollab, refreshTaskMeta]
    )
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Escape' && !t.isContentEditable && t.tagName !== 'INPUT') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* ---------- persistence ---------- */

  const patch = useCallback(
    async (body: Parameters<typeof api.tasks.update>[1]) => {
      if (!task) return;
      setError('');
      try {
        const { task: updated } = await api.tasks.update(task.id, body);
        setTask(updated);
        onChanged(updated);
        const fresh = await api.tasks.get(task.id);
        setActivity(fresh.activity);
        setAbilities(fresh.abilities);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save');
        load();
      }
    },
    [task, onChanged, load]
  );

  /** Description autosaves 700ms after typing stops. */
  const onDocChange = useCallback(
    (blocks: Block[]) => {
      setDoc(blocks);
      setSaveState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (!task) return;
        try {
          const { task: updated } = await api.tasks.update(task.id, { description: serializeDoc(blocks) });
          setTask(updated);
          onChanged(updated);
          setSaveState('saved');
          setTimeout(() => setSaveState('idle'), 1600);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save description');
          setSaveState('idle');
        }
      }, 700);
    },
    [task, onChanged]
  );

  useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), []);

  const autoGrow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    autoGrow(titleRef.current);
  }, [task?.title, loading]);

  /* ---------- derived ---------- */

  const doneSubs = task?.subtasks.filter((s) => s.status === 'DONE').length ?? 0;
  const canEdit = abilities?.edit ?? false;

  // Work only ever flows down to Developers, so they are the only choices offered.
  const assignableUsers = useMemo(() => users.filter((u) => isAssignableRole(u.role)), [users]);

  const { transcribe } = useTranscriber();

  const uploadTaskVoice = useCallback(
    async (blob: Blob, durationMs: number) => {
      if (!task) return;
      const { voiceNote } = await api.voice.upload(task.id, blob, durationMs);
      void autoTranscribe(voiceNote.id, blob, transcribe);
      await load();
    },
    [task, load, transcribe]
  );

  const removeVoice = useCallback(
    async (id: string) => {
      await api.voice.remove(id);
      await load();
    },
    [load]
  );

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = useMemo(
    () => [
      { id: 'description', label: 'Description', icon: <FileText size={13} /> },
      { id: 'links', label: 'Links', icon: <Link2 size={13} />, count: task?.links.length },
      { id: 'activity', label: 'Activity', icon: <ActivityIcon size={13} />, count: activity.length },
    ],
    [task?.links.length, activity.length]
  );

  /* ---------- render ---------- */

  return (
    <>
      <div className="animate-fade fixed inset-0 z-30 bg-black/25 lg:hidden" onClick={onClose} />

      <aside
        className="animate-slide fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l sm:max-w-[640px] lg:static lg:z-auto lg:max-w-[560px] xl:max-w-[680px]"
        style={{ background: 'var(--bg)' }}
      >
        {loading || !task ? (
          <div className="grid h-full place-items-center text-[var(--text-tertiary)]">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* ---- header ---- */}
            <header className="flex h-[46px] shrink-0 items-center gap-2 border-b px-3">
              <button onClick={onClose} className="btn btn-ghost px-1.5" aria-label="Close panel">
                <X size={16} />
              </button>

              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
                {task.parent_id && task.parent_title && (
                  <>
                    <button
                      onClick={() => onOpenTask(task.parent_id!)}
                      className="max-w-[180px] truncate rounded px-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                    >
                      {task.parent_title}
                    </button>
                    <ChevronRight size={12} />
                  </>
                )}
                <span className="font-medium">TSK-{task.seq}</span>
              </div>

              {saveState !== 'idle' && (
                <span className="flex items-center gap-1 text-[11.5px] text-[var(--text-tertiary)]">
                  {saveState === 'saving' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  {saveState === 'saving' ? 'Saving…' : 'Saved'}
                </span>
              )}

              {abilities?.split && !task.subtasks.length && (
                <button onClick={() => onSplit(task)} className="btn btn-outline py-1 text-[12.5px]">
                  <Split size={13} /> Split
                </button>
              )}

              <Popover
                width={190}
                align="end"
                trigger={({ toggle }) => (
                  <button onClick={toggle} className="btn btn-outline px-1.5" aria-label="More actions" title="More actions">
                    <MoreHorizontal size={16} />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    {abilities?.archive && (
                      <button
                        className="menu-item"
                        onClick={() => {
                          onArchive(task.id, task.archived === 0);
                          close();
                        }}
                      >
                        <Archive size={14} /> {task.archived ? 'Restore' : 'Archive'}
                      </button>
                    )}
                    {abilities?.delete && (
                      <button
                        className="menu-item btn-danger"
                        onClick={() => {
                          if (confirm(`Delete "${task.title}" permanently? This cannot be undone.`)) {
                            onDelete(task.id);
                          }
                          close();
                        }}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                    {!abilities?.archive && !abilities?.delete && (
                      <div className="px-2 py-2 text-[12.5px] text-[var(--text-tertiary)]">
                        No actions available to you
                      </div>
                    )}
                  </>
                )}
              </Popover>
            </header>

            {/* ---- scroll body ---- */}
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <div className="safe-b px-4 pb-8 pt-5 sm:px-8">
                {/* title */}
                <textarea
                  ref={titleRef}
                  value={task.title}
                  readOnly={!editingDesc}
                  rows={1}
                  onChange={(e) => {
                    setTask({ ...task, title: e.target.value });
                    autoGrow(e.target);
                  }}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== task.title) patch({ title: next });
                    else if (!next) load();
                  }}
                  className="w-full resize-none overflow-hidden bg-transparent text-[27px] font-bold leading-tight tracking-tight outline-none placeholder:text-[var(--text-tertiary)]"
                  placeholder="Untitled"
                  aria-label="Task title"
                />

                {error && (
                  <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                  </div>
                )}

                {/* properties */}
                <dl className="mt-4 space-y-0.5">
                  <Prop label="Status" icon={<Clock size={13} />}>
                    <StatusPicker
                      value={task.status}
                      disabled={!abilities?.status}
                      allowed={abilities?.allowedStatuses}
                      onChange={(status) => patch({ status })}
                    />
                  </Prop>

                  <Prop label="Assignee" icon={<UserRound size={13} />}>
                    <UserPicker
                      users={assignableUsers}
                      value={task.assignee_id}
                      disabled={!abilities?.assign}
                      onChange={(assigneeId) => patch({ assigneeId })}
                      label="Assign to a developer"
                      pinned={task.assignee && !isAssignableRole(task.assignee.role) ? [task.assignee] : []}
                    />
                  </Prop>

                  <Prop label="Priority" icon={<ArrowUpRight size={13} />}>
                    <PriorityPicker
                      value={task.priority}
                      disabled={!abilities?.priority}
                      onChange={(priority) => patch({ priority })}
                    />
                  </Prop>

                  <Prop label="Due date" icon={<CalendarDays size={13} />}>
                    <input
                      type="date"
                      aria-label="Due date"
                      value={toDateInput(task.due_date)}
                      disabled={!canEdit}
                      onChange={(e) => patch({ dueDate: fromDateInput(e.target.value) })}
                      className="rounded px-1 py-0.5 text-[13px] outline-none hover:bg-[var(--bg-hover)] disabled:cursor-default"
                      style={{ background: 'transparent', color: task.due_date ? 'var(--text)' : 'var(--text-tertiary)' }}
                    />
                  </Prop>

                  <Prop label="Tags" icon={<span className="text-[13px]">#</span>}>
                    <TagEditor
                      task={task}
                      allTags={tags}
                      disabled={!canEdit}
                      onChange={(tagIds) => patch({ tagIds })}
                      onCreated={onTagCreated}
                    />
                  </Prop>

                  <Prop label="Raised by" icon={<UserRound size={13} />}>
                    <span className="inline-flex items-center gap-1.5 px-1 text-[13px]">
                      <Avatar user={task.creator} size="xs" />
                      {task.creator?.name ?? 'Unknown'}
                      <span className="text-[11.5px] text-[var(--text-tertiary)]">
                        {task.creator ? roleShort(task.creator.role) : ''} · {timeAgo(task.created_at)}
                      </span>
                    </span>
                  </Prop>
                </dl>

                {/* subtasks */}
                {task.subtasks.length > 0 && (
                  <section className="mt-6">
                    <header className="mb-2 flex items-center gap-2">
                      <GitBranch size={14} className="text-[var(--text-secondary)]" />
                      <h3 className="text-[13px] font-semibold">Split into {task.subtasks.length} pieces</h3>
                      <span className="text-[11.5px] text-[var(--text-tertiary)]">{doneSubs} done</span>
                      <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full" style={{ background: 'var(--bg-active)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(doneSubs / task.subtasks.length) * 100}%`,
                            background: doneSubs === task.subtasks.length ? '#10b981' : 'var(--accent)',
                          }}
                        />
                      </div>
                    </header>
                    <div className="overflow-hidden rounded-md border">
                      {task.subtasks.map((sub, i) => (
                        <button
                          key={sub.id}
                          onClick={() => onOpenTask(sub.id)}
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] ${i === task.subtasks.length - 1 ? '' : 'border-b'}`}
                        >
                          <StatusBadge status={sub.status} compact />
                          <span className={`min-w-0 flex-1 truncate text-[13px] ${sub.status === 'DONE' ? 'text-[var(--text-tertiary)] line-through' : ''}`}>
                            {sub.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">TSK-{sub.seq}</span>
                          <Avatar user={sub.assignee} size="xs" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* tabs */}
                <div className="mt-6 flex items-center gap-1 border-b">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className="-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[13px] transition-colors"
                      style={{
                        borderColor: tab === t.id ? 'var(--text)' : 'transparent',
                        color: tab === t.id ? 'var(--text)' : 'var(--text-secondary)',
                        fontWeight: tab === t.id ? 600 : 400,
                      }}
                    >
                      {t.icon}
                      {t.label}
                      {!!t.count && (
                        <span className="rounded bg-[var(--bg-active)] px-1 text-[10.5px] text-[var(--text-secondary)]">
                          {t.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="mt-3 min-h-[140px]">
                  {tab === 'description' && (
                    <>
                      {/* The brief stays read-only until you pick up the pencil. */}
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        {canEdit ? (
                          editingDesc ? (
                            <button onClick={() => setEditingDesc(false)} className="btn btn-primary py-1 text-[12.5px]">
                              <Check size={13} /> Done
                            </button>
                          ) : (
                            <button
                              onClick={() => setEditingDesc(true)}
                              className="btn btn-outline py-1 text-[12.5px]"
                              title="Edit the title and description"
                            >
                              <Pencil size={13} /> Edit
                            </button>
                          )
                        ) : (
                          <span className="text-[12px] text-[var(--text-tertiary)]">
                            Read-only — only the person who raised this or a Team Lead can edit the brief.
                          </span>
                        )}

                        {abilities?.delete && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete "${task.title}" permanently? This cannot be undone.`)) {
                                onDelete(task.id);
                              }
                            }}
                            className="btn btn-danger-solid py-1 text-[12.5px]"
                            title="Delete this task"
                          >
                            <Trash2 size={13} /> Delete
                          </button>
                        )}
                        {!abilities?.delete && abilities?.archive && (
                          <button
                            onClick={() => onArchive(task.id, task.archived === 0)}
                            className="btn btn-outline py-1 text-[12.5px]"
                            title={task.archived ? 'Restore this task' : 'Archive this task'}
                          >
                            <Archive size={13} /> {task.archived ? 'Restore' : 'Archive'}
                          </button>
                        )}

                        {editingDesc && (
                          <span className="ml-auto text-[11.5px] text-[var(--text-tertiary)]">
                            Saves as you type
                          </span>
                        )}
                      </div>

                      <div
                        className="rounded-md transition-colors"
                        style={{
                          background: editingDesc ? 'var(--bg-subtle)' : 'transparent',
                          padding: editingDesc ? '8px 10px' : 0,
                          border: `1px solid ${editingDesc ? 'var(--border)' : 'transparent'}`,
                        }}
                      >
                        <BlockEditor
                          value={doc}
                          onChange={onDocChange}
                          editable={editingDesc}
                          placeholder={
                            editingDesc
                              ? "Describe the task in detail. Type '/' for headings, checklists, code…"
                              : 'No description was added.'
                          }
                        />
                      </div>

                      <section className="mt-5 border-t pt-4">
                        <header className="mb-2 flex items-center gap-2">
                          <Mic size={14} className="text-[var(--text-secondary)]" />
                          <h3 className="text-[13px] font-semibold">Voice notes</h3>
                          <span className="text-[11.5px] text-[var(--text-tertiary)]">{task.voice_notes.length}</span>
                          {abilities?.voiceOnTask && (
                            <div className="ml-auto">
                              <VoiceRecorder onRecorded={uploadTaskVoice} label="Record" />
                            </div>
                          )}
                        </header>
                        <VoiceNoteList
                          notes={task.voice_notes}
                          me={me}
                          onDelete={removeVoice}
                          onTranscriptChange={refreshTaskMeta}
                          emptyHint={
                            abilities?.voiceOnTask
                              ? 'Nothing recorded yet. Explain it out loud when typing is slower.'
                              : 'No voice notes on this task.'
                          }
                        />
                      </section>
                    </>
                  )}

                  {tab === 'links' && (
                    <LinksTab
                      task={task}
                      editable={canEdit}
                      onAdd={async (url, label) => {
                        try {
                          await api.tasks.addLink(task.id, url, label);
                          await load();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Could not add link');
                        }
                      }}
                      onRemove={async (linkId) => {
                        await api.tasks.removeLink(linkId);
                        await load();
                      }}
                    />
                  )}

                  {tab === 'activity' && <ActivityFeed items={activity} />}
                </div>

                <ProgressPanel
                  task={task}
                  me={me}
                  abilities={abilities}
                  onChanged={async () => {
                    await refreshTaskMeta();
                    await refreshCollab();
                    const fresh = await api.tasks.get(task.id);
                    onChanged(fresh.task);
                  }}
                />

                {/* comments */}
                <CommentThread
                  comments={comments}
                  me={me}
                  users={members}
                  canComment={abilities?.comment ?? false}
                  onAdd={async (body, voice) => {
                    const { comment } = await api.comments.add(task.id, body);
                    // The recording needs the comment id, so it is uploaded second.
                    if (voice) {
                      const { voiceNote } = await api.voice.upload(task.id, voice.blob, voice.durationMs, comment.id);
                      void autoTranscribe(voiceNote.id, voice.blob, transcribe);
                    }
                    const fresh = await api.tasks.get(task.id);
                    setComments(fresh.comments);
                    setActivity(fresh.activity);
                    onChanged(fresh.task);
                  }}
                  onDelete={async (id) => {
                    await api.comments.remove(id);
                    setComments((prev) => prev.filter((c) => c.id !== id));
                  }}
                  onResolve={async (id, resolved) => {
                    await api.comments.setResolved(id, resolved);
                    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, resolved: resolved ? 1 : 0 } : c)));
                  }}
                  onTranscriptChange={refreshCollab}
                  onDeleteVoice={async (id) => {
                    await api.voice.remove(id);
                    const fresh = await api.tasks.get(task.id);
                    setComments(fresh.comments);
                  }}
                />
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Prop({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-2">
      <dt className="flex w-[104px] shrink-0 items-center gap-1.5 text-[13px] text-[var(--text-secondary)]">
        <span className="text-[var(--text-tertiary)]">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function TagEditor({
  task, allTags, disabled, onChange, onCreated,
}: {
  task: TaskFull;
  allTags: Tag[];
  disabled: boolean;
  onChange: (tagIds: string[]) => void;
  onCreated: (tag: Tag) => void;
}) {
  const [query, setQuery] = useState('');
  const selectedIds = task.tags.map((t) => t.id);

  if (disabled && !task.tags.length) {
    return <span className="px-1 text-[13px] text-[var(--text-tertiary)]">None</span>;
  }

  const toggle = (id: string) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  const matches = allTags.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));
  const exact = allTags.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="flex flex-wrap items-center gap-1">
      {task.tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} onRemove={disabled ? undefined : () => toggle(tag.id)} />
      ))}

      {!disabled && (
        <Popover
          width={230}
          trigger={({ toggle: t }) => (
            <button onClick={t} className="rounded px-1 text-[12.5px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]">
              {task.tags.length ? <Plus size={12} /> : 'Add tags…'}
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="p-1">
                <input
                  autoFocus
                  className="input py-1 text-[13px]"
                  placeholder="Search or create…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {matches.map((tag) => (
                <button key={tag.id} className="menu-item" onClick={() => toggle(tag.id)}>
                  <TagChip tag={tag} />
                  <span className="flex-1" />
                  {selectedIds.includes(tag.id) && <Check size={13} />}
                </button>
              ))}
              {query.trim() && !exact && (
                <button
                  className="menu-item"
                  onClick={async () => {
                    const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
                    const { tag } = await api.tags.create(query.trim(), color);
                    onCreated(tag);
                    onChange([...selectedIds, tag.id]);
                    setQuery('');
                    close();
                  }}
                >
                  <Plus size={13} />
                  Create <strong>{query.trim()}</strong>
                </button>
              )}
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

function LinksTab({
  task, editable, onAdd, onRemove,
}: {
  task: TaskFull;
  editable: boolean;
  onAdd: (url: string, label: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    await onAdd(url.trim(), label.trim());
    setUrl('');
    setLabel('');
    setBusy(false);
  };

  return (
    <div>
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
        Reference material from the client — briefs, designs, docs, tickets. Optional.
      </p>

      {task.links.length > 0 && (
        <ul className="mb-3 space-y-1">
          {task.links.map((link) => (
            <li key={link.id} className="group flex items-center gap-2 rounded-md border px-2.5 py-2">
              <ExternalLink size={13} className="shrink-0 text-[var(--text-tertiary)]" />
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-[13px] hover:underline"
              >
                {link.label || link.url}
              </a>
              {link.label && (
                <span className="hidden max-w-[180px] shrink-0 truncate text-[11.5px] text-[var(--text-tertiary)] sm:block">
                  {link.url}
                </span>
              )}
              {editable && (
                <button
                  onClick={() => onRemove(link.id)}
                  className="shrink-0 rounded p-0.5 text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] group-hover:opacity-100"
                  aria-label="Remove link"
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <input
            className="input flex-1 py-1.5 text-[13px]"
            style={{ minWidth: 200 }}
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className="input py-1.5 text-[13px]"
            style={{ width: 150 }}
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" className="btn btn-outline py-1.5" disabled={busy || !url.trim()}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add
          </button>
        </form>
      ) : (
        !task.links.length && <p className="text-[13px] text-[var(--text-tertiary)]">No links attached.</p>
      )}
    </div>
  );
}

const ACTIVITY_TEXT: Record<string, string> = {
  created: 'created this task',
  assigned: 'changed the assignee',
  status: 'changed the status',
  priority: 'changed the priority',
  due_date: 'changed the due date',
  commented: 'commented',
  split: 'split this task',
  archived: 'archived this task',
};

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return <Empty icon={<ActivityIcon size={24} />} title="No activity yet" />;
  }
  return (
    <ol className="space-y-2.5">
      {items.map((item) => {
        const meta = safeMeta(item.meta);
        return (
          <li key={item.id} className="flex items-start gap-2.5 text-[13px]">
            <Avatar user={item.actor} size="sm" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">{item.actor?.name ?? 'Someone'}</span>{' '}
              <span className="text-[var(--text-secondary)]">{ACTIVITY_TEXT[item.type] ?? item.type}</span>
              {meta && <span className="text-[var(--text-secondary)]"> {meta}</span>}
              <div className="text-[11.5px] text-[var(--text-tertiary)]" title={formatDateTime(item.created_at)}>
                {timeAgo(item.created_at)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function safeMeta(raw: string): string | null {
  try {
    const meta = JSON.parse(raw) as Record<string, unknown>;
    if (meta.from && meta.to) return `from ${pretty(meta.from)} to ${pretty(meta.to)}`;
    if (meta.to) return `to ${pretty(meta.to)}`;
    if (meta.count) return `into ${meta.count} pieces`;
    return null;
  } catch {
    return null;
  }
}

const pretty = (v: unknown) =>
  typeof v === 'string' ? v.replace(/_/g, ' ').toLowerCase() : String(v);
