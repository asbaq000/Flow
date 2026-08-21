'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Check, FileText, Loader2, Minus, RotateCw, Trash2, Video, X,
} from 'lucide-react';
import type { MeetingAttendee, MeetingFull, User } from '@/lib/types';
import { meetingPhase } from '@/lib/types';
import { api } from '@/lib/client';
import { canCancelMeeting } from '@/lib/permissions';
import { Avatar } from '../ui';
import MeetingRecorder from '../MeetingRecorder';
import { formatDateTime, timeAgo } from './shared';

export default function MeetingsView({
  meetings, me, loading, scope, onScope, onChanged, onOpenTask,
}: {
  meetings: MeetingFull[];
  me: User;
  loading: boolean;
  scope: 'upcoming' | 'past';
  onScope: (s: 'upcoming' | 'past') => void;
  onChanged: () => void;
  onOpenTask: (id: string) => void;
}) {
  /*
   * A meeting ends by the clock, not by anything the server pushes, so the
   * view needs its own heartbeat — otherwise a call that finished while
   * somebody was looking at the page would sit there claiming to be live.
   */
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-4">
        <div className="mb-3 flex items-center gap-0.5 rounded-md p-0.5" style={{ background: 'var(--bg-subtle)', width: 'fit-content' }}>
          {(['upcoming', 'past'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onScope(s)}
              className="btn px-3 py-1 text-[12.5px] capitalize"
              style={{
                background: scope === s ? 'var(--bg)' : 'transparent',
                boxShadow: scope === s ? 'var(--shadow-sm)' : undefined,
                color: scope === s ? 'var(--text)' : 'var(--text-secondary)',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {loading && !meetings.length ? (
          <div className="grid place-items-center py-16 text-[var(--text-tertiary)]">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : !meetings.length ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <div>
              <CalendarClock size={30} className="mx-auto mb-3 text-[var(--text-tertiary)]" />
              <p className="text-[14px] font-medium">
                {scope === 'past' ? 'No meetings have happened yet' : 'No meetings scheduled'}
              </p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                {scope === 'past'
                  ? 'Once a call finishes it moves here, with its minutes and who attended.'
                  : 'A Team Lead can schedule one — everyone invited gets a Google Meet link by email.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {meetings.map((m) => (
              <MeetingCard key={m.id} meeting={m} me={me} onChanged={onChanged} onOpenTask={onOpenTask} />
            ))}
          </div>
        )}
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
  const [editing, setEditing] = useState(false);

  const phase = meetingPhase(meeting);
  const mayManage = canCancelMeeting(me, meeting);

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
    <article className="card p-3" style={{ opacity: phase === 'cancelled' ? 0.6 : 1 }}>
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className={`text-[14px] font-medium ${phase === 'cancelled' ? 'line-through' : ''}`}>
              {meeting.title}
            </h3>
            <PhaseBadge phase={phase} />
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
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {meeting.join_url && (phase === 'upcoming' || phase === 'live') && (
            <a
              href={meeting.join_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary py-1 text-[12.5px]"
            >
              <Video size={13} /> Join
            </a>
          )}
          {mayManage && phase !== 'cancelled' && phase !== 'ended' && (
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

      <Attendance meeting={meeting} phase={phase} mayManage={mayManage} onChanged={onChanged} />

      {/*
       * Offered while the call is running and afterwards: people usually
       * remember to hit record once it is already under way, and a recording
       * made on the phone can still be written up later.
       */}
      {mayManage && (phase === 'live' || phase === 'ended') && (
        <MeetingRecorder meeting={meeting} onSaved={onChanged} />
      )}

      {/* Minutes only make sense once there is something to write up. */}
      {(phase === 'ended' || phase === 'live' || meeting.minutes) && (
        <Minutes
          meeting={meeting}
          mayManage={mayManage}
          editing={editing}
          onEditing={setEditing}
          onChanged={onChanged}
        />
      )}

      {meeting.status === 'failed' && phase !== 'cancelled' && (
        <div className="mt-2.5 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="flex items-start gap-1.5 text-[12.5px] text-amber-800 dark:text-amber-200">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>No Google Meet link yet.{meeting.sync_error ? ` ${meeting.sync_error}` : ''}</span>
          </p>
          {mayManage && phase !== 'ended' && (
            <button onClick={() => act('retry')} className="btn btn-ghost mt-1.5 py-1 text-[12px]" disabled={busy !== null}>
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

function PhaseBadge({ phase }: { phase: ReturnType<typeof meetingPhase> }) {
  if (phase === 'live') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-600">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        Happening now
      </span>
    );
  }
  if (phase === 'ended') {
    return (
      <span className="rounded bg-[var(--bg-active)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
        Video call ended
      </span>
    );
  }
  if (phase === 'cancelled') {
    return (
      <span className="rounded bg-[var(--bg-active)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
        Cancelled
      </span>
    );
  }
  return null;
}

function Attendance({
  meeting, phase, mayManage, onChanged,
}: {
  meeting: MeetingFull;
  phase: ReturnType<typeof meetingPhase>;
  mayManage: boolean;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  // Only worth marking once the call is over — and never for a cancelled one.
  const markable = mayManage && phase === 'ended';

  const cycle = async (p: MeetingAttendee) => {
    if (saving) return;
    // unrecorded -> joined -> missed -> unrecorded
    const next = p.attended === null ? true : p.attended === 1 ? false : null;
    setSaving(p.id);
    try {
      await api.meetings.setAttendance(meeting.id, p.id, next);
      onChanged();
    } catch {
      /* the row simply stays as it was */
    } finally {
      setSaving(null);
    }
  };

  const joined = meeting.participants.filter((p) => p.attended === 1).length;
  const marked = meeting.participants.some((p) => p.attended !== null);

  return (
    <div className="mt-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-[var(--text-tertiary)]">
        <span>
          {meeting.participants.length} invited
          {marked ? ` · ${joined} joined` : ''}
          {meeting.organizer ? ` · scheduled by ${meeting.organizer.name}` : ''}
        </span>
        {markable && !marked && <span className="text-[var(--text-tertiary)]">— tap a face to mark who came</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {meeting.participants.map((p) => (
          <button
            key={p.id}
            onClick={() => markable && cycle(p)}
            disabled={!markable || saving !== null}
            title={
              markable
                ? `${p.name} — ${attendedLabel(p.attended)} (click to change)`
                : `${p.name}${p.attended !== null ? ` — ${attendedLabel(p.attended)}` : ''}`
            }
            className={`flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[11.5px] transition-colors ${
              markable ? 'hover:bg-[var(--bg-hover)]' : 'cursor-default'
            }`}
            style={{
              borderColor: p.attended === 1 ? 'rgb(16 185 129 / 0.5)' : 'var(--border)',
              background: p.attended === 1 ? 'rgb(16 185 129 / 0.10)' : 'transparent',
              opacity: p.attended === 0 ? 0.45 : 1,
            }}
          >
            {saving === p.id ? <Loader2 size={14} className="animate-spin" /> : <Avatar user={p} size="xs" />}
            <span className="max-w-[110px] truncate">{p.name}</span>
            {p.attended === 1 && <Check size={11} className="shrink-0 text-emerald-600" />}
            {p.attended === 0 && <X size={11} className="shrink-0 text-[var(--text-tertiary)]" />}
            {p.attended === null && markable && <Minus size={11} className="shrink-0 text-[var(--text-tertiary)]" />}
          </button>
        ))}
      </div>
    </div>
  );
}

const attendedLabel = (a: number | null) =>
  a === 1 ? 'joined' : a === 0 ? 'did not join' : 'not marked';

function Minutes({
  meeting, mayManage, editing, onEditing, onChanged,
}: {
  meeting: MeetingFull;
  mayManage: boolean;
  editing: boolean;
  onEditing: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(meeting.minutes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.meetings.saveMinutes(meeting.id, draft);
      onEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the minutes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2.5 rounded-md border px-3 py-2" style={{ background: 'var(--bg-subtle)' }}>
      <div className="mb-1 flex items-center gap-1.5">
        <FileText size={12} className="text-[var(--text-tertiary)]" />
        <span className="text-[12px] font-medium">Minutes</span>
        {meeting.minutes_updated_at && !editing && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            updated {timeAgo(meeting.minutes_updated_at)}
          </span>
        )}
        {mayManage && !editing && (
          <button
            onClick={() => {
              setDraft(meeting.minutes);
              onEditing(true);
            }}
            className="ml-auto text-[12px] text-[var(--accent)] hover:underline"
          >
            {meeting.minutes ? 'Edit' : 'Write them'}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            autoFocus
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'What was decided?\n\n· Topics covered\n· Decisions made\n· Who is doing what next'}
            className="input w-full resize-y py-1.5 text-[13px]"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <button onClick={save} className="btn btn-primary py-1 text-[12px]" disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save
            </button>
            <button onClick={() => onEditing(false)} className="btn btn-ghost py-1 text-[12px]" disabled={saving}>
              Cancel
            </button>
            {error && <span className="text-[12px] text-red-600">{error}</span>}
          </div>
        </>
      ) : meeting.minutes ? (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{meeting.minutes}</p>
      ) : (
        <p className="text-[12.5px] text-[var(--text-tertiary)]">
          Nothing written up yet.
        </p>
      )}
    </div>
  );
}
