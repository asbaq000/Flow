'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, GitBranch, Link2, MessageSquare } from 'lucide-react';
import type { Priority, Status, TaskFull, User } from '@/lib/types';
import { STATUSES } from '@/lib/types';
import { canAssign, canChangeStatus, canEditPriority, isAssignableRole } from '@/lib/permissions';
import { Avatar, PriorityBars, StatusPicker, TagChip, UserPicker } from '../ui';
import { dueMeta } from './shared';

interface Props {
  tasks: TaskFull[];
  users: User[];
  me: User;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: { status?: Status; assigneeId?: string | null; priority?: Priority }) => void;
}

export default function ListView({ tasks, users, me, onOpen, onUpdate }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () =>
      STATUSES.map((s) => ({ ...s, items: tasks.filter((t) => t.status === s.id) })).filter(
        (g) => g.items.length > 0
      ),
    [tasks]
  );

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-4">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          return (
            <section key={group.id} className="mb-5">
              <button
                onClick={() => toggle(group.id)}
                className="mb-1 flex w-full items-center gap-2 rounded px-1 py-1 hover:bg-[var(--bg-hover)]"
              >
                <ChevronDown
                  size={14}
                  className="text-[var(--text-tertiary)] transition-transform"
                  style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
                />
                <span className="h-2 w-2 rounded-full" style={{ background: group.dot }} />
                <span className="text-[13px] font-semibold">{group.label}</span>
                <span className="text-[11.5px] text-[var(--text-tertiary)]">{group.items.length}</span>
              </button>

              {!isCollapsed && (
                <div className="stagger overflow-hidden rounded-md border">
                  {group.items.map((task, i) => (
                    <Row
                      key={task.id}
                      task={task}
                      users={users}
                      me={me}
                      onOpen={onOpen}
                      onUpdate={onUpdate}
                      last={i === group.items.length - 1}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  task, users, me, onOpen, onUpdate, last,
}: {
  task: TaskFull;
  users: User[];
  me: User;
  onOpen: (id: string) => void;
  onUpdate: Props['onUpdate'];
  last: boolean;
}) {
  const due = dueMeta(task.due_date, task.status);
  const doneSubs = task.subtasks.filter((s) => s.status === 'DONE').length;

  return (
    <div>
      <div
        className={`flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[var(--bg-hover)] ${last && !task.subtasks.length ? '' : 'border-b'}`}
      >
        <StatusPicker
          value={task.status}
          disabled={!canChangeStatus(me, task)}
          onChange={(status) => onUpdate(task.id, { status })}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUSES.find((s) => s.id === task.status)!.dot }} />
        </StatusPicker>

        <button
          onClick={() => onOpen(task.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={task.title}
        >
          <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">TSK-{task.seq}</span>
          {/* min-w-0 is what lets this shrink; without it the row grows to fit. */}
          <span className={`min-w-0 flex-1 truncate text-[13.5px] ${task.status === 'DONE' ? 'text-[var(--text-tertiary)] line-through' : ''}`}>
            {task.title}
          </span>
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            {task.tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} />)}
            {task.tags.length > 2 && (
              <span className="text-[11px] text-[var(--text-tertiary)]">+{task.tags.length - 2}</span>
            )}
          </span>
        </button>

        {task.subtasks.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-secondary)]">
            <GitBranch size={11} />
            {doneSubs}/{task.subtasks.length}
          </span>
        )}
        {task.comment_count > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--text-tertiary)]">
            <MessageSquare size={11} />{task.comment_count}
          </span>
        )}
        {task.links.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-[var(--text-tertiary)]">
            <Link2 size={11} />{task.links.length}
          </span>
        )}

        <PriorityBars priority={task.priority} />

        {due && (
          <span className="w-[76px] shrink-0 text-right text-[11.5px] font-medium" style={{ color: due.color }}>
            {due.label}
          </span>
        )}

        <UserPicker
          users={users.filter((u) => isAssignableRole(u.role))}
          pinned={task.assignee && !isAssignableRole(task.assignee.role) ? [task.assignee] : []}
          value={task.assignee_id}
          disabled={!canAssign(me)}
          onChange={(assigneeId) => onUpdate(task.id, { assigneeId })}
          label="Assign to a developer"
        >
          <Avatar user={task.assignee} size="sm" />
        </UserPicker>
      </div>

      {task.subtasks.map((sub, i) => (
        <div
          key={sub.id}
          className={`flex items-center gap-2.5 py-1.5 pl-10 pr-3 transition-colors hover:bg-[var(--bg-hover)] ${last && i === task.subtasks.length - 1 ? '' : 'border-b'}`}
          style={{ background: 'var(--bg-subtle)' }}
        >
          <StatusPicker
            value={sub.status}
            disabled={!canChangeStatus(me, sub)}
            onChange={(status) => onUpdate(sub.id, { status })}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUSES.find((s) => s.id === sub.status)!.dot }} />
          </StatusPicker>
          <button onClick={() => onOpen(sub.id)} className="min-w-0 flex-1 truncate text-left text-[13px] text-[var(--text-secondary)]">
            {sub.title}
          </button>
          <Avatar user={sub.assignee} size="xs" />
        </div>
      ))}
    </div>
  );
}
