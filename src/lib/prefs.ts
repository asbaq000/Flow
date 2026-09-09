'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Small per-device preferences — the kind that belong to this browser rather
 * than to the account. Kept in localStorage, and shared across components
 * through a listener set so flipping a switch in Settings reaches the page
 * that reads it without a reload.
 *
 * Anything that has to follow somebody between devices belongs in the
 * database instead; this is only for what one machine decides for itself.
 */
const listeners = new Set<() => void>();

function announce() {
  listeners.forEach((fn) => fn());
}

export function readPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    // A private window can refuse storage entirely; the default still holds.
    return fallback;
  }
}

export function writePref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* nothing to do — the value simply will not persist */
  }
  announce();
}

/** A boolean preference, read on mount so the server and client agree first. */
export function usePref(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  // Starts at the fallback on both passes: reading storage during render
  // would make the server and the browser disagree and break hydration.
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    const sync = () => setValue(readPref(key, fallback));
    sync();
    listeners.add(sync);
    return () => { listeners.delete(sync); };
  }, [key, fallback]);

  const set = useCallback((next: boolean) => writePref(key, next), [key]);
  return [value, set];
}

/** Whether this browser offers to record calls and write them up. */
export const PREF_RECORD_CALLS = 'flow-record-calls';
