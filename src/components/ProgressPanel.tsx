'use client';

import { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, RotateCcw, Send, TrendingUp,
} from 'lucide-react';
import type { ProgressUpdate, TaskFull, User } from '@/lib/types';
import type { TaskAbilities } from '@/lib/permissions';
import { api } from '@/lib/client';
import { Avatar } from './ui';
import { timeAgo } from './views/shared';

/**
 * Where a developer answers three questions — how far along, what got done,
 * what is left — and where a lead answers the only one that matters at the
 * end: is this actually finished?
 */
export default function ProgressPanel({
  task,
  me,
  abilities,
  onChanged,
}: {
  task: TaskFull;
  me: User;
  abilities: TaskAbilities | null;
  onChanged: () => void | Promise<void>;
}) {
  const [percent, setPercent] = useState(task.progress ?? 0);
  const [done, setDone] = useState('');
  const [remaining, setRemaining] = useState('');
  const [blockers, setBlockers] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState<'update' | 'submit' | 'approve' | 'changes' | null>(null);
  const [error, setError] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const reset = () => {
    setDone('');
    setRemaining('');
    setBlockers('');
    setHours('');
  };

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError('');
    try {
      await fn();
      await onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const postUpdate = () =>
    run('update', async () => {
      await api.progress.post(task.id, {
        percent,
        doneSummary: done,
        remaining,
        blockers,
        hoursSpent: hours ? Number(hours) : null,
      });
      reset();
    });

  const submit = () =>
    run('submit', async () => {
      await api.progress.submit(task.id, {
        percent: percent || 100,
        doneSummary: done,
        remaining,
        blockers,
        hoursSpent: hours ? Number(hours) : null,
      });
      reset();
    });

  const decide = (decision: 'approve' | 'request_changes') =>
    run(decision === 'approve' ? 'approve' : 'changes', async () => {
      await api.review.decide(task.id, decision, reviewNote);
      setReviewNote('');
    });

  const awaitingReview = task.status === 'SUBMITTED';
  const latestSubmission = task.progress_updates.find((u) => u.kind === 'submitted');

  return (
    <section className="mt-6 border-t pt-5">
      <header className="mb-3 flex items-center gap-2">
        <TrendingUp size={14} className="text-[var(--text-secondary)]" />
        <h3 className="text-[13px] font-semibold">Progress</h3>
        <span className="text-[11.5px] text-[var(--text-tertiary)]">
          {task.progress_updates.length} {task.progress_updates.length === 1 ? 'report' : 'reports'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] font-semibold tabular-nums">{task.progress ?? 0}%</span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full" style={{ background: 'var(--bg-active)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${task.progress ?? 0}%`,
                background: task.status === 'DONE' ? '#10b981' : 'var(--accent)',
              }}
            />
          </div>
        </div>
      </header>

      {/* ---- reviewer's decision ---- */}
      {awaitingReview && (abilities?.approve || abilities?.requestChanges) && (
        <div
          className="mb-4 rounded-md border p-3"
          style={{ background: 'var(--bg-subtle)', borderColor: '#8b5cf6' }}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
            <ClipboardCheck size={14} /> Waiting on your review
          </div>
          {latestSubmission && (
            <p className="mb-2 text-[12.5px] text-[var(--text-secondary)]">
              {latestSubmission.author?.name} submitted this {timeAgo(latestSubmission.created_at)}.
            </p>
          )}
          <textarea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            rows={2}
            placeholder="Feedback — required when sending it back, optional when approving"
            className="input mb-2 resize-y text-[13px]"
          />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => decide('approve')} className="btn btn-primary py-1 text-[12.5px]" disabled={!!busy}>
              {busy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Approve &amp; mark done
            </button>
            <button
              onClick={() => decide('request_changes')}
              className="btn btn-outline py-1 text-[12.5px]"
              disabled={!!busy || !reviewNote.trim()}
              title={reviewNote.trim() ? undefined : 'Add a note explaining what needs to change'}
            >
              {busy === 'changes' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Request changes
            </button>
          </div>
        </div>
      )}

      {awaitingReview && !abilities?.approve && (
        <p className="mb-4 rounded-md border px-3 py-2 text-[12.5px] text-[var(--text-secondary)]">
          Submitted and waiting on a Team Lead to review it.
        </p>
      )}

      {/* ---- developer's report ---- */}
      {abilities?.postProgress && !awaitingReview && task.status !== 'DONE' && (
        <div className="mb-4 rounded-md border p-3" style={{ background: 'var(--bg-subtle)' }}>
          <label className="mb-1.5 flex items-center justify-between text-[12.5px] font-medium">
            How far along is it?
            <span className="font-mono tabular-nums text-[var(--text-secondary)]">{percent}%</span>
          </label>
          {/*
            Ten pips you tap, not a slider you drag. Progress on a task is a
            rough claim in tens, and a slider invited fiddling for a number
            that was never that precise — plus it is a poor control on a phone.
          */}
          <div className="mb-3 flex gap-1" role="radiogroup" aria-label="Percent complete">
            {Array.from({ length: 10 }, (_, i) => {
              const value = (i + 1) * 10;
              const on = percent >= value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={percent === value}
                  aria-label={`${value} percent`}
                  onClick={() => setPercent(percent === value ? value - 10 : value)}
                  className="h-2.5 flex-1 rounded-full transition-colors"
                  style={{ background: on ? 'var(--accent)' : 'var(--well)' }}
                />
              );
            })}
          </div>

          <textarea
            value={done}
            onChange={(e) => setDone(e.target.value)}
            rows={2}
            placeholder="What did you finish? Be specific — this is what your lead reviews."
            className="input mb-2 resize-y text-[13px]"
          />
          <textarea
            value={remaining}
            onChange={(e) => setRemaining(e.target.value)}
            rows={2}
            placeholder="What is still left?"
            className="input mb-2 resize-y text-[13px]"
          />

          <div className="mb-2 flex flex-wrap gap-2">
            <input
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="Blocked by anything? (optional)"
              className="input flex-1 text-[13px]"
              style={{ minWidth: 180 }}
            />
            <input
              value={hours}
              onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="Hours"
              inputMode="decimal"
              className="input text-[13px]"
              style={{ width: 90 }}
              aria-label="Hours spent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={postUpdate}
              className="btn btn-outline py-1 text-[12.5px]"
              disabled={!!busy || (!done.trim() && !remaining.trim())}
            >
              {busy === 'update' ? <Loader2 size={13} className="animate-spin" /> : <TrendingUp size={13} />}
              Post update
            </button>

            {abilities?.submit && (
              <button
                onClick={submit}
                className="btn btn-primary py-1 text-[12.5px]"
                disabled={!!busy || !done.trim()}
                title={done.trim() ? 'Hand this to your Team Lead for review' : 'Summarise what you completed first'}
              >
                {busy === 'submit' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Submit for review
              </button>
            )}

            <span className="text-[11.5px] text-[var(--text-tertiary)]">
              Only a Team Lead can mark this done.
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ---- history ---- */}
      {task.progress_updates.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-tertiary)]">
          No progress reported yet.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {task.progress_updates.map((u) => (
            <ProgressRow key={u.id} update={u} />
          ))}
        </ol>
      )}
    </section>
  );
}

const KIND_META: Record<
  ProgressUpdate['kind'],
  { label: string; color: string; icon: React.ReactNode }
> = {
  update: { label: 'Progress update', color: '#3b82f6', icon: <TrendingUp size={11} /> },
  submitted: { label: 'Submitted for review', color: '#8b5cf6', icon: <Send size={11} /> },
  approved: { label: 'Approved', color: '#10b981', icon: <CheckCircle2 size={11} /> },
  changes_requested: { label: 'Changes requested', color: '#f97316', icon: <RotateCcw size={11} /> },
};

function ProgressRow({ update }: { update: ProgressUpdate }) {
  const meta = KIND_META[update.kind];

  return (
    <li className="rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <Avatar user={update.author} size="sm" />
        <span className="text-[13px] font-medium">{update.author?.name ?? 'Someone'}</span>
        <span
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium"
          style={{ background: `${meta.color}1f`, color: meta.color }}
        >
          {meta.icon}
          {meta.label}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
          {update.kind !== 'changes_requested' && (
            <span className="font-semibold tabular-nums">{update.percent}%</span>
          )}
          {timeAgo(update.created_at)}
        </span>
      </div>

      {update.done_summary && (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px]">
          {update.kind === 'approved' ? update.done_summary : <><strong className="font-medium">Done:</strong> {update.done_summary}</>}
        </p>
      )}
      {update.remaining && (
        <p className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
          <strong className="font-medium">
            {update.kind === 'changes_requested' ? 'Needs changing:' : 'Left:'}
          </strong>{' '}
          {update.remaining}
        </p>
      )}
      {update.blockers && (
        <p className="mt-1 flex items-start gap-1.5 whitespace-pre-wrap text-[12.5px]" style={{ color: '#d9730d' }}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {update.blockers}
        </p>
      )}
      {update.hours_spent !== null && update.hours_spent > 0 && (
        <p className="mt-1 text-[11.5px] text-[var(--text-tertiary)]">{update.hours_spent}h logged</p>
      )}
    </li>
  );
}
