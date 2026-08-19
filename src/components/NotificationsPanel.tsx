'use client';

import { useEffect, useRef } from 'react';
import { AtSign, Bell, CheckCheck, GitBranch, MessageSquare, UserPlus } from 'lucide-react';
import type { Notification } from '@/lib/types';
import { Avatar } from './ui';
import { timeAgo } from './views/shared';

const ICONS: Record<string, React.ReactNode> = {
  assigned: <UserPlus size={11} />,
  mention: <AtSign size={11} />,
  comment: <MessageSquare size={11} />,
  status: <GitBranch size={11} />,
};

export default function NotificationsPanel({
  notifications, onClose, onOpenTask, onMarkAll, onMarkOne,
}: {
  notifications: Notification[];
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onMarkAll: () => void;
  onMarkOne: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // Deferred so the click that opened the panel does not immediately close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div
      ref={ref}
      className="menu animate-pop scroll-thin absolute right-0 top-full z-50 mt-1 max-h-[440px] w-[340px] overflow-y-auto p-0"
    >
      <header className="sticky top-0 flex items-center gap-2 border-b px-3 py-2" style={{ background: 'var(--bg-panel)' }}>
        <Bell size={14} />
        <h3 className="flex-1 text-[13px] font-semibold">Inbox</h3>
        {unread > 0 && (
          <button onClick={onMarkAll} className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text)]">
            <CheckCheck size={12} /> Mark all read
          </button>
        )}
      </header>

      {notifications.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <Bell size={22} className="mx-auto mb-2 text-[var(--text-tertiary)]" />
          <p className="text-[13px] font-medium">You are all caught up</p>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
            Assignments and mentions land here.
          </p>
        </div>
      ) : (
        <ul className="p-1">
          {notifications.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => {
                  if (!n.read) onMarkOne(n.id);
                  if (n.task_id) onOpenTask(n.task_id);
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                style={{ background: n.read ? 'transparent' : 'var(--accent-soft)' }}
              >
                <div className="relative shrink-0">
                  <Avatar user={n.actor} size="md" />
                  <span
                    className="absolute -bottom-0.5 -right-0.5 grid h-[15px] w-[15px] place-items-center rounded-full text-[var(--text-secondary)]"
                    style={{ background: 'var(--bg-panel)', boxShadow: '0 0 0 1px var(--border)' }}
                  >
                    {ICONS[n.type] ?? <Bell size={10} />}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug">{n.message}</p>
                  <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">
                    {n.task_seq ? `TSK-${n.task_seq} · ` : ''}
                    {timeAgo(n.created_at)}
                  </p>
                </div>

                {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
