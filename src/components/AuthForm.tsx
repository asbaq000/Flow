'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Camera, Check, Loader2, X } from 'lucide-react';
import { ROLES } from '@/lib/types';
import { FlowWordmark, FlowMark } from './ui';
import type { Role } from '@/lib/types';

/*
 * CEO is offered, but the server only accepts it for an organisation that has
 * none — which is the case exactly once, and never again after somebody takes
 * the seat. An organisation can be up and running before its CEO has an
 * account, and without this there is no way for them to ever get one.
 */
const SIGNUP_ROLES = ROLES;

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
  // Optional, and never in the way: the account is created either way, and
  // the picture is uploaded straight after with the session it just got.
  const [picture, setPicture] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const pictureRef = useRef<HTMLInputElement>(null);

  const choosePicture = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError('Keep the picture under 1 MB');
      return;
    }
    setError('');
    setPicture(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
  };

  const clearPicture = () => {
    setPicture(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return '';
    });
    if (pictureRef.current) pictureRef.current.value = '';
  };

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

    // Said here rather than after a round trip, because the server's answer
    // to a six-character password is the same and a second slower.
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters');
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
      // The account exists and this browser is signed in, so the picture can
      // go up now. A failure here is not worth stopping the sign-up for —
      // it can be set from the profile page in two clicks.
      if (mode === 'signup' && picture) {
        try {
          const form = new FormData();
          form.append('file', picture, picture.name);
          await fetch('/api/users/me/avatar', { method: 'POST', body: form });
        } catch {
          /* the account is made; the picture can wait */
        }
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
          <FlowWordmark mark={32} text={20} />
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
            <FlowMark size={36} />
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => pictureRef.current?.click()}
                  className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-dashed transition-colors hover:border-[var(--accent)]"
                  style={{ borderColor: preview ? 'transparent' : 'var(--border-strong)' }}
                  aria-label="Add a profile picture"
                >
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Camera size={17} className="text-[var(--text-tertiary)]" />
                  )}
                </button>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">Profile picture</div>
                  <div className="text-[12px] text-[var(--text-secondary)]">
                    Optional — {preview ? (
                      <button type="button" onClick={clearPicture} className="text-[var(--accent)] hover:underline">
                        remove it
                      </button>
                    ) : (
                      <button type="button" onClick={() => pictureRef.current?.click()} className="text-[var(--accent)] hover:underline">
                        add one now
                      </button>
                    )}, or later from your profile.
                  </div>
                </div>
                {preview && (
                  <button
                    type="button"
                    onClick={clearPicture}
                    className="ml-auto shrink-0 rounded-lg p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text)]"
                    aria-label="Remove the picture"
                  >
                    <X size={15} />
                  </button>
                )}
                <input
                  ref={pictureRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => choosePicture(e.target.files?.[0])}
                />
              </div>
            )}

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
              <Field label="Invite code" hint="Ask whoever runs your team">
                <input
                  className="input font-mono uppercase tracking-[0.12em]"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  required={!setupCode.trim()}
                />
                <p className="mt-1 text-[11.5px] text-[var(--text-tertiary)]">
                  Joining as a Manager or Team Lead? Ask your CEO for the organisation code.
                  Joining as a Developer? Your Team Lead has one for you.
                </p>
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
                        <div className="text-[12px] leading-snug text-[var(--text-secondary)]">
                          {r.id === 'CEO'
                            ? 'Only for an organisation that has no CEO yet. Needs the organisation code.'
                            : r.blurb}
                        </div>
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
