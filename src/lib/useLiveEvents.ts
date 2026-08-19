'use client';

import { useEffect, useRef, useState } from 'react';
import type { FlowEvent } from './events';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the server's event stream and calls `onEvent` for anything
 * that happens in the workspace.
 *
 * EventSource reconnects on its own after a network blip, but it gives up on
 * an HTTP error (a 401 after the session expires, say), so we watch for that
 * and retry with a backoff rather than silently going dead.
 */
export function useLiveEvents(onEvent: (event: FlowEvent) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');

  // Keep the newest handler without re-opening the stream on every render.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      source = new EventSource('/api/events');

      source.addEventListener('ready', () => {
        attempts = 0;
        setStatus('live');
      });

      source.addEventListener('flow', (e) => {
        try {
          handler.current(JSON.parse((e as MessageEvent).data) as FlowEvent);
        } catch {
          /* a malformed frame should never break the stream */
        }
      });

      source.onerror = () => {
        setStatus('offline');
        source?.close();
        source = null;
        if (disposed) return;
        // 1s, 2s, 4s … capped at 15s.
        const delay = Math.min(15_000, 1000 * 2 ** attempts++);
        retry = setTimeout(connect, delay);
      };
    };

    connect();

    // A tab that was asleep may have missed events; reconnect on wake.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !source) {
        if (retry) clearTimeout(retry);
        attempts = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      source?.close();
    };
  }, []);

  return status;
}
