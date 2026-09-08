'use client';

import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, GitBranch, Link2, MessageSquare } from 'lucide-react';
import type { Priority, Status, TaskFull, User } from '@/lib/types';
import { PRIORITIES } from '@/lib/types';
import { canAssign, canChangeStatus, canEditPriority, isAssignableRole } from '@/lib/permissions';
import { Avatar, PriorityPicker, StatusPicker, TagChip, UserPicker } from '../ui';
import { dueMeta, formatDay } from './shared';

type SortKey = 'title' | 'status' | 'priority' | 'assignee' | 'due' | 'created';

interface Props {
  tasks: TaskFull[];
  users: User[];
  me: User;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: { status?: Status; assigneeId?: string | null; priority?: Priority }) => void;
}

const STATUS_ORDER: Status[] = [
  'TODO', 'IN_PROGRESS', 'CHANGES_REQUESTED', 'SUBMITTED', 'DONE',
];

export default function TableView({ tasks, users, me, onOpen, onUpdate }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created', dir: -1 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    const value = (t: TaskFull): string | number => {
      switch (sort.key) {
        case 'title': return t.title.toLowerCase();
        case 'status': return STATUS_ORDER.indexOf(t.status);
        case 'priority': return PRIORITIES.find((p) => p.id === t.priority)?.weight ?? 9;
        case 'assignee': return t.assignee?.name.toLowerCase() ?? '￿';
        case 'due': return t.due_date ?? Number.MAX_SAFE_INTEGER;
        default: return t.created_at;
      }
    };
    return [...tasks].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av < bv) return -1 * sort.dir;
      if (av > bv) return 1 * sort.dir;
      return 0;
    });
  }, [tasks, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="scroll-thin h-full overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10" style={{ background: 'var(--bg)' }}>
          <tr className="border-b">
            <Th className="w-9" />
            <Th sortable onClick={() => toggleSort('title')} sort={sort} k="title">Task</Th>
            <Th className="w-[132px]" sortable onClick={() => toggleSort('status')} sort={sort} k="status">Status</Th>
            <Th className="w-[118px]" sortable onClick={() => toggleSort('priority')} sort={sort} k="priority">Priority</Th>
            <Th className="w-[168px]" sortable onClick={() => toggleSort('assignee')} sort={sort} k="assignee">Assignee</Th>
            <Th className="w-[112px]" sortable onClick={() => toggleSort('due')} sort={sort} k="due">Due</Th>
            <Th className="w-[128px]">Tags</Th>
            <Th className="w-[86px]">Activity</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((task) => {
            const isOpen = expanded.has(task.id);
            return (
              <Fragment key={task.id}>
                <Row
                  task={task}
                  users={users}
                  me={me}
                  onOpen={onOpen}
                  onUpdate={onUpdate}
                  expandable={task.subtasks.length > 0}
                  expanded={isOpen}
                  onToggleExpand={() => toggleExpand(task.id)}
                />
                {isOpen &&
                  task.subtasks.map((sub) => (
                    <Row
                      key={sub.id}
                      task={sub}
                      users={users}
                      me={me}
                      onOpen={onOpen}
                      onUpdate={onUpdate}
                      nested
                    />
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  task, users, me, onOpen, onUpdate, nested = false, expandable = false, expanded = false, onToggleExpand,
}: {
  task: TaskFull;
  users: User[];
  me: User;
  onOpen: (id: string) => void;
  onUpdate: Props['onUpdate'];
  nested?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const due = dueMeta(task.due_date, task.status);

  return (
    <tr className="group border-b transition-colors hover:bg-[var(--bg-hover)]">
      <td className="px-2 py-1.5 align-middle">
        {expandable && (
          <button onClick={onToggleExpand} className="grid h-5 w-5 place-items-center rounded hover:bg-[var(--bg-active)]">
            <ChevronRight size={13} className="transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }} />
          </button>
        )}
      </td>

      <td className="px-2 py-1.5">
        <button onClick={() => onOpen(task.id)} className="flex w-full items-center gap-2 text-left">
          {nested && <span className="ml-3 text-[var(--text-tertiary)]">↳</span>}
          <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">TSK-{task.seq}</span>
          <span className={`truncate font-medium ${task.status === 'DONE' ? 'text-[var(--text-tertiary)] line-through' : ''}`}>
            {task.title}
          </span>
          {task.subtasks.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[var(--bg-active)] px-1 text-[10.5px] text-[var(--text-secondary)]">
              <GitBranch size={9} />
              {task.subtasks.filter((s) => s.status === 'DONE').length}/{task.subtasks.length}
            </span>
          )}
        </button>
      </td>

      <td className="px-2 py-1.5">
        <StatusPicker
          value={task.status}
          disabled={!canChangeStatus(me, task)}
          onChange={(status) => onUpdate(task.id, { status })}
        />
      </td>

      <td className="px-2 py-1.5">
        <PriorityPicker
          value={task.priority}
          disabled={!canEditPriority(me, task)}
          onChange={(priority) => onUpdate(task.id, { priority })}
        />
      </td>

      <td className="px-2 py-1.5">
        <UserPicker
          users={users.filter((u) => isAssignableRole(u.role))}
          pinned={task.assignee && !isAssignableRole(task.assignee.role) ? [task.assignee] : []}
          value={task.assignee_id}
          disabled={!canAssign(me)}
          onChange={(assigneeId) => onUpdate(task.id, { assigneeId })}
          label="Assign to a developer"
        />
      </td>

      <td className="px-2 py-1.5">
        {due ? (
          <span className="text-[12px] font-medium" style={{ color: due.color }}>{due.label}</span>
        ) : (
          <span className="text-[12px] text-[var(--text-tertiary)]">—</span>
        )}
      </td>

      <td className="px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {task.tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} />)}
          {task.tags.length > 2 && (
            <span className="text-[11px] text-[var(--text-tertiary)]">+{task.tags.length - 2}</span>
          )}
        </div>
      </td>

      <td className="px-2 py-1.5">
        <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-tertiary)]">
          {task.comment_count > 0 && (
            <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} />{task.comment_count}</span>
          )}
          {task.links.length > 0 && (
            <span className="inline-flex items-center gap-0.5"><Link2 size={11} />{task.links.length}</span>
          )}
        </div>
      </td>
    </tr>
  );
}

function Th({
  children, className = '', sortable, onClick, sort, k,
}: {
  children?: React.ReactNode;
  className?: string;
  sortable?: boolean;
  onClick?: () => void;
  sort?: { key: SortKey; dir: 1 | -1 };
  k?: SortKey;
}) {
  const active = sort && k && sort.key === k;
  return (
    <th className={`px-2 py-2 text-left text-[11.5px] font-medium text-[var(--text-secondary)] ${className}`}>
      {sortable ? (
        <button onClick={onClick} className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--bg-hover)]">
          {children}
          {active && (sort!.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
        </button>
      ) : (
        children
      )}
    </th>
  );
}
