'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

export default function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Those two passwords do not match');

    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not reset your password');
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError('Could not reach the server');
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-base font-bold text-[var(--on-accent)]">
          F
        </div>

        {!token ? (
          <>
            <h1 className="text-[24px] font-bold tracking-tight">This link is incomplete</h1>
            <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
              It is missing its token. Request a fresh reset link from the sign-in page.
            </p>
            <button onClick={() => router.replace('/login')} className="btn btn-primary mt-5 w-full justify-center py-2">
              Back to sign in
            </button>
          </>
        ) : done ? (
          <>
            <CheckCircle2 size={30} className="mb-3 text-emerald-500" />
            <h1 className="text-[24px] font-bold tracking-tight">Password changed</h1>
            <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
              You have been signed out everywhere else. Sign in with your new password.
            </p>
            <button onClick={() => router.replace('/login')} className="btn btn-primary mt-5 w-full justify-center py-2">
              Sign in <ArrowRight size={14} />
            </button>
          </>
        ) : (
          <>
            <h1 className="text-[24px] font-bold tracking-tight">Choose a new password</h1>
            <p className="mt-1.5 text-[14px] text-[var(--text-secondary)]">
              This link works once, and expires an hour after it was sent.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[13px] font-medium">New password</span>
                  <span className="text-[11.5px] text-[var(--text-tertiary)]">At least 8 characters</span>
                </span>
                <input
                  autoFocus
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium">Confirm it</span>
                <input
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </div>
              )}

              <button type="submit" className="btn btn-primary w-full justify-center py-2" disabled={busy}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <>Set new password <ArrowRight size={14} /></>}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
