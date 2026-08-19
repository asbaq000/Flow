'use client';

import { useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, GitBranch, Link2, MessageSquare, Plus, Split } from 'lucide-react';
import type { Priority, Status, TaskFull, User } from '@/lib/types';
import { PRIORITIES, STATUSES } from '@/lib/types';
import { canAssign, canChangeStatus, canSplit } from '@/lib/permissions';
import { Avatar, AvatarStack, PriorityBars, TagChip } from '../ui';
import type { GroupBy } from '../Workspace';
import { dueMeta } from './shared';

interface Props {
  tasks: TaskFull[];
  users: User[];
  me: User;
  groupBy: GroupBy;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: { status?: Status; assigneeId?: string | null; priority?: Priority }) => void;
  onSplit: (task: TaskFull) => void;
}

interface Column {
  id: string;
  label: string;
  color: string;
  tasks: TaskFull[];
}

export default function BoardView({ tasks, users, me, groupBy, onOpen, onUpdate, onSplit }: Props) {
  const [dragging, setDragging] = useState<TaskFull | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const columns: Column[] = useMemo(() => {
    if (groupBy === 'status') {
      return STATUSES.map((s) => ({
        id: s.id,
        label: s.label,
        color: s.dot,
        tasks: tasks.filter((t) => t.status === s.id),
      }));
    }
    if (groupBy === 'priority') {
      return PRIORITIES.map((p) => ({
        id: p.id,
        label: p.label,
        color: p.color,
        tasks: tasks.filter((t) => t.priority === p.id),
      }));
    }
    const assigned = users
      .filter((u) => tasks.some((t) => t.assignee_id === u.id))
      .map((u) => ({
        id: u.id,
        label: u.name,
        color: u.avatar_color,
        tasks: tasks.filter((t) => t.assignee_id === u.id),
      }));
    return [
      { id: '__none__', label: 'Unassigned', color: '#94a3b8', tasks: tasks.filter((t) => !t.assignee_id) },
      ...assigned,
    ];
  }, [tasks, users, groupBy]);

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;

    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;

    // Dropping onto a card resolves to that card's column.
    const overId = String(over.id);
    const targetColumn = columns.find((c) => c.id === overId)
      ?? columns.find((c) => c.tasks.some((t) => t.id === overId));
    if (!targetColumn) return;

    if (groupBy === 'status') {
      if (task.status === targetColumn.id) return;
      if (!canChangeStatus(me, task)) return;
      onUpdate(task.id, { status: targetColumn.id as Status });
    } else if (groupBy === 'priority') {
      if (task.priority === targetColumn.id) return;
      onUpdate(task.id, { priority: targetColumn.id as Priority });
    } else {
      const next = targetColumn.id === '__none__' ? null : targetColumn.id;
      if (task.assignee_id === next) return;
      if (!canAssign(me)) return;
      onUpdate(task.id, { assigneeId: next });
    }
  }

  return (
    <DndContext
      // Stable id: without it dnd-kit derives its aria ids from a render
      // counter, which differs between the server and client pass and trips
      // a hydration mismatch on every load.
      id="flow-board"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setDragging(tasks.find((t) => t.id === e.active.id) ?? null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="scroll-thin flex h-full gap-3 overflow-x-auto p-3">
        {columns.map((col) => (
          <BoardColumn key={col.id} column={col}>
            <SortableContext items={col.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {col.tasks.map((task) => (
                <SortableCard
                  key={task.id}
                  task={task}
                  me={me}
                  onOpen={() => onOpen(task.id)}
                  onSplit={() => onSplit(task)}
                />
              ))}
            </SortableContext>
          </BoardColumn>
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {dragging && (
          <div style={{ transform: 'rotate(2deg)', boxShadow: 'var(--shadow-lg)', borderRadius: 6 }}>
            <TaskCard task={dragging} me={me} onOpen={() => {}} onSplit={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({ column, children }: { column: Column; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className="flex w-[286px] shrink-0 flex-col rounded-lg transition-colors"
      style={{ background: isOver ? 'var(--bg-active)' : 'var(--bg-subtle)' }}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: column.color }} />
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{column.label}</h3>
        <span className="text-[11.5px] font-medium text-[var(--text-tertiary)]">{column.tasks.length}</span>
      </header>

      <div className="scroll-thin flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
        {!column.tasks.length && (
          <div className="grid flex-1 place-items-center rounded-md border border-dashed py-6 text-[12px] text-[var(--text-tertiary)]">
            Drop tasks here
          </div>
        )}
      </div>
    </section>
  );
}

function SortableCard({
  task, me, onOpen, onSplit,
}: {
  task: TaskFull;
  me: User;
  onOpen: () => void;
  onSplit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} me={me} onOpen={onOpen} onSplit={onSplit} />
    </div>
  );
}

export function TaskCard({
  task, me, onOpen, onSplit,
}: {
  task: TaskFull;
  me: User;
  onOpen: () => void;
  onSplit: () => void;
}) {
  const due = dueMeta(task.due_date, task.status);
  const doneSubs = task.subtasks.filter((s) => s.status === 'DONE').length;
  const splitPeople = task.subtasks.map((s) => s.assignee).filter(Boolean) as User[];

  return (
    <article
      onClick={onOpen}
      className="card cursor-pointer p-2.5 transition-shadow hover:shadow-md"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {task.tags.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((t) => (
            <TagChip key={t.id} tag={t} />
          ))}
        </div>
      )}

      <p
        className={`text-[13.5px] font-medium leading-snug ${task.status === 'DONE' ? 'text-[var(--text-tertiary)] line-through' : ''}`}
      >
        {task.title}
      </p>

      {task.subtasks.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
            <GitBranch size={11} />
            Split across {task.subtasks.length} · {doneSubs}/{task.subtasks.length} done
          </div>
          <div className="h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-active)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(doneSubs / task.subtasks.length) * 100}%`,
                background: doneSubs === task.subtasks.length ? '#10b981' : 'var(--accent)',
              }}
            />
          </div>
        </div>
      )}

      <footer className="mt-2.5 flex items-center gap-2">
        <PriorityBars priority={task.priority} />

        {due && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: due.color }}>
            <CalendarDays size={11} />
            {due.label}
          </span>
        )}

        {task.comment_count > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--text-tertiary)]">
            <MessageSquare size={11} />
            {task.comment_count}
          </span>
        )}

        {task.links.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--text-tertiary)]">
            <Link2 size={11} />
            {task.links.length}
          </span>
        )}

        <span className="flex-1" />

        {canSplit(me, task) && !task.subtasks.length && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSplit();
            }}
            className="rounded p-0.5 text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text)] group-hover:opacity-100"
            style={{ opacity: undefined }}
            title="Split across devs"
          >
            <Split size={12} />
          </button>
        )}

        {splitPeople.length > 0 ? (
          <AvatarStack users={splitPeople} max={3} />
        ) : (
          <Avatar user={task.assignee} size="xs" />
        )}
      </footer>

      <div className="mt-1.5 text-[10.5px] text-[var(--text-tertiary)]">TSK-{task.seq}</div>
    </article>
  );
}
