'use client';

import { useMemo, useRef, useState } from 'react';
import { ENTRANCE_PROPS, ScrollTrigger, gsap, useGsap } from '@/lib/gsap';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, Check, Maximize2, MessageSquare, MoreVertical, Paperclip, Plus, Split } from 'lucide-react';
import type { Priority, Status, TaskFull, User } from '@/lib/types';
import { PRIORITIES, STATUSES, docToPlain } from '@/lib/types';
import { canAssign, canChangeStatus, canSplit } from '@/lib/permissions';
import { AvatarStack, Popover } from '../ui';
import type { GroupBy } from '../Workspace';
import { dueMeta } from './shared';

interface Props {
  tasks: TaskFull[];
  users: User[];
  me: User;
  groupBy: GroupBy;
  /** Changes when the board is showing a different scope, replaying the entrance. */
  sceneKey?: string;
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

export default function BoardView({ tasks, users, me, groupBy, sceneKey, onOpen, onUpdate, onSplit }: Props) {
  const [dragging, setDragging] = useState<TaskFull | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const boardRef = useRef<HTMLDivElement>(null);

  /*
   * Entrances and scroll reveals, all keyed on what the board is showing —
   * never on the task data, so a live update cannot make a board blink.
   *
   * Columns slide in as the row scrolls sideways (the row is the scroller,
   * not the window: this app never scrolls the page). Cards rise in as their
   * own column scrolls, batched so a column of ten arrives as one stagger
   * rather than ten separate tweens. Only the <article> is touched — the
   * wrapper around it belongs to dnd-kit — and every inline style GSAP sets
   * is cleared when it finishes.
   */
  useGsap(() => {
    const row = boardRef.current!;
    const cols = gsap.utils.toArray<HTMLElement>('[data-col]', row);
    const cards = gsap.utils.toArray<HTMLElement>('[data-col] article.card', row);
    if (!cols.length) return;

    gsap.set(cols, { x: 24, autoAlpha: 0 });
    ScrollTrigger.batch(cols, {
      scroller: row,
      horizontal: true,
      start: 'left 100%',
      once: true,
      onEnter: (batch) => gsap.to(batch, {
        x: 0, autoAlpha: 1, duration: 0.45, ease: 'power3.out', stagger: 0.07, clearProps: ENTRANCE_PROPS,
      }),
    });

    if (cards.length) {
      gsap.set(cards, { y: 14, autoAlpha: 0 });
      for (const col of cols) {
        const body = col.querySelector<HTMLElement>('[data-col-body]');
        const own = cards.filter((c) => col.contains(c));
        if (!body || !own.length) continue;
        ScrollTrigger.batch(own, {
          scroller: body,
          start: 'top 100%',
          once: true,
          onEnter: (batch) => {
            gsap.to(batch, {
              y: 0, autoAlpha: 1, duration: 0.4, ease: 'power3.out', stagger: 0.05, clearProps: ENTRANCE_PROPS,
            });
            // Progress pips fill in left to right as their card arrives.
            const pips = batch.flatMap((c) => gsap.utils.toArray<HTMLElement>('.pip[data-on="true"]', c));
            if (pips.length) {
              gsap.from(pips, {
                scaleX: 0, transformOrigin: 'left center', duration: 0.5, ease: 'power3.out',
                stagger: 0.02, clearProps: 'transform',
              });
            }
          },
        });
      }
    }

    ScrollTrigger.refresh();

    /*
     * Insurance, scoped carefully: anything still hidden after a beat that
     * is actually inside its scroller's viewport gets shown regardless of
     * what the scroll maths decided. Anything off-screen is left alone —
     * that is the scroll reveal waiting to happen, not a failure.
     */
    gsap.delayedCall(1.2, () => {
      const inView = (el: HTMLElement, scroller: HTMLElement) => {
        const a = el.getBoundingClientRect();
        const b = scroller.getBoundingClientRect();
        return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
      };
      const stuck = [
        ...cols.filter((c) => inView(c, row)),
        ...cards.filter((c) => {
          const col = c.closest<HTMLElement>('[data-col]');
          const body = col?.querySelector<HTMLElement>('[data-col-body]');
          return col && body && inView(col, row) && inView(c, body);
        }),
      ].filter((el) => gsap.getProperty(el, 'opacity') !== 1);
      if (stuck.length) gsap.to(stuck, { x: 0, y: 0, autoAlpha: 1, duration: 0.3, clearProps: ENTRANCE_PROPS });
    });
  }, [groupBy, sceneKey], boardRef);

  /** A dropped card lands with a small settle once it is in its new column. */
  const settle = (taskId: string) => {
    gsap.delayedCall(0.08, () => {
      const el = boardRef.current?.querySelector<HTMLElement>(`[data-task-id="${taskId}"] article.card`);
      if (el) gsap.fromTo(el, { scale: 1.035 }, { scale: 1, duration: 0.45, ease: 'back.out(2.2)', clearProps: 'transform' });
    });
  };

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
      // Done is a decision, so undoing it by a slip of the mouse should not be.
      if (task.status === 'DONE') {
        const label = STATUSES.find((st) => st.id === targetColumn.id)?.label ?? 'open work';
        if (!window.confirm(`TSK-${task.seq} is done. Reopen it as "${label}"?`)) return;
      }
      onUpdate(task.id, { status: targetColumn.id as Status });
      settle(task.id);
    } else if (groupBy === 'priority') {
      if (task.priority === targetColumn.id) return;
      onUpdate(task.id, { priority: targetColumn.id as Priority });
      settle(task.id);
    } else {
      const next = targetColumn.id === '__none__' ? null : targetColumn.id;
      if (task.assignee_id === next) return;
      if (!canAssign(me)) return;
      onUpdate(task.id, { assigneeId: next });
      settle(task.id);
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
      <div ref={boardRef} className="scroll-thin flex h-full items-start gap-3 overflow-x-auto p-3">
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

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {dragging && (
          <Lifted>
            <TaskCard task={dragging} me={me} onOpen={() => {}} onSplit={() => {}} />
          </Lifted>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * The card while it is being carried. dnd-kit moves the overlay's root with
 * a transform, so the lift — a slight scale and tilt — happens on this inner
 * element, which nothing else is animating.
 */
function Lifted({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGsap(() => {
    gsap.fromTo(ref.current, { scale: 0.98, rotation: 0 }, { scale: 1.03, rotation: 2, duration: 0.18, ease: 'power2.out' });
  }, [], ref);
  return (
    <div ref={ref} style={{ boxShadow: 'var(--shadow-lg)', borderRadius: 16, willChange: 'transform' }}>
      {children}
    </div>
  );
}

function BoardColumn({ column, children }: { column: Column; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      data-col
      className="flex max-h-full w-[288px] shrink-0 flex-col rounded-2xl transition-colors"
      style={{ background: isOver ? 'var(--accent-soft)' : 'var(--bg-subtle)' }}
    >
      <header className="flex items-center gap-2 px-3.5 pb-1.5 pt-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: column.color }} />
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{column.label}</h3>
        <span
          className="rounded-full px-1.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]"
          style={{ background: 'var(--well)' }}
        >
          {column.tasks.length}
        </span>
        {isOver && <span className="text-[11px] text-[var(--accent)]">drop</span>}
      </header>

      <div data-col-body className="scroll-thin flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
        {!column.tasks.length && (
          <div className="grid place-items-center rounded-xl border border-dashed py-7 text-[12px] text-[var(--text-tertiary)]">
            Nothing here
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
      data-task-id={task.id}
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
  const note = docToPlain(task.description).split('\n').find((l) => l.trim())?.slice(0, 120);
  const priorityColor = PRIORITIES.find((p) => p.id === task.priority)!.color;

  // A split task reads its progress off its pieces; anything else off its
  // own last report. Either way the card shows one number and one row of dots.
  const percent = task.subtasks.length
    ? Math.round((doneSubs / task.subtasks.length) * 100)
    : task.status === 'DONE' ? 100 : task.progress;
  const showProgress = task.subtasks.length > 0 || task.progress > 0 || task.status === 'DONE';

  const files = task.attachments.length + task.links.length;
  const people = splitPeople.length ? splitPeople : task.assignee ? [task.assignee] : [];

  return (
    <article
      onClick={onOpen}
      className={`card pri-${task.priority} cursor-pointer p-3.5 transition-all hover:-translate-y-px hover:shadow-md`}
    >
      {/* tags, and the menu that sits opposite them */}
      <div className="mb-2 flex items-start gap-1">
        <div className="flex min-w-0 flex-wrap gap-1">
          <span className="on-tint rounded-md px-1.5 py-px font-mono text-[10px] font-medium tabular-nums">
            TSK-{task.seq}
          </span>
          {task.tags.slice(0, 2).map((t) => (
            <span key={t.id} className="on-tint rounded-md px-1.5 py-px text-[10.5px] font-medium">
              #{t.name}
            </span>
          ))}
        </div>
        <span className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
          <Popover
            width={190}
            trigger={({ toggle }) => (
              <button
                onClick={(e) => { e.stopPropagation(); toggle(); }}
                className="-mr-1 -mt-0.5 rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                aria-label="Task actions"
              >
                <MoreVertical size={14} />
              </button>
            )}
          >
            {(close) => (
              <>
                <button className="menu-item" onClick={() => { close(); onOpen(); }}>
                  <Maximize2 size={13} /> Open task
                </button>
                {canSplit(me, task) && !task.subtasks.length && (
                  <button className="menu-item" onClick={() => { close(); onSplit(); }}>
                    <Split size={13} /> Split it up
                  </button>
                )}
              </>
            )}
          </Popover>
        </span>
      </div>

      {/* Three lines, then an ellipsis: a card is a summary, not the brief. */}
      <p
        title={task.title}
        className={`line-clamp-3 text-[13.5px] font-semibold leading-snug ${task.status === 'DONE' ? 'text-[var(--text-tertiary)] line-through' : ''}`}
      >
        {task.title}
      </p>

      {/* The pieces, ticked off — the shape the reference gives a checklist. */}
      {task.subtasks.length > 0 && (
        <ul className="mt-2 space-y-1">
          {task.subtasks.slice(0, 4).map((sub) => {
            const done = sub.status === 'DONE';
            return (
              <li key={sub.id} className="flex items-center gap-1.5 text-[11.5px] leading-snug">
                <span
                  className="grid h-[13px] w-[13px] shrink-0 place-items-center rounded-full border"
                  style={{
                    background: done ? priorityColor : 'transparent',
                    borderColor: done ? priorityColor : 'var(--border-strong)',
                  }}
                >
                  {done && <Check size={8} strokeWidth={3.5} className="text-white" />}
                </span>
                <span className={`truncate ${done ? 'text-[var(--text-tertiary)] line-through' : ''}`}>
                  {sub.title}
                </span>
              </li>
            );
          })}
          {task.subtasks.length > 4 && (
            <li className="pl-[19px] text-[11px] text-[var(--text-tertiary)]">
              +{task.subtasks.length - 4} more
            </li>
          )}
        </ul>
      )}

      {note && (
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--text-secondary)]">
          <span className="font-medium">Note:</span> {note}
        </p>
      )}

      {/* Overdue is the one thing worth interrupting the card's calm for. */}
      {due?.urgent && (
        <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: due.color }}>
          <CalendarDays size={10} /> {due.label}
        </p>
      )}

      {showProgress && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline text-[11.5px] text-[var(--text-secondary)]">
            Progress
            <span className="ml-auto font-mono text-[11px] font-medium tabular-nums text-[var(--text)]">
              {percent}%
            </span>
          </div>
          <Pips done={Math.round((percent / 100) * 20)} total={20} color={priorityColor} dots />
        </div>
      )}

      <footer className="mt-3 flex items-center gap-2">
        {people.length > 0 && <AvatarStack users={people} max={3} />}

        <span className="flex-1" />

        {task.comment_count > 0 && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
            <MessageSquare size={11} />
            {task.comment_count}
          </span>
        )}
        {files > 0 && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
            <Paperclip size={11} />
            {files}
          </span>
        )}
      </footer>
    </article>
  );
}

/**
 * Progress as discrete pips. A percentage typed by hand is a rough claim, and
 * ten segments say that honestly where a smooth bar implies a precision
 * nobody actually has.
 */
function Pips({ done, total, color, dots = false }: {
  done: number; total: number; color: string; dots?: boolean;
}) {
  return (
    <div className={`pips${dots ? ' dots' : ''}`} role="img" aria-label={`${done} of ${total} complete`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="pip" data-on={i < done} style={{ '--pip': color } as React.CSSProperties} />
      ))}
    </div>
  );
}
