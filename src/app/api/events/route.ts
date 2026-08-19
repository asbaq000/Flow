import { currentUser } from '@/lib/auth';
import { subscribe } from '@/lib/events';
import type { FlowEvent } from '@/lib/events';

// Long-lived stream: never prerender, never cache, never buffer.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('Not signed in', { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
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

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

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
