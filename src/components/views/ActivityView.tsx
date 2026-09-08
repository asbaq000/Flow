'use client';

import { Bell, CheckCheck } from 'lucide-react';
import type { Notification } from '@/lib/types';
import { Avatar } from '../ui';
import { formatDateTime, timeAgo } from './shared';

/**
 * Everything that has happened to you, oldest at the bottom. This is the
 * bell's contents laid out as a page, so a busy morning can be read through
 * rather than clicked through one popover at a time.
 */
export default function ActivityView({ notifications, onOpen, onMarkAll, onMarkOne }: {
  notifications: Notification[];
  /** The whole notification, so a message can land in the chat rather than the task. */
  onOpen: (n: Notification) => void;
  onMarkAll: () => void;
  onMarkOne: (id: string) => void;
}) {
  const unread = notifications.filter((n) => !n.read).length;

  // Group by day so the list has a rhythm.
  const days = new Map<string, Notification[]>();
  for (const n of notifications) {
    const key = new Date(n.created_at).toDateString();
    (days.get(key) ?? days.set(key, []).get(key)!).push(n);
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-[16px] font-semibold">Activities</h2>
          {unread > 0 && (
            <span className="rounded-md px-1.5 font-mono text-[11px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{unread} new</span>
          )}
          {unread > 0 && (
            <button onClick={onMarkAll} className="btn btn-ghost ml-auto text-[12.5px]"><CheckCheck size={13} /> Mark all read</button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="grid place-items-center py-16 text-center">
            <div>
              <Bell size={28} className="mx-auto mb-3 text-[var(--text-tertiary)]" />
              <p className="text-[14px] font-medium">Nothing yet</p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Assignments, mentions, reviews and messages land here.</p>
            </div>
          </div>
        ) : (
          [...days.entries()].map(([day, list]) => (
            <section key={day} className="mb-5">
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{dayLabel(day)}</div>
              <ul className="card divide-y">
                {list.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => { if (!n.read) onMarkOne(n.id); onOpen(n); }}
                      className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <Avatar user={n.actor} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] leading-snug ${n.read ? 'text-[var(--text-secondary)]' : 'font-medium'}`}>{n.message}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                          {n.task_seq && <span className="font-mono">TSK-{n.task_seq}</span>}
                          <span title={formatDateTime(n.created_at)}>{timeAgo(n.created_at)}</span>
                        </span>
                      </span>
                      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function dayLabel(day: string): string {
  const d = new Date(day);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
