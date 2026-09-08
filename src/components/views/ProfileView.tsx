'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bell, BellOff, Camera, Check, Download, KeyRound, Loader2, Moon, Sun, TrendingUp,
} from 'lucide-react';
import type { TaskSheet, User } from '@/lib/types';
import { api } from '@/lib/client';
import { usePush } from '@/lib/usePush';
import { Avatar, avatarChanged, roleShort } from '../ui';
import { formatDateTime } from './shared';

/**
 * Somebody's own page: their picture, their numbers, their record to take
 * away, and the two settings that are truly theirs — password and how they
 * want to be reached.
 */
export default function ProfileView({
  me, theme, onToggleTheme, onSignedOut, onOpenTask,
}: {
  me: User;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSignedOut: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [sheet, setSheet] = useState<TaskSheet | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarKey, setAvatarKey] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.sheet.get(me.id).then((d) => setSheet(d.sheet)).catch(() => {});
  }, [me.id]);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    setMsg(null);
    try {
      await api.profile.setAvatar(file);
      avatarChanged(me.id);
      setAvatarKey((k) => k + 1);
      setMsg({ kind: 'ok', text: 'Picture updated' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const s = sheet?.stats;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6">
        {/* identity */}
        <section className="card mb-5 flex flex-wrap items-center gap-5 p-5">
          <div className="relative">
            <div key={avatarKey}>
              <Avatar user={me} size="xl" />
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
              className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 shadow-md"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--bg-card)' }}
              title="Change picture"
            >
              {avatarBusy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
              onChange={(e) => pickAvatar(e.target.files?.[0])} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-bold leading-tight tracking-tight">{me.name}</h2>
            <p className="text-[13px] text-[var(--text-secondary)]">{roleShort(me.role)}{me.title ? ` · ${me.title}` : ''}</p>
            <p className="text-[12.5px] text-[var(--text-tertiary)]">{me.email} · joined {formatDateTime(me.created_at)}</p>
          </div>
          <a href={api.profile.exportUrl(me.id)} download className="btn btn-outline">
            <Download size={14} /> Download my record
          </a>
          {msg && (
            <p className={`w-full text-[12.5px] ${msg.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>
          )}
        </section>

        {/* numbers */}
        <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Done, all time" value={s?.completed_total} />
          <Stat label="Done, last 30 days" value={s?.completed_30d} />
          <Stat label="Open right now" value={s?.active_total} />
          <Stat label="Overdue" value={s?.overdue} tone={s?.overdue ? 'warn' : undefined} />
          <Stat label="On time" value={s?.on_time_rate === null || s?.on_time_rate === undefined ? '—' : `${Math.round(s.on_time_rate * 100)}%`} />
          <Stat label="Typical turnaround" value={s?.median_turnaround_ms == null ? '—' : hours(s.median_turnaround_ms)} />
          <Stat label="Done this week" value={s?.completed_7d} />
          <Stat label="Comments across work" value={sheet ? [...sheet.completed, ...sheet.active].reduce((n, e) => n + e.comment_count, 0) : undefined} />
        </section>

        {/* recent work */}
        {sheet && (sheet.active.length > 0 || sheet.completed.length > 0) && (
          <section className="card mb-5 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><TrendingUp size={14} /> Recent work</h3>
            <ul className="divide-y">
              {[...sheet.active, ...sheet.completed].slice(0, 8).map((e) => (
                <li key={e.id}>
                  <button onClick={() => onOpenTask(e.id)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-[var(--bg-hover)]">
                    <span className="font-mono text-[11px] text-[var(--text-tertiary)]">TSK-{e.seq}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{e.title}</span>
                    <span className="text-[11px] text-[var(--text-tertiary)]">{e.status.replace('_', ' ').toLowerCase()}</span>
                    {e.on_time !== null && (
                      <span className={`text-[11px] ${e.on_time ? 'text-emerald-600' : 'text-red-500'}`}>{e.on_time ? 'on time' : 'late'}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <PasswordCard onSignedOut={onSignedOut} />
          <section className="card p-4">
            <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold"><Bell size={14} /> How to reach you</h3>
            <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
              Email goes out on its own. Push reaches this device even with Flow closed.
            </p>
            <PushToggle />
            <div className="mt-4 border-t pt-3">
              <button onClick={onToggleTheme} className="btn btn-outline">
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const hours = (ms: number) => {
  const h = ms / 3_600_000;
  return h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(1)} d`;
};

function Stat({ label, value, tone }: { label: string; value: number | string | undefined; tone?: 'warn' }) {
  return (
    <div className="card p-3.5">
      <div className="font-mono text-[24px] font-semibold leading-none tabular-nums" style={{ color: tone === 'warn' ? 'var(--s-blocked-dot)' : undefined }}>
        {value === undefined ? '…' : value}
      </div>
      <div className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">{label}</div>
    </div>
  );
}

function PasswordCard({ onSignedOut }: { onSignedOut: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError('');
    if (next !== again) { setError('The new passwords do not match'); return; }
    setBusy(true);
    try {
      await api.profile.changePassword(current, next);
      setDone(true);
      // Every session was dropped, this one included — back to the door.
      setTimeout(onSignedOut, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold"><KeyRound size={14} /> Change password</h3>
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">Every device signs out afterwards, this one too.</p>
      {done ? (
        <p className="flex items-center gap-1.5 text-[13px] text-emerald-600"><Check size={14} /> Changed. Signing you out…</p>
      ) : (
        <div className="flex flex-col gap-2">
          <input type="password" autoComplete="current-password" placeholder="Current password" className="input text-[13px]" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" className="input text-[13px]" value={next} onChange={(e) => setNext(e.target.value)} />
          <input type="password" autoComplete="new-password" placeholder="New password again" className="input text-[13px]" value={again} onChange={(e) => setAgain(e.target.value)} />
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <button onClick={submit} disabled={busy || !current || next.length < 8} className="btn btn-primary self-start">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Change password
          </button>
        </div>
      )}
    </section>
  );
}

function PushToggle() {
  const { state, busy, enable, disable } = usePush();
  if (state === 'unsupported') return <p className="text-[12.5px] text-[var(--text-tertiary)]">This browser cannot show push notifications.</p>;
  if (state === 'unavailable') return <p className="text-[12.5px] text-[var(--text-tertiary)]">Push is not set up on this install yet.</p>;
  if (state === 'blocked') return <p className="text-[12.5px] text-[var(--text-tertiary)]">Notifications are blocked for this site in your browser settings.</p>;
  return state === 'on' ? (
    <button onClick={disable} disabled={busy} className="btn btn-outline">
      {busy ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />} Turn push off on this device
    </button>
  ) : (
    <button onClick={enable} disabled={busy} className="btn btn-primary">
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />} Turn on push notifications
    </button>
  );
}
