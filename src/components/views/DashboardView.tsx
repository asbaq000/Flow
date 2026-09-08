'use client';

import { useMemo } from 'react';
import type { TaskFull, User } from '@/lib/types';
import { PRIORITIES, STATUSES } from '@/lib/types';
import { Avatar } from '../ui';

/**
 * The board, summarised. Everything here is worked out from the tasks the
 * workspace already holds — no extra request, and it is always exactly as
 * current as the board beside it.
 */
export default function DashboardView({ tasks, users, onOpenTask }: {
  tasks: TaskFull[];
  users: User[];
  onOpenTask: (id: string) => void;
}) {
  const d = useMemo(() => {
    const now = Date.now();
    const week = now - 7 * 86_400_000;
    const flat = tasks.flatMap((t) => [t, ...t.subtasks]);
    const open = flat.filter((t) => t.status !== 'DONE');
    const byStatus = STATUSES.map((s) => ({ ...s, n: flat.filter((t) => t.status === s.id).length }));
    const byPriority = PRIORITIES.map((p) => ({ ...p, n: open.filter((t) => t.priority === p.id).length }));
    const overdue = open.filter((t) => t.due_date && t.due_date < now);
    const dueSoon = open.filter((t) => t.due_date && t.due_date >= now && t.due_date < now + 3 * 86_400_000);
    const doneWeek = flat.filter((t) => t.status === 'DONE' && (t.completed_at ?? 0) >= week).length;
    const inReview = flat.filter((t) => t.status === 'SUBMITTED').length;
    const load = users
      .filter((u) => u.role === 'DEV')
      .map((u) => ({
        user: u,
        open: open.filter((t) => t.assignee_id === u.id).length,
        overdue: overdue.filter((t) => t.assignee_id === u.id).length,
        done: flat.filter((t) => t.status === 'DONE' && t.assignee_id === u.id && (t.completed_at ?? 0) >= week).length,
      }))
      .sort((a, b) => b.open - a.open);
    return { flat, open, byStatus, byPriority, overdue, dueSoon, doneWeek, inReview, load };
  }, [tasks, users]);

  const max = Math.max(1, ...d.byStatus.map((s) => s.n));

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Open" value={d.open.length} />
          <Tile label="Done this week" value={d.doneWeek} tone="good" />
          <Tile label="Waiting on review" value={d.inReview} />
          <Tile label="Overdue" value={d.overdue.length} tone={d.overdue.length ? 'warn' : undefined} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="card p-4">
            <h3 className="mb-3 text-[13px] font-semibold">Where work sits</h3>
            <ul className="space-y-2">
              {d.byStatus.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.dot }} />
                  <span className="w-[130px] shrink-0 text-[var(--text-secondary)]">{s.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--well)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${(s.n / max) * 100}%`, background: s.dot }} />
                  </span>
                  <span className="w-6 text-right font-mono tabular-nums">{s.n}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4">
            <h3 className="mb-3 text-[13px] font-semibold">Open work by urgency</h3>
            <ul className="space-y-2">
              {d.byPriority.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="w-[130px] shrink-0 text-[var(--text-secondary)]">{p.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--well)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${(p.n / Math.max(1, d.open.length)) * 100}%`, background: p.color }} />
                  </span>
                  <span className="w-6 text-right font-mono tabular-nums">{p.n}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4">
            <h3 className="mb-3 text-[13px] font-semibold">Who is carrying what</h3>
            {d.load.length === 0 ? (
              <p className="text-[12.5px] text-[var(--text-tertiary)]">No developers yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {d.load.map((row) => (
                  <li key={row.user.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <Avatar user={row.user} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{row.user.name}</span>
                    <span className="font-mono tabular-nums text-[var(--text-secondary)]">{row.open} open</span>
                    {row.overdue > 0 && <span className="font-mono tabular-nums" style={{ color: 'var(--s-blocked-dot)' }}>{row.overdue} late</span>}
                    <span className="font-mono tabular-nums" style={{ color: 'var(--s-done-dot)' }}>{row.done} done/wk</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <h3 className="mb-3 text-[13px] font-semibold">Needs attention</h3>
            {d.overdue.length === 0 && d.dueSoon.length === 0 ? (
              <p className="text-[12.5px] text-[var(--text-tertiary)]">Nothing overdue and nothing due in the next three days.</p>
            ) : (
              <ul className="divide-y">
                {[...d.overdue, ...d.dueSoon].slice(0, 8).map((t) => {
                  const late = (t.due_date ?? 0) < Date.now();
                  return (
                    <li key={t.id}>
                      <button onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]">
                        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">TSK-{t.seq}</span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</span>
                        <span className="text-[11px] font-medium" style={{ color: late ? 'var(--s-blocked-dot)' : 'var(--s-triage-dot)' }}>
                          {late ? 'overdue' : 'due soon'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' }) {
  const color = tone === 'good' ? 'var(--s-done-dot)' : tone === 'warn' ? 'var(--s-blocked-dot)' : undefined;
  return (
    <div className="card p-4">
      <div className="font-mono text-[28px] font-semibold leading-none tabular-nums" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">{label}</div>
    </div>
  );
}
