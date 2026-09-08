'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './client';

export type PushState = 'unsupported' | 'unavailable' | 'off' | 'on' | 'blocked';

/**
 * Browser push, from the person's side.
 *
 * `enable` must run from a click — browsers refuse a permission prompt that
 * nobody asked for. Once granted, the subscription is stored server-side
 * against this account, and notifications arrive with the tab closed.
 */
export function usePush() {
  const [state, setState] = useState<PushState>('off');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    (async () => {
      try {
        const { enabled } = await api.push.key();
        if (!enabled) { setState('unavailable'); return; }
        if (Notification.permission === 'denied') { setState('blocked'); return; }
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        const sub = await reg?.pushManager.getSubscription();
        setState(sub ? 'on' : 'off');
      } catch {
        setState('off');
      }
    })();
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const { key } = await api.push.key();
      if (!key) { setState('unavailable'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState('blocked'); return; }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(key),
      });
      await api.push.subscribe(sub.toJSON());
      setState('on');
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.push.unsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable };
}

/** VAPID keys are URL-safe base64; PushManager wants raw bytes. */
function base64ToBytes(b64: string): ArrayBuffer {
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}
