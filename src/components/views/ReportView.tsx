'use client';

import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { User } from '@/lib/types';
import { canViewTaskSheet, hasOwnTaskSheet, rankOf } from '@/lib/permissions';
import TaskSheetPanel from '../TaskSheetPanel';
import { Avatar, Empty, roleShort } from '../ui';

/**
 * The Report section: a full page, not a drawer.
 *
 * Which record opens first depends on who is reading. Most people land on
 * their own. A CEO has no sheet — they do not carry tasks — so they land on
 * the first person whose record is theirs to read, with the rest a click
 * away along the top.
 */
export default function ReportView({
  me, users, onOpenTask,
}: {
  me: User;
  users: User[];
  onOpenTask: (id: string) => void;
}) {
  const readable = useMemo(
    () =>
      users
        .filter((u) => canViewTaskSheet(me, u))
        .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : rankOf(a.role) - rankOf(b.role) || a.name.localeCompare(b.name))),
    [users, me]
  );

  const [selected, setSelected] = useState<string | null>(
    () => (hasOwnTaskSheet(me) ? me.id : readable[0]?.id) ?? null
  );

  // Somebody offboarded while the page was open, or a CEO with an empty team.
  const current = readable.some((u) => u.id === selected) ? selected : readable[0]?.id ?? null;

  if (!current) {
    return (
      <Empty
        icon={<ClipboardList size={30} />}
        title={hasOwnTaskSheet(me) ? 'No record yet' : 'Nothing to report on yet'}
        hint={
          hasOwnTaskSheet(me)
            ? 'Your task sheet fills in as work is assigned to you and closed.'
            : 'A CEO carries no tasks of their own. Once there are Managers, Leads and Developers here, their records open from this page.'
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {readable.length > 1 && (
        <div className="scroll-thin flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-3 py-2">
          {readable.map((u) => {
            const on = u.id === current;
            return (
              <button
                key={u.id}
                onClick={() => setSelected(u.id)}
                className="flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-left transition-colors"
                style={{
                  background: on ? 'var(--accent-soft)' : 'transparent',
                  borderColor: on ? 'var(--accent)' : 'var(--border)',
                  color: on ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                <Avatar user={u} size="sm" />
                <span className="text-[12.5px] font-medium">
                  {u.id === me.id ? 'You' : u.name}
                </span>
                <span className="text-[10.5px] opacity-70">{roleShort(u.role)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <TaskSheetPanel
          key={current}
          variant="page"
          userId={current}
          me={me}
          onClose={() => {}}
          onOpenTask={onOpenTask}
        />
      </div>
    </div>
  );
}
