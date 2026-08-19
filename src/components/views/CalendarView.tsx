'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Priority, Status, TaskFull } from '@/lib/types';
import { STATUSES } from '@/lib/types';
import { Avatar } from '../ui';
import { fromDateInput, toDateInput } from './shared';

interface Props {
  tasks: TaskFull[];
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: { status?: Status; priority?: Priority; dueDate?: number | null }) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarView({ tasks, onOpen, onUpdate }: Props) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  /** Six-week grid starting on the Monday on or before the 1st. */
  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(first);
    start.setDate(first.getDate() - offset);

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, TaskFull[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const key = toDateInput(t.due_date);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const undated = tasks.filter((t) => !t.due_date);
  const today = toDateInput(Date.now());
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-[14px] font-semibold">{monthLabel}</h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="btn btn-ghost px-1"
            aria-label="Previous month"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="btn btn-ghost px-1"
            aria-label="Next month"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <button
          onClick={() => {
            const d = new Date();
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
          }}
          className="btn btn-outline py-0.5 text-[12px]"
        >
          Today
        </button>
        <span className="ml-2 text-[11.5px] text-[var(--text-tertiary)]">Drag a task onto a day to set its due date</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* month grid */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="grid grid-cols-7 border-b">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                {d}
              </div>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
            {days.map((day) => {
              const key = toDateInput(day.getTime());
              const items = byDay.get(key) ?? [];
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = key === today;

              return (
                <div
                  key={key}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverKey(key);
                  }}
                  onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragTaskId) onUpdate(dragTaskId, { dueDate: fromDateInput(key) });
                    setDragTaskId(null);
                    setOverKey(null);
                  }}
                  className="scroll-thin min-h-0 overflow-y-auto border-b border-r p-1"
                  style={{
                    background: overKey === key ? 'var(--accent-soft)' : inMonth ? 'transparent' : 'var(--bg-subtle)',
                  }}
                >
                  <div className="mb-0.5 flex justify-end">
                    <span
                      className="grid h-[19px] min-w-[19px] place-items-center rounded-full px-1 text-[11px] font-medium"
                      style={{
                        background: isToday ? 'var(--accent)' : 'transparent',
                        color: isToday ? '#fff' : inMonth ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                      }}
                    >
                      {day.getDate()}
                    </span>
                  </div>

                  {items.map((t) => (
                    <CalendarChip key={t.id} task={t} onOpen={onOpen} onDragStart={() => setDragTaskId(t.id)} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* unscheduled rail */}
        {undated.length > 0 && (
          <aside className="scroll-thin w-[210px] shrink-0 overflow-y-auto border-l p-2" style={{ background: 'var(--bg-subtle)' }}>
            <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              No due date · {undated.length}
            </h3>
            {undated.map((t) => (
              <CalendarChip key={t.id} task={t} onOpen={onOpen} onDragStart={() => setDragTaskId(t.id)} wide />
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

function CalendarChip({
  task, onOpen, onDragStart, wide = false,
}: {
  task: TaskFull;
  onOpen: (id: string) => void;
  onDragStart: () => void;
  wide?: boolean;
}) {
  const dot = STATUSES.find((s) => s.id === task.status)!.dot;
  return (
    <button
      draggable
      onDragStart={onDragStart}
      onClick={() => onOpen(task.id)}
      className={`mb-1 flex w-full cursor-grab items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] active:cursor-grabbing ${wide ? 'card' : ''}`}
      style={wide ? undefined : { background: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
      <span className={`min-w-0 flex-1 truncate text-[11.5px] ${task.status === 'DONE' ? 'line-through opacity-60' : ''}`}>
        {task.title}
      </span>
      <Avatar user={task.assignee} size="xs" />
    </button>
  );
}
