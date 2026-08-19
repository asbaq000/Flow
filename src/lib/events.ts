/**
 * A tiny in-process pub/sub used to push live updates to connected browsers
 * over Server-Sent Events.
 *
 * Events deliberately carry no task content — only "something about task X
 * changed". Clients react by re-fetching through the normal permission-checked
 * endpoints, so a subscriber can never receive data they are not allowed to
 * read just by listening.
 */

export type FlowEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'comment.added'
  | 'comment.removed'
  | 'progress.added'
  | 'voice.added'
  | 'voice.removed'
  | 'notification';

export interface FlowEvent {
  type: FlowEventType;
  taskId?: string | null;
  /** When set, only this user's stream receives the event. */
  userId?: string | null;
  actorId?: string | null;
  at: number;
}

type Listener = (event: FlowEvent) => void;

declare global {
  // eslint-disable-next-line no-var
  var __flow_listeners__: Set<Listener> | undefined;
}

/** Survives dev-mode hot reloads, which would otherwise orphan subscribers. */
function listeners(): Set<Listener> {
  if (!global.__flow_listeners__) global.__flow_listeners__ = new Set();
  return global.__flow_listeners__;
}

export function publish(event: Omit<FlowEvent, 'at'>) {
  const full: FlowEvent = { ...event, at: Date.now() };
  for (const listener of listeners()) {
    try {
      listener(full);
    } catch {
      // A broken stream must never take down the request that published.
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners().add(listener);
  return () => listeners().delete(listener);
}

export function subscriberCount(): number {
  return listeners().size;
}
