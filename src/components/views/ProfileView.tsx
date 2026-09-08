'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bell, BellOff, Building2, Camera, Check, Copy, Download, KeyRound, Loader2, Moon, RefreshCw, Send,
  Sun, TrendingUp, X,
} from 'lucide-react';
import type { NotificationTestResult, Organization, TaskSheet, User } from '@/lib/types';
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
      const { version } = await api.profile.setAvatar(file);
      avatarChanged(me.id, version);
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

        <OrganizationCard me={me} />

        <div className="grid gap-5 md:grid-cols-2">
          <PasswordCard onSignedOut={onSignedOut} />
          <section className="card p-4">
            <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold"><Bell size={14} /> How to reach you</h3>
            <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
              Email reaches you even if you never open Flow. Push reaches this device once you turn it on here,
              tab closed or not. Slack, where set up, posts what moved to the team channel.
            </p>
            <PushToggle />
            <NotificationTest />
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

/**
 * The organisation this person belongs to. The CEO can rename it and hands out
 * the invite code that brings everyone else in; a fresh code shuts the old one.
 */
function OrganizationCard({ me }: { me: User }) {
  const ceo = me.role === 'CEO';
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'name' | 'rotate' | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.org.get().then((d) => { setOrg(d.org); setName(d.org.name); }).catch(() => {});
  }, []);

  const rename = async () => {
    if (!org || name.trim().length < 2 || name.trim() === org.name) return;
    setBusy('name'); setError('');
    try {
      const d = await api.org.update({ name: name.trim() });
      setOrg(d.org); setName(d.org.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename');
    } finally { setBusy(null); }
  };

  const rotate = async () => {
    if (!confirm('Mint a new invite code? The current one stops working immediately.')) return;
    setBusy('rotate'); setError('');
    try {
      setOrg((await api.org.update({ rotateInvite: true })).org);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the code');
    } finally { setBusy(null); }
  };

  const copy = async () => {
    if (!org?.invite_code) return;
    try {
      await navigator.clipboard.writeText(org.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; the code is still on screen to copy by hand */ }
  };

  return (
    <section className="card mb-5 p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold"><Building2 size={14} /> Organisation</h3>
      {!org ? (
        <p className="text-[12.5px] text-[var(--text-tertiary)]">Loading…</p>
      ) : ceo ? (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-[var(--text-secondary)]">
            Everything here — people, tasks, meetings, messages — belongs to this organisation and is invisible to any other.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 block text-[11.5px] font-medium text-[var(--text-secondary)]">Name</span>
              <input className="input text-[13px]" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <button onClick={rename} disabled={busy !== null || name.trim().length < 2 || name.trim() === org.name} className="btn btn-outline">
              {busy === 'name' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Rename
            </button>
          </div>
          <div>
            <span className="mb-1 block text-[11.5px] font-medium text-[var(--text-secondary)]">Invite code</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border px-3 py-1.5 font-mono text-[15px] font-semibold tracking-[0.14em]" style={{ background: 'var(--bg-subtle)' }}>
                {org.invite_code}
              </code>
              <button onClick={copy} className="btn btn-outline">
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={rotate} disabled={busy !== null} className="btn btn-outline">
                {busy === 'rotate' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} New code
              </button>
            </div>
            <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">
              Give this to anyone joining. They enter it on the signup form, pick their role, and land in your organisation. A new code shuts the old one out.
            </p>
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
        </div>
      ) : (
        <div>
          <p className="text-[15px] font-semibold">{org.name}</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
            You are part of this organisation. Your CEO holds the invite code for bringing new people in.
          </p>
        </div>
      )}
    </section>
  );
}

/** "Are notifications working?" — answered per channel, right now, for you. */
function NotificationTest() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NotificationTestResult | null>(null);
  const [error, setError] = useState('');

  const runTest = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      setResult(await api.notifications.test());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the test');
    } finally { setBusy(false); }
  };

  const mark = (ok: boolean) => ok
    ? <Check size={13} className="mt-0.5 shrink-0 text-emerald-600" />
    : <X size={13} className="mt-0.5 shrink-0 text-[var(--text-tertiary)]" />;

  return (
    <div className="mt-3 border-t pt-3">
      <button onClick={runTest} disabled={busy} className="btn btn-outline">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send me a test on every channel
      </button>
      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
      {result && (
        <ul className="mt-2 space-y-1 text-[12.5px]">
          <li className="flex gap-1.5">{mark(result.inApp.ok)}<span>In-app: {result.inApp.ok ? 'the bell has it' : 'did not arrive'}</span></li>
          <li className="flex gap-1.5">{mark(result.email.ok)}<span>
            Email to {result.email.to}: {!result.email.configured
              ? 'not set up on this install (SMTP)'
              : result.email.ok
                ? 'sent — check your inbox'
                : 'failed'}
            {!result.email.ok && result.email.error && (
              // The mail server's own words. Nearly every failure here is a
              // one-line fix, and only the reason says which line.
              <span className="mt-1 block break-words rounded-md px-2 py-1.5 text-[11.5px] leading-snug" style={{ background: 'var(--well)', color: 'var(--text-secondary)' }}>
                {result.email.error}
              </span>
            )}
          </span></li>
          <li className="flex gap-1.5">{mark(result.push.ok)}<span>
            Push: {!result.push.configured ? 'not set up on this install (VAPID keys)' : result.push.devices === 0 ? 'no device has push turned on yet — use the button above' : `${result.push.sent} of ${result.push.devices} ${result.push.devices === 1 ? 'device' : 'devices'} reached`}
          </span></li>
          <li className="flex gap-1.5">{mark(result.slack.ok)}<span>
            Slack: {!result.slack.configured ? 'not set up on this install (webhook)' : result.slack.ok ? 'posted to the team channel' : 'the webhook refused it'}
          </span></li>
        </ul>
      )}
    </div>
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
