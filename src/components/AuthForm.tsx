'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { ROLES } from '@/lib/types';
import type { Role } from '@/lib/types';

// CEO and Manager are assigned by the CEO on the People page, never self-selected.
// CEO is granted on the People page, never self-selected.
const SIGNUP_ROLES = ROLES.filter((r) => r.id !== 'CEO');

export default function AuthForm({ isEmptyWorkspace }: { isEmptyWorkspace: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(
    isEmptyWorkspace ? 'signup' : 'login'
  );
  // Two doors into the app: found an organisation (and be its CEO) or join
  // one with the code its CEO hands out. A brand-new install opens on the first.
  const [entry, setEntry] = useState<'join' | 'create'>(isEmptyWorkspace ? 'create' : 'join');
  const [orgName, setOrgName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('MANAGER');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);

    if (mode === 'forgot') {
      try {
        const res = await fetch('/api/auth/forgot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) setError(data.error ?? 'Something went wrong');
        else setNotice(data.message ?? 'If that email has an account, a reset link is on its way.');
      } catch {
        setError('Could not reach the server');
      }
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'signup'
            ? {
                email, password, name, role,
                orgName: entry === 'create' ? orgName.trim() : undefined,
                inviteCode: entry === 'join' ? inviteCode.trim() || undefined : undefined,
                setupCode: entry === 'join' ? setupCode.trim() || undefined : undefined,
              }
            : { email, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong');
        setBusy(false);
        return;
      }
      // workspace/page.tsx is force-dynamic, so push() alone re-renders it
      // with the fresh session cookie — refresh() here only risked racing
      // the navigation and re-requesting this page's RSC payload mid-compile.
      router.replace('/workspace');
    } catch {
      setError('Could not reach the server');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ---- left: the pitch ---- */}
      <aside className="hidden w-[46%] flex-col justify-between p-12 lg:flex" style={{ background: 'var(--bg-sidebar)' }}>
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--accent)] text-[15px] font-bold text-[var(--on-accent)]">
            F
          </div>
          <span className="text-[15px] font-semibold">Flow</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-[32px] font-bold leading-[1.2] tracking-tight">
            Work flows down.
            <br />
            Nothing gets lost.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--text-secondary)]">
            Every task a Manager raises lands on a Team Lead&apos;s desk automatically. The Lead assigns
            it to a Developer, or splits it across several. You always know whose desk it is on.
          </p>

          <ol className="mt-10 space-y-5">
            {SIGNUP_ROLES.map((r, i) => (
              <li key={r.id} className="flex gap-3.5">
                <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold text-[var(--text-secondary)]">
                  {i + 1}
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold">{r.label}</div>
                  <div className="text-[13px] leading-snug text-[var(--text-secondary)]">{r.blurb}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-[var(--text-tertiary)]">Runs entirely on your machine. No cloud, no cost.</p>
      </aside>

      {/* ---- right: the form ---- */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-base font-bold text-[var(--on-accent)]">
              F
            </div>
          </div>

          <h2 className="text-[26px] font-bold tracking-tight">
            {mode === 'forgot'
              ? 'Reset your password'
              : mode === 'login'
                ? 'Welcome back'
                : entry === 'create'
                  ? 'Start your organisation'
                  : 'Join your team'}
          </h2>
          <p className="mt-1.5 text-[14px] text-[var(--text-secondary)]">
            {mode === 'forgot'
              ? 'Enter your email and we will send you a link to choose a new one.'
              : mode === 'login'
                ? 'Sign in to pick up where you left off.'
                : entry === 'create'
                  ? 'Name your organisation. You will be its CEO, and everyone else joins with the invite code you give them.'
                  : 'Enter the invite code from your CEO and choose the role that matches your seat on the team.'}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === 'signup' && (
              <Field label="Full name">
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  required
                />
              </Field>
            )}

            <Field label="Email">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </Field>

            {mode !== 'forgot' && (
            <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </Field>
            )}

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); setNotice(''); }}
                className="-mt-1 block text-[12.5px] text-[var(--accent)] hover:underline"
              >
                Forgot your password?
              </button>
            )}

            {notice && (
              <div className="rounded-md border px-3 py-2 text-[13px]"
                   style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
                {notice}
              </div>
            )}

            {mode === 'signup' && (
              <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: 'var(--bg-subtle)' }}>
                {([['join', 'Join with a code'], ['create', 'Start an organisation']] as const).map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => { setEntry(id); setError(''); }}
                    className="rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors"
                    style={{
                      background: entry === id ? 'var(--bg-card)' : 'transparent',
                      color: entry === id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      boxShadow: entry === id ? 'var(--shadow-sm)' : undefined,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {mode === 'signup' && entry === 'create' && (
              <Field label="Organisation name" hint="You will be its CEO">
                <input
                  className="input"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Acme Ltd"
                  autoComplete="organization"
                  required
                />
              </Field>
            )}

            {mode === 'signup' && entry === 'join' && (
              <Field label="Invite code" hint="Your CEO has it">
                <input
                  className="input font-mono uppercase tracking-[0.12em]"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  required={!setupCode.trim()}
                />
              </Field>
            )}

            {mode === 'signup' && entry === 'join' && (
              <Field label="Your role">
                <div className="space-y-1.5">
                  {SIGNUP_ROLES.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => setRole(r.id)}
                      className="flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors"
                      style={{
                        borderColor: role === r.id ? 'var(--accent)' : 'var(--border-strong)',
                        background: role === r.id ? 'var(--accent-soft)' : 'transparent',
                      }}
                    >
                      <div
                        className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border"
                        style={{
                          borderColor: role === r.id ? 'var(--accent)' : 'var(--border-strong)',
                          background: role === r.id ? 'var(--accent)' : 'transparent',
                        }}
                      >
                        {role === r.id && <Check size={11} className="text-[var(--on-accent)]" strokeWidth={3} />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">{r.label}</div>
                        <div className="text-[12px] leading-snug text-[var(--text-secondary)]">{r.blurb}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {mode === 'signup' && entry === 'join' && (
              <div>
                {showSetup ? (
                  <Field
                    label="CEO setup code"
                    hint="Upgraded installs only"
                  >
                    <input
                      className="input"
                      type="password"
                      value={setupCode}
                      onChange={(e) => setSetupCode(e.target.value)}
                      placeholder="Leave blank unless you have one"
                      autoComplete="off"
                    />
                    <p className="mt-1 text-[11.5px] text-[var(--text-tertiary)]">
                      The <code>CEO_SETUP_CODE</code> from the server claims the CEO seat of a
                      workspace set up before organisations existed. No invite code needed with it.
                    </p>
                  </Field>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSetup(true)}
                    className="text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:underline"
                  >
                    I have a CEO setup code
                  </button>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary w-full justify-center py-2" disabled={busy}>
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <>
                  {mode === 'forgot' ? 'Send reset link' : mode === 'login' ? 'Sign in' : 'Create account'}
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>

          {(
            <p className="mt-6 text-center text-[13px] text-[var(--text-secondary)]">
              {mode === 'forgot'
                ? 'Remembered it?'
                : mode === 'login'
                  ? "Don't have an account?"
                  : 'Already have an account?'}{' '}
              <button
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                  setNotice('');
                }}
                className="font-medium text-[var(--accent)] hover:underline"
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{label}</span>
        {hint && <span className="text-[11.5px] text-[var(--text-tertiary)]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
