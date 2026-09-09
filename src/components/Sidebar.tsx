'use client';

import {
  Activity, BarChart3, CalendarDays, ChevronRight, ChevronsLeft, ClipboardList, LayoutList,
  LifeBuoy, LogOut, MessageSquare, Settings, Users2,
} from 'lucide-react';
import type { User } from '@/lib/types';
import type { Section } from './Workspace';
import { Avatar, FlowMark } from './ui';

interface Props {
  /** On phones the sidebar floats over the board instead of sitting beside it. */
  floating?: boolean;
  me: User;
  /** The organisation this workspace belongs to. */
  orgName?: string;
  section: Section;
  counts: { tasks: number; unread: number; messages: number };
  onSection: (s: Section) => void;
  onCollapse: () => void;
  onSignOut: () => void;
}

interface Item {
  id: Section;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

/**
 * Three groups, the way the reference lays them out: the two things you
 * live in at the top, then MAIN and RECORDS, then the account at the bottom.
 * Where the reference had entries Flow has no equivalent for (Products,
 * Clients) they are left out rather than left dead.
 */
export default function Sidebar({
  floating = false, me, orgName, section, counts, onSection, onCollapse, onSignOut,
}: Props) {
  const top: Item[] = [
    { id: 'all', label: 'Tasks', icon: <LayoutList size={16} />, badge: counts.tasks },
    { id: 'activity', label: 'Activities', icon: <Activity size={16} />, badge: counts.unread },
  ];
  const main: Item[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={16} /> },
    { id: 'meetings', label: 'Schedule', icon: <CalendarDays size={16} /> },
    { id: 'messages', label: 'Messages', icon: <MessageSquare size={16} />, badge: counts.messages },
    { id: 'report', label: 'Report', icon: <ClipboardList size={16} /> },
  ];
  const records: Item[] = [
    { id: 'people', label: 'Team', icon: <Users2 size={16} /> },
  ];
  const foot: Item[] = [
    { id: 'profile', label: 'Settings', icon: <Settings size={16} /> },
    { id: 'support', label: 'Support', icon: <LifeBuoy size={16} /> },
  ];

  const render = (item: Item) => {
    const on = section === item.id || (item.id === 'all' && ['inbox', 'mine', 'created', 'archived'].includes(section));
    return (
      <button
        key={item.id}
        onClick={() => onSection(item.id)}
        className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition-colors hover:bg-[var(--bg-hover)]"
        style={{
          background: on ? 'var(--accent-soft)' : 'transparent',
          color: on ? 'var(--accent)' : 'var(--text-secondary)',
          fontWeight: on ? 600 : 500,
          boxShadow: on ? 'inset 3px 0 0 var(--accent)' : undefined,
        }}
      >
        <span className="shrink-0">{item.icon}</span>
        <span className="flex-1 truncate text-left">{item.label}</span>
        {!!item.badge && item.badge > 0 && (
          <span
            className="rounded-md px-1.5 py-px font-mono text-[10.5px] font-semibold tabular-nums"
            style={{
              background: on ? 'var(--accent)' : 'var(--accent-soft)',
              color: on ? 'var(--on-accent)' : 'var(--accent)',
            }}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const group = (label: string) => (
    <div className="mb-1.5 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
      {label}
    </div>
  );

  return (
    <aside
      className={
        floating
          ? 'animate-slide fixed inset-y-0 left-0 z-40 flex w-[262px] max-w-[85vw] flex-col border-r shadow-2xl'
          : 'flex w-[236px] shrink-0 flex-col border-r'
      }
      style={{ background: 'var(--bg-sidebar)' }}
    >
      {/* brand — and the way back to the board from anywhere */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <button
          onClick={() => { window.location.href = '/workspace'; }}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left transition-opacity hover:opacity-80"
          title="Back to the board"
          aria-label="Flow — back to the board"
        >
          <span className="shrink-0" style={{ filter: 'drop-shadow(0 4px 12px rgba(108, 92, 231, 0.32))' }}>
            <FlowMark size={32} />
          </span>
        <span className="min-w-0 flex-1">
          <span className="font-display block text-[19px] leading-tight">Flow</span>
          {orgName && (
            <span className="block truncate text-[11px] leading-tight text-[var(--text-tertiary)]" title={orgName}>
              {orgName}
            </span>
          )}
        </span>
        </button>
        <button onClick={onCollapse} className="btn btn-ghost px-1" aria-label="Hide menu">
          <ChevronsLeft size={15} />
        </button>
      </div>

      <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2">
        {top.map(render)}
        {group('Main')}
        {main.map(render)}
        {group('Records')}
        {records.map(render)}
        <div className="mt-5">{foot.map(render)}</div>
      </nav>

      {/* account — and the way out, which has to be somewhere you can see it */}
      <div
        className="safe-b m-2 flex items-center gap-1 rounded-2xl border p-1.5"
        style={{ background: 'var(--bg-card)' }}
      >
        <button
          onClick={() => onSection('profile')}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 text-left transition-colors hover:bg-[var(--bg-hover)]"
        >
          <Avatar user={me} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">{me.name}</span>
            <span className="block truncate text-[11px] leading-tight text-[var(--text-tertiary)]">{me.email}</span>
          </span>
          <ChevronRight size={14} className="shrink-0 text-[var(--text-tertiary)]" />
        </button>
        <button
          onClick={onSignOut}
          className="shrink-0 rounded-xl p-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-red-600"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
}
