'use client';

import {
  Archive, ChevronsLeft, ClipboardList, Inbox, LayoutGrid, LogOut, Moon, PenLine, Plus, Sun,
  User as UserIcon, Users2, Video,
} from 'lucide-react';
import type { User } from '@/lib/types';
import type { Section } from './Workspace';
import { Avatar, Popover, roleShort } from './ui';

interface Props {
  /** On phones the sidebar floats over the board instead of sitting beside it. */
  floating?: boolean;
  me: User;
  section: Section;
  counts: { inbox: number; mine: number; created: number; unread: number };
  onSection: (s: Section) => void;
  onNewTask: () => void;
  onOpenMySheet: () => void;
  onLogout: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onCollapse: () => void;
}

export default function Sidebar({
  floating = false,
  me, section, counts, onSection, onNewTask, onOpenMySheet, onLogout, theme, onToggleTheme, onCollapse,
}: Props) {
  const isLead = me.role === 'TEAM_LEAD' || me.role === 'MANAGER' || me.role === 'CEO';

  const items: { id: Section; label: string; icon: React.ReactNode; badge?: number; show: boolean }[] = [
    { id: 'inbox', label: 'Triage inbox', icon: <Inbox size={15} />, badge: counts.inbox, show: isLead },
    { id: 'mine', label: 'My work', icon: <UserIcon size={15} />, badge: counts.mine, show: true },
    { id: 'created', label: 'Raised by me', icon: <PenLine size={15} />, badge: counts.created, show: true },
    { id: 'all', label: 'All tasks', icon: <LayoutGrid size={15} />, show: isLead },
    { id: 'archived', label: 'Archive', icon: <Archive size={15} />, show: true },
    { id: 'meetings', label: 'Meetings', icon: <Video size={15} />, show: true },
    { id: 'people', label: 'People', icon: <Users2 size={15} />, show: true },
  ];

  return (
    <aside
      className={
        floating
          ? 'animate-slide fixed inset-y-0 left-0 z-40 flex w-[262px] max-w-[85vw] flex-col border-r shadow-2xl'
          : 'flex w-[232px] shrink-0 flex-col border-r'
      }
      style={{ background: 'var(--bg-sidebar)' }}
    >
      {/* account */}
      <div className="flex items-center gap-2 p-2.5">
        <Popover
          width={220}
          trigger={({ toggle }) => (
            <button
              onClick={toggle}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-hover)]"
            >
              <Avatar user={me} size="md" />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13.5px] font-semibold leading-tight">{me.name}</span>
                <span className="block truncate text-[11.5px] leading-tight text-[var(--text-secondary)]">
                  {roleShort(me.role)}
                </span>
              </span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="border-b px-2 pb-2 pt-1">
                <div className="text-[13px] font-medium">{me.name}</div>
                <div className="truncate text-[11.5px] text-[var(--text-secondary)]">{me.email}</div>
              </div>
              <button
                className="menu-item mt-1"
                onClick={() => {
                  onToggleTheme();
                  close();
                }}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button className="menu-item btn-danger" onClick={onLogout}>
                <LogOut size={14} /> Sign out
              </button>
            </>
          )}
        </Popover>

        <button onClick={onCollapse} className="btn btn-ghost px-1" aria-label="Hide menu">
          <ChevronsLeft size={15} />
        </button>
      </div>

      {/* new task */}
      <div className="px-2.5 pb-1">
        <button onClick={onNewTask} className="btn btn-primary w-full justify-center py-1.5">
          <Plus size={14} /> New task
        </button>
      </div>

      {/* nav */}
      <nav className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto px-1.5">
        {items
          .filter((i) => i.show)
          .map((item) => (
            <button
              key={item.id}
              onClick={() => onSection(item.id)}
              className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] transition-colors"
              style={{
                background: section === item.id ? 'var(--bg-active)' : 'transparent',
                fontWeight: section === item.id ? 600 : 400,
              }}
            >
              <span className="text-[var(--text-secondary)]">{item.icon}</span>
              <span className="flex-1 truncate text-left">{item.label}</span>
              {!!item.badge && item.badge > 0 && (
                <span className="rounded bg-[var(--bg-active)] px-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                  {item.badge}
                </span>
              )}
            </button>
          ))}

        <button
          onClick={onOpenMySheet}
          className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[13.5px] transition-colors hover:bg-[var(--bg-hover)]"
        >
          <span className="text-[var(--text-secondary)]"><ClipboardList size={15} /></span>
          <span className="flex-1 truncate text-left">My task sheet</span>
        </button>

        {/* how the chain works — a live legend, not decoration */}
        <div className="mt-6 px-2">
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            How work flows
          </div>
          <ol className="space-y-1.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
            <Step n={1} label="Manager raises it" active={me.role === 'MANAGER'} />
            <Step n={2} label="Team Lead triages & splits" active={isLead} />
            <Step n={3} label="Dev builds it" active={me.role === 'DEV'} />
          </ol>
        </div>
      </nav>

      <div className="safe-b hidden border-t px-3 py-2 text-[11px] text-[var(--text-tertiary)] md:block">
        <kbd className="rounded border px-1">N</kbd> new · <kbd className="rounded border px-1">Ctrl K</kbd> search
      </div>
    </aside>
  );
}

function Step({ n, label, active }: { n: number; label: string; active: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full text-[9px] font-bold"
        style={{
          background: active ? 'var(--accent)' : 'var(--bg-active)',
          color: active ? '#fff' : 'var(--text-tertiary)',
        }}
      >
        {n}
      </span>
      <span style={{ color: active ? 'var(--text)' : undefined, fontWeight: active ? 600 : 400 }}>{label}</span>
    </li>
  );
}
