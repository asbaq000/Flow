'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CalendarCheck, CheckCircle2, Clock, Download, Loader2, TrendingUp, Timer, X,
} from 'lucide-react';
import type { SheetEntry, TaskSheet, User } from '@/lib/types';
import { api } from '@/lib/client';
import { Avatar, Empty, StatusBadge, TagChip, roleShort } from './ui';
import { formatDay, formatDateTime, timeAgo } from './views/shared';

/** "3d 4h" / "5h" / "40m" — compact enough for a table cell. */
function formatSpan(ms: number | null): string {
  if (ms === null) return '—';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const rem = hrs % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

export default function TaskSheetPanel({
  userId,
  me,
  onClose,
  onOpenTask,
}: {
  userId: string;
  me: User;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [sheet, setSheet] = useState<TaskSheet | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'completed' | 'active'>('completed');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sheet: data } = await api.sheet.get(userId);
        if (!cancelled) setSheet(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the task sheet');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Exports the sheet as CSV so it can go into a review or a timesheet. */
  const exportCsv = useCallback(() => {
    if (!sheet) return;
    const rows = [...sheet.completed, ...sheet.active];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['Ref', 'Task', 'Status', 'Priority', 'Parent', 'Tags', 'Created', 'Completed', 'Due', 'Turnaround', 'On time', 'Assigned by'],
      ...rows.map((e) => [
        `TSK-${e.seq}`,
        e.title,
        e.status,
        e.priority,
        e.parent_title ?? '',
        e.tags.map((t) => t.name).join(' / '),
        new Date(e.created_at).toISOString(),
        e.completed_at ? new Date(e.completed_at).toISOString() : '',
        e.due_date ? new Date(e.due_date).toISOString() : '',
        formatSpan(e.turnaround_ms),
        e.on_time === null ? '' : e.on_time ? 'yes' : 'no',
        e.assigned_by ?? '',
      ]),
    ]
      .map((r) => r.map(esc).join(','))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-sheet-${sheet.user.name.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sheet]);

  const entries = sheet ? (tab === 'completed' ? sheet.completed : sheet.active) : [];

  return (
    <>
      <div className="animate-fade fixed inset-0 z-50 bg-black/30" onClick={onClose} />

      <aside
        className="animate-slide fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l sm:max-w-[760px]"
        style={{ background: 'var(--bg)' }}
      >
        <header className="flex h-[46px] shrink-0 items-center gap-2 border-b px-3">
          <button onClick={onClose} className="btn btn-ghost px-1.5" aria-label="Close task sheet">
            <X size={16} />
          </button>
          <h2 className="flex-1 text-[14px] font-semibold">Task sheet</h2>
          {sheet && (
            <button onClick={exportCsv} className="btn btn-outline py-1 text-[12.5px]">
              <Download size={13} /> Export CSV
            </button>
          )}
        </header>

        {error ? (
          <div className="p-6">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          </div>
        ) : !sheet ? (
          <div className="grid h-full place-items-center text-[var(--text-tertiary)]">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <div className="safe-b px-4 py-5 sm:px-7">
              {/* who */}
              <div className="flex items-center gap-3">
                <Avatar user={sheet.user} size="xl" />
                <div className="min-w-0">
                  <h3 className="text-[22px] font-bold tracking-tight">{sheet.user.name}</h3>
                  <p className="text-[13px] text-[var(--text-secondary)]">
                    {sheet.user.title ? `${sheet.user.title} · ` : ''}
                    {roleShort(sheet.user.role)} · {sheet.user.email}
                  </p>
                </div>
              </div>

              {/* headline numbers */}
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat icon={<CheckCircle2 size={14} />} label="Completed" value={String(sheet.stats.completed_total)} hint="all time" />
                <Stat icon={<TrendingUp size={14} />} label="Last 7 days" value={String(sheet.stats.completed_7d)} hint={`${sheet.stats.completed_30d} in 30 days`} />
                <Stat icon={<Timer size={14} />} label="Median time" value={formatSpan(sheet.stats.median_turnaround_ms)} hint="raised to done" />
                <Stat
                  icon={<CalendarCheck size={14} />}
                  label="On time"
                  value={sheet.stats.on_time_rate === null ? '—' : `${Math.round(sheet.stats.on_time_rate * 100)}%`}
                  hint={sheet.stats.overdue ? `${sheet.stats.overdue} overdue now` : 'of tasks with a due date'}
                  tone={sheet.stats.overdue ? 'warn' : undefined}
                />
              </div>

              {/* tabs */}
              <div className="mt-6 flex items-center gap-1 border-b">
                {(['completed', 'active'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[13px] capitalize transition-colors"
                    style={{
                      borderColor: tab === t ? 'var(--text)' : 'transparent',
                      color: tab === t ? 'var(--text)' : 'var(--text-secondary)',
                      fontWeight: tab === t ? 600 : 400,
                    }}
                  >
                    {t === 'completed' ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                    {t === 'completed' ? 'Completed' : 'In flight'}
                    <span className="rounded bg-[var(--bg-active)] px-1 text-[10.5px] text-[var(--text-secondary)]">
                      {t === 'completed' ? sheet.completed.length : sheet.active.length}
                    </span>
                  </button>
                ))}
              </div>

              {entries.length === 0 ? (
                <Empty
                  icon={<CheckCircle2 size={26} />}
                  title={tab === 'completed' ? 'Nothing finished yet' : 'Nothing in flight'}
                  hint={
                    tab === 'completed'
                      ? `${sheet.user.name} has not closed any tasks so far.`
                      : `${sheet.user.name} has an empty plate right now.`
                  }
                />
              ) : (
                <div className="scroll-thin mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b text-[11.5px] text-[var(--text-secondary)]">
                        <th className="py-2 pr-2 text-left font-medium">Task</th>
                        <th className="w-[104px] py-2 pr-2 text-left font-medium">Status</th>
                        <th className="w-[112px] py-2 pr-2 text-left font-medium">
                          {tab === 'completed' ? 'Completed' : 'Due'}
                        </th>
                        <th className="w-[92px] py-2 pr-2 text-left font-medium">
                          {tab === 'completed' ? 'Turnaround' : 'Open for'}
                        </th>
                        <th className="w-[128px] py-2 text-left font-medium">Assigned by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <SheetRow key={entry.id} entry={entry} tab={tab} onOpen={onOpenTask} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function SheetRow({
  entry, tab, onOpen,
}: {
  entry: SheetEntry;
  tab: 'completed' | 'active';
  onOpen: (id: string) => void;
}) {
  const overdue = tab === 'active' && entry.due_date !== null && entry.due_date < Date.now();

  return (
    <tr className="border-b align-top transition-colors hover:bg-[var(--bg-hover)]">
      <td className="py-2 pr-2">
        <button onClick={() => onOpen(entry.id)} className="w-full text-left">
          <span className="flex items-center gap-1.5">
            <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">TSK-{entry.seq}</span>
            <span className="font-medium">{entry.title}</span>
          </span>
          {entry.parent_title && (
            <span className="mt-0.5 block text-[11.5px] text-[var(--text-tertiary)]">
              ↳ split from “{entry.parent_title}”
            </span>
          )}
          {entry.tags.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {entry.tags.map((t) => (
                <TagChip key={t.id} tag={t} />
              ))}
            </span>
          )}
        </button>
      </td>

      <td className="py-2 pr-2">
        <StatusBadge status={entry.status} />
      </td>

      <td className="py-2 pr-2">
        {tab === 'completed' ? (
          entry.completed_at ? (
            <span title={formatDateTime(entry.completed_at)}>{formatDay(new Date(entry.completed_at))}</span>
          ) : (
            <span className="text-[var(--text-tertiary)]">—</span>
          )
        ) : entry.due_date ? (
          <span style={{ color: overdue ? '#e03e3e' : undefined, fontWeight: overdue ? 600 : 400 }}>
            {formatDay(new Date(entry.due_date))}
          </span>
        ) : (
          <span className="text-[var(--text-tertiary)]">No date</span>
        )}
      </td>

      <td className="py-2 pr-2 text-[var(--text-secondary)]">
        {tab === 'completed' ? (
          <span className="flex items-center gap-1">
            {formatSpan(entry.turnaround_ms)}
            {entry.on_time === false && (
              <span className="rounded bg-red-500/15 px-1 text-[10px] font-medium text-red-600">late</span>
            )}
            {entry.on_time === true && (
              <span className="rounded bg-emerald-500/15 px-1 text-[10px] font-medium text-emerald-600">on time</span>
            )}
          </span>
        ) : (
          formatSpan(Date.now() - entry.created_at)
        )}
      </td>

      <td className="py-2 text-[var(--text-secondary)]">{entry.assigned_by ?? '—'}</td>
    </tr>
  );
}

function Stat({
  icon, label, value, hint, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-md border p-2.5" style={{ background: 'var(--bg-subtle)' }}>
      <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-[20px] font-bold tracking-tight" style={{ color: tone === 'warn' ? '#d9730d' : undefined }}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-[var(--text-tertiary)]">{hint}</div>}
    </div>
  );
}
