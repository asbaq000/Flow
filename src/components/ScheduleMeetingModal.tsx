'use client';

import { useMemo, useState } from 'react';
import { Loader2, Video } from 'lucide-react';
import type { MeetingFull, User } from '@/lib/types';
import { MEETING_DURATIONS } from '@/lib/types';
import { api } from '@/lib/client';
import { Avatar, Modal } from './ui';

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time, not an ISO instant. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Next quarter-hour, so the default is always a sensible time to meet. */
function defaultStart(): string {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}

export default function ScheduleMeetingModal({
  users, me, taskId, onClose, onScheduled,
}: {
  users: User[];
  me: User;
  /** Set when the meeting is being booked from a task, to link the two. */
  taskId?: string | null;
  onClose: () => void;
  onScheduled: (meeting: MeetingFull) => void;
}) {
  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [durationMin, setDurationMin] = useState(30);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The organiser is always in the room, so they are not one of the choices.
  const invitable = useMemo(() => users.filter((u) => u.id !== me.id), [users, me.id]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canSubmit = Boolean(title.trim() && startsAt && picked.size);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      const { meeting } = await api.meetings.create({
        title: title.trim(),
        agenda: agenda.trim(),
        // The input is local wall-clock time; Date turns it into the instant.
        startsAt: new Date(startsAt).getTime(),
        durationMin,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        participantIds: [...picked],
        taskId: taskId ?? null,
      });
      onScheduled(meeting);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule the meeting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={<span className="flex items-center gap-2"><Video size={15} /> Schedule a meeting</span>}
      footer={
        <>
          <span className="mr-auto text-[12px] text-[var(--text-tertiary)]">
            {picked.size ? `${picked.size + 1} people` : 'Invite at least one person'}
          </span>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={!canSubmit || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />}
            Schedule
          </button>
        </>
      }
    >
      <label className="mb-1 block text-[12.5px] font-medium">Title</label>
      <input
        autoFocus
        className="input mb-3 w-full py-1.5 text-[13.5px]"
        placeholder="Sprint planning"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="mb-3 flex gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-[12.5px] font-medium">Starts</label>
          <input
            type="datetime-local"
            className="input w-full py-1.5 text-[13.5px]"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div className="w-[130px]">
          <label className="mb-1 block text-[12.5px] font-medium">Length</label>
          <select
            className="input w-full py-1.5 text-[13.5px]"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
          >
            {MEETING_DURATIONS.map((d) => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </select>
        </div>
      </div>

      <label className="mb-1 block text-[12.5px] font-medium">Agenda <span className="font-normal text-[var(--text-tertiary)]">(optional)</span></label>
      <textarea
        rows={2}
        className="input mb-3 w-full resize-none py-1.5 text-[13.5px]"
        placeholder="What are we covering?"
        value={agenda}
        onChange={(e) => setAgenda(e.target.value)}
      />

      <label className="mb-1 block text-[12.5px] font-medium">Who is coming</label>
      {invitable.length === 0 ? (
        <p className="rounded-md border px-3 py-2 text-[12.5px] text-[var(--text-secondary)]">
          There is nobody else in the workspace yet.
        </p>
      ) : (
        <div className="scroll-thin max-h-[180px] overflow-y-auto rounded-md border">
          {invitable.map((u) => (
            <button
              key={u.id}
              onClick={() => toggle(u.id)}
              className="flex w-full items-center gap-2 border-b px-2.5 py-1.5 text-left last:border-b-0 hover:bg-[var(--bg-hover)]"
            >
              <input type="checkbox" readOnly checked={picked.has(u.id)} className="pointer-events-none" />
              <Avatar user={u} size="xs" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{u.name}</span>
              <span className="truncate text-[11.5px] text-[var(--text-tertiary)]">{u.email}</span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
        Everyone invited gets a Google Calendar invite by email with the Meet link and a reminder —
        they do not need a Flow login to join, but they should be signed in to a free Google account
        so Meet lets them straight in.
      </p>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
    </Modal>
  );
}
