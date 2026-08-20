'use client';

import { useState } from 'react';
import {
  AlertTriangle, CalendarClock, Loader2, RotateCw, Trash2, Video,
} from 'lucide-react';
import type { MeetingFull, User } from '@/lib/types';
import { api } from '@/lib/client';
import { canCancelMeeting } from '@/lib/permissions';
import { Avatar, AvatarStack } from '../ui';
import { formatDateTime } from './shared';

export default function MeetingsView({
  meetings, me, loading, onChanged, onOpenTask,
}: {
  meetings: MeetingFull[];
  me: User;
  loading: boolean;
  onChanged: () => void;
  onOpenTask: (id: string) => void;
}) {
  if (loading && !meetings.length) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-[var(--text-tertiary)]">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  if (!meetings.length) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <CalendarClock size={30} className="mx-auto mb-3 text-[var(--text-tertiary)]" />
          <p className="text-[14px] font-medium">No meetings scheduled</p>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            A Team Lead can schedule one — everyone invited gets a Google Meet link by email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-2.5 px-4 py-4">
        {meetings.map((m) => (
          <MeetingCard key={m.id} meeting={m} me={me} onChanged={onChanged} onOpenTask={onOpenTask} />
        ))}
      </div>
    </div>
  );
}

function MeetingCard({
  meeting, me, onChanged, onOpenTask,
}: {
  meeting: MeetingFull;
  me: User;
  onChanged: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [busy, setBusy] = useState<'retry' | 'cancel' | null>(null);
  const [error, setError] = useState('');

  const cancelled = meeting.status === 'cancelled';
  const endsAt = meeting.starts_at + meeting.duration_min * 60_000;
  const live = !cancelled && Date.now() >= meeting.starts_at - 5 * 60_000 && Date.now() <= endsAt;

  const act = async (kind: 'retry' | 'cancel') => {
    if (busy) return;
    if (kind === 'cancel' && !confirm(`Cancel "${meeting.title}"? Everyone invited is told.`)) return;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'retry') await api.meetings.retry(meeting.id);
      else await api.meetings.cancel(meeting.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="card p-3" style={{ opacity: cancelled ? 0.6 : 1 }}>
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className={`text-[14px] font-medium ${cancelled ? 'line-through' : ''}`}>
              {meeting.title}
            </h3>
            {live && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-600">
                Happening now
              </span>
            )}
            {cancelled && (
              <span className="rounded bg-[var(--bg-active)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
                Cancelled
              </span>
            )}
          </div>

          <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
            {formatDateTime(meeting.starts_at)} · {meeting.duration_min} min
          </p>

          {meeting.agenda && (
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
              {meeting.agenda}
            </p>
          )}

          {meeting.task_id && meeting.task_title && (
            <button
              onClick={() => onOpenTask(meeting.task_id!)}
              className="mt-1.5 text-[12px] text-[var(--accent)] hover:underline"
            >
              About: {meeting.task_title}
            </button>
          )}

          <div className="mt-2 flex items-center gap-2">
            <AvatarStack users={meeting.participants} max={5} />
            <span className="text-[11.5px] text-[var(--text-tertiary)]">
              {meeting.participants.length} invited
              {meeting.organizer ? ` · scheduled by ${meeting.organizer.name}` : ''}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {meeting.join_url && !cancelled && (
            <a
              href={meeting.join_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary py-1 text-[12.5px]"
            >
              <Video size={13} /> Join
            </a>
          )}
          {canCancelMeeting(me, meeting) && !cancelled && (
            <button
              onClick={() => act('cancel')}
              className="btn btn-ghost py-1 text-[12px] text-[var(--text-secondary)]"
              disabled={busy !== null}
            >
              {busy === 'cancel' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* The meeting saved but Google never issued a link — offer the retry. */}
      {meeting.status === 'failed' && !cancelled && (
        <div className="mt-2.5 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="flex items-start gap-1.5 text-[12.5px] text-amber-800 dark:text-amber-200">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              No Google Meet link yet.
              {meeting.sync_error ? ` ${meeting.sync_error}` : ''}
            </span>
          </p>
          {canCancelMeeting(me, meeting) && (
            <button
              onClick={() => act('retry')}
              className="btn btn-ghost mt-1.5 py-1 text-[12px]"
              disabled={busy !== null}
            >
              {busy === 'retry' ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
              Try again
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
    </article>
  );
}
