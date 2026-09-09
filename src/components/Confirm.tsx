'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './ui';

export interface ConfirmRequest {
  /** The question, in the words of what is about to happen. */
  title: string;
  /** What the person should know before answering. Optional. */
  body?: string;
  /** The button that goes ahead. Name the act: "Delete", not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red for anything that destroys something or cannot be taken back. */
  tone?: 'danger' | 'default';
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

/*
 * One host, mounted once, reached from anywhere.
 *
 * A confirm can be raised from a drag handler, a menu item, a card three
 * components deep — none of which should have to be handed a callback for it.
 * A module-level listener keeps the call site as simple as the browser's own
 * confirm() was, and gives back a promise instead of blocking the page.
 */
let listener: ((req: Pending) => void) | null = null;

/**
 * Asks in the app's own voice rather than the browser's grey box.
 *
 * Falls back to window.confirm if the host is somehow not mounted — better a
 * plain dialog than an action that silently proceeds unasked.
 */
export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  if (!listener) return Promise.resolve(window.confirm(request.title));
  return new Promise((resolve) => listener?.({ ...request, resolve }));
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    listener = setPending;
    return () => { listener = null; };
  }, []);

  const answer = useCallback((ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  // The safe answer is the one a stray Escape or backdrop click should give.
  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
  }, [pending]);

  if (!pending) return null;
  const danger = pending.tone === 'danger';

  return (
    <Modal
      open
      width={420}
      onClose={() => answer(false)}
      title={
        <span className="flex items-center gap-2">
          {danger && <AlertTriangle size={15} className="text-red-500" />}
          {pending.title}
        </span>
      }
      footer={
        <>
          <button onClick={() => answer(false)} className="btn btn-ghost">
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            onClick={() => answer(true)}
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      {pending.body ? (
        <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{pending.body}</p>
      ) : (
        <p className="text-[13.5px] text-[var(--text-secondary)]">This cannot be undone.</p>
      )}
    </Modal>
  );
}
