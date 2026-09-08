import { currentUser } from '@/lib/auth';
import { subscribe } from '@/lib/events';
import type { FlowEvent } from '@/lib/events';

// Long-lived stream: never prerender, never cache, never buffer.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const HEARTBEAT_MS = 25_000;

/*
 * How long one stream lives before it closes itself and the browser opens a
 * new one.
 *
 * Nothing here is optional. On Vercel the platform kills a function at its
 * time limit, and a killed function does not necessarily fire the request's
 * abort — so a stream that only cleans up on abort can leave its heartbeat
 * timer and its subscriber behind on a warm instance. Every tab opens a fresh
 * stream about once a minute, so what leaks does not leak slowly: it climbs
 * until the container runs out of file descriptors, and then unrelated things
 * start failing — a DNS lookup answering EBUSY, for one, which is how this
 * was found.
 *
 * Fifty seconds is inside every Vercel plan's limit, so the close is ours and
 * therefore certain. The browser reconnects after the `retry` interval below.
 */
const MAX_STREAM_MS = 50_000;

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('Not signed in', { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      // Declared before `send` so a failed enqueue can tear the rest down too:
      // a browser that has gone away should not leave a timer ticking behind it.
      let cleanup: () => void;

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          cleanup();
        }
      };

      // Tell the browser not to reconnect too eagerly, then say hello.
      send('retry: 3000\n\n');
      send(`event: ready\ndata: ${JSON.stringify({ userId: user.id })}\n\n`);

      const unsubscribe = subscribe((event: FlowEvent) => {
        // Targeted events (notifications) go only to their intended recipient.
        if (event.userId && event.userId !== user.id) return;
        send(`event: flow\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // Comment-only ping keeps proxies and the browser from timing the stream out.
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(lifetime);
        clearInterval(heartbeat);
        unsubscribe();
        req.signal.removeEventListener('abort', cleanup);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const lifetime = setTimeout(() => {
        // Named, so the browser knows this close was planned and comes
        // straight back instead of flashing "offline" every fifty seconds.
        send('event: cycle\ndata: {}\n\n');
        cleanup();
      }, MAX_STREAM_MS);
      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx and friends not to buffer the stream.
      'X-Accel-Buffering': 'no',
    },
  });
}
