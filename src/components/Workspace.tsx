'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive, Bell, CalendarDays, Check, ChevronDown, Columns3, Inbox, LayoutList, Menu, Moon,
  HelpCircle, Plus, Search, Settings2, Sun, Table2, Users2, Video, X,
} from 'lucide-react';
import type { MeetingFull, Notification, Priority, Status, Tag, TaskFull, User } from '@/lib/types';
import { PRIORITIES, STATUSES } from '@/lib/types';
import { api } from '@/lib/client';
import { useLiveEvents } from '@/lib/useLiveEvents';
import { canScheduleMeeting, canSplit } from '@/lib/permissions';
import { Avatar, AvatarStack, Empty, Popover, roleShort, setKnownAvatars } from './ui';
import Sidebar from './Sidebar';
import BoardView from './views/BoardView';
import TableView from './views/TableView';
import ListView from './views/ListView';
import CalendarView from './views/CalendarView';
import PeopleView from './views/PeopleView';
import MeetingsView from './views/MeetingsView';
import MessagesView from './views/MessagesView';
import ProfileView from './views/ProfileView';
import DashboardView from './views/DashboardView';
import ActivityView from './views/ActivityView';
import TaskPanel from './TaskPanel';
import NewTaskModal from './NewTaskModal';
import SplitModal from './SplitModal';
import ScheduleMeetingModal from './ScheduleMeetingModal';
import NotificationsPanel from './NotificationsPanel';
import TaskSheetPanel from './TaskSheetPanel';

export type ViewKind = 'board' | 'table' | 'list' | 'calendar';
export type Section =
  | 'all' | 'inbox' | 'mine' | 'created' | 'archived'
  | 'activity' | 'dashboard' | 'meetings' | 'messages' | 'report' | 'people' | 'profile' | 'support';

/** The board scopes, offered from the "Board ▾" dropdown on the Tasks page. */
const SCOPES: { id: Section; label: string; leadOnly?: boolean }[] = [
  { id: 'all', label: 'All tasks' },
  { id: 'inbox', label: 'Triage inbox', leadOnly: true },
  { id: 'mine', label: 'My work' },
  { id: 'created', label: 'Raised by me' },
  { id: 'archived', label: 'Archive' },
];
const BOARD_SECTIONS: Section[] = ['all', 'inbox', 'mine', 'created', 'archived'];
export type GroupBy = 'status' | 'assignee' | 'priority';

export interface Filters {
  status: Status[];
  priority: Priority[];
  assignee: string[];
  tag: string[];
}

const EMPTY_FILTERS: Filters = { status: [], priority: [], assignee: [], tag: [] };

const VIEWS: { id: ViewKind; label: string; icon: React.ReactNode }[] = [
  { id: 'board', label: 'Board', icon: <Columns3 size={14} /> },
  { id: 'table', label: 'Table', icon: <Table2 size={14} /> },
  { id: 'list', label: 'List', icon: <LayoutList size={14} /> },
  { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={14} /> },
];

export default function Workspace({
  me,
  initialTasks,
  initialUsers,
  initialTags,
  initialNotifications,
}: {
  me: User;
  initialTasks: TaskFull[];
  initialUsers: User[];
  initialTags: Tag[];
  initialNotifications: Notification[];
}) {
  const router = useRouter();

  const [tasks, setTasks] = useState<TaskFull[]>(initialTasks);
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  const [section, setSection] = useState<Section>('all');
  const [messageUnread, setMessageUnread] = useState(0);
  const [messagesTaskId, setMessagesTaskId] = useState<string | null>(null);

  /** A message notification belongs in the chat; everything else opens the task. */
  const openFromNotification = (n: Notification) => {
    if (n.type === 'message' && n.task_id) {
      setMessagesTaskId(n.task_id);
      setSection('messages');
      setOpenTaskId(null);
    } else if (n.task_id) {
      setOpenTaskId(n.task_id);
    }
  };
  const [view, setView] = useState<ViewKind>('board');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const [meetings, setMeetings] = useState<MeetingFull[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingScope, setMeetingScope] = useState<'upcoming' | 'past'>('upcoming');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [splitTask, setSplitTask] = useState<TaskFull | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [panelReloadToken, setPanelReloadToken] = useState(0);
  const [sheetUserId, setSheetUserId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  // Closed by default on phones; the drawer opens over the board.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'dark');
  }, []);

  // Track the breakpoint so the sidebar can behave as a drawer below it.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => {
      setIsMobile(mq.matches);
      setSidebarOpen(!mq.matches);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('flow-theme', next);
  };

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 3200);
  }, []);

  /* ---------- data refresh ---------- */

  const refresh = useCallback(
    async (opts: { archived?: boolean } = {}) => {
      try {
        const data = await api.tasks.list({ archived: opts.archived ?? section === 'archived' });
        setTasks(data.tasks);
        setUsers(data.users);
        setTags(data.tags);
      } catch {
        /* transient — the next poll picks it up */
      }
    },
    [section]
  );

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await api.notifications.list();
      setNotifications(data.notifications);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshMeetings = useCallback(async () => {
    setMeetingsLoading(true);
    try {
      const data = await api.meetings.list(meetingScope);
      setMeetings(data.meetings);
    } catch {
      /* transient — the next visit or live event picks it up */
    } finally {
      setMeetingsLoading(false);
    }
  }, [meetingScope]);

  useEffect(() => {
    refresh();
  }, [section, refresh]);

  useEffect(() => {
    api.conversations.list()
      .then(({ conversations }) => setMessageUnread(conversations.reduce((n, c) => n + c.unread, 0)))
      .catch(() => {});
    api.profile.withPictures().then(({ ids }) => setKnownAvatars(ids)).catch(() => {});
  }, []);

  // Rendered after mount so the server and the browser never disagree on the date.
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => { setToday(new Date()); }, []);
  const monthName = today ? today.toLocaleDateString(undefined, { month: 'long' }) : '';
  const todayLabel = today
    ? `${today.toLocaleDateString(undefined, { weekday: 'long' })}, ${today.toLocaleDateString(undefined, { month: 'short' })} ${ordinal(today.getDate())}, ${today.getFullYear()}`
    : '';

  // Only fetched when the section is actually open — meetings are not part of
  // the board payload, so nobody pays for them until they look.
  useEffect(() => {
    if (section === 'meetings') refreshMeetings();
  }, [section, refreshMeetings]);

  /*
   * Live updates over Server-Sent Events. The server only ever says "something
   * about task X changed" — the actual data still comes back through the normal
   * permission-checked endpoints, so listening can never leak anything.
   */
  const live = useLiveEvents(
    useCallback(
      (event) => {
        if (event.type === 'notification') {
          refreshNotifications();
          return;
        }
        // Only board-shaped changes need the list refetched. Comments, voice
        // notes and progress live inside the open task's own panel, which
        // listens for those itself — refetching every task for them made
        // typing a comment reload the whole board for everyone.
        if (event.type === 'task.created' || event.type === 'task.updated' ||
            event.type === 'task.deleted') {
          refresh();
          refreshNotifications();
        }
        if (event.type === 'meeting.created' || event.type === 'meeting.updated') {
          refreshMeetings();
          refreshNotifications();
        }
        if (event.type === 'message.added' || event.type === 'conversation.updated') {
          api.conversations.list()
            .then(({ conversations }) => setMessageUnread(conversations.reduce((n, c) => n + c.unread, 0)))
            .catch(() => {});
        }
      },
      [refresh, refreshNotifications, refreshMeetings]
    )
  );

  // A safety net for the rare case the stream is down (proxy, sleep, redeploy).
  useEffect(() => {
    if (live === 'live') return;
    const id = setInterval(() => {
      refresh();
      refreshNotifications();
    }, 20000);
    return () => clearInterval(id);
  }, [live, refresh, refreshNotifications]);

  /* ---------- mutations ---------- */

  const patchTaskLocal = useCallback((updated: TaskFull) => {
    setTasks((prev) => {
      const hit = prev.some((t) => t.id === updated.id);
      return hit ? prev.map((t) => (t.id === updated.id ? updated : t)) : [updated, ...prev];
    });
  }, []);

  const updateTask = useCallback(
    async (id: string, patch: Parameters<typeof api.tasks.update>[1]) => {
      // Optimistic: paint the change now, reconcile with the server response.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                ...(patch.status ? { status: patch.status } : {}),
                ...(patch.priority ? { priority: patch.priority } : {}),
                ...(patch.assigneeId !== undefined
                  ? { assignee_id: patch.assigneeId, assignee: users.find((u) => u.id === patch.assigneeId) ?? null }
                  : {}),
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.dueDate !== undefined ? { due_date: patch.dueDate } : {}),
              }
            : t
        )
      );
      try {
        const { task } = await api.tasks.update(id, patch);
        if (task) patchTaskLocal(task);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not save');
        refresh();
      }
    },
    [users, patchTaskLocal, flash, refresh]
  );

  const archiveTask = useCallback(
    async (id: string, archived: boolean) => {
      try {
        await api.tasks.update(id, { archived });
        setTasks((prev) => prev.filter((t) => t.id !== id));
        flash(archived ? 'Task archived' : 'Task restored');
        if (openTaskId === id) setOpenTaskId(null);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not archive');
      }
    },
    [flash, openTaskId]
  );

  const deleteTask = useCallback(
    async (id: string) => {
      try {
        await api.tasks.remove(id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
        if (openTaskId === id) setOpenTaskId(null);
        flash('Task deleted');
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not delete');
      }
    },
    [flash, openTaskId]
  );

  /* ---------- keyboard shortcuts ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      if (typing) return;

      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setNewTaskOpen(true);
      }
      if (e.key === '/') {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
        setSearch('');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- derived ---------- */

  const sectionTasks = useMemo(() => {
    switch (section) {
      case 'inbox':
        return tasks.filter((t) => t.status === 'TRIAGE');
      case 'mine': {
        // A subtask split off to me is my actual unit of work — surface it as
        // its own card (with its own status) rather than only as a nested row
        // buried under the parent's status, which is often further along.
        const result: TaskFull[] = [];
        for (const t of tasks) {
          if (t.assignee_id === me.id || t.collaborators.some((c) => c.id === me.id)) result.push(t);
          result.push(...t.subtasks.filter((s) => s.assignee_id === me.id));
        }
        return result;
      }
      case 'created':
        return tasks.filter((t) => t.creator_id === me.id);
      case 'archived':
        return tasks;
      default:
        return tasks;
    }
  }, [tasks, section, me.id]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sectionTasks.filter((t) => {
      if (filters.status.length && !filters.status.includes(t.status)) return false;
      if (filters.priority.length && !filters.priority.includes(t.priority)) return false;
      if (filters.assignee.length && !filters.assignee.includes(t.assignee_id ?? '__none__')) return false;
      if (filters.tag.length && !t.tags.some((tag) => filters.tag.includes(tag.id))) return false;
      if (needle) {
        const haystack = `${t.title} ${t.seq} ${t.tags.map((x) => x.name).join(' ')}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [sectionTasks, filters, search]);

  const counts = useMemo(
    () => ({
      open: tasks.reduce((n, t) => n + (t.status !== 'DONE' ? 1 : 0) + t.subtasks.filter((x) => x.status !== 'DONE').length, 0),
      inbox: tasks.filter((t) => t.status === 'TRIAGE').length,
      mine: tasks.reduce((n, t) => {
        if (t.assignee_id === me.id && t.status !== 'DONE') n += 1;
        n += t.subtasks.filter((s) => s.assignee_id === me.id && s.status !== 'DONE').length;
        return n;
      }, 0),
      created: tasks.filter((t) => t.creator_id === me.id).length,
      unread: notifications.filter((n) => !n.read).length,
    }),
    [tasks, notifications, me.id]
  );

  const activeFilterCount =
    filters.status.length + filters.priority.length + filters.assignee.length + filters.tag.length;

  const openTask = useMemo(() => {
    for (const t of tasks) {
      if (t.id === openTaskId) return t;
      const sub = t.subtasks.find((s) => s.id === openTaskId);
      if (sub) return sub;
    }
    return null;
  }, [tasks, openTaskId]);

  /* ---------- render ---------- */

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {sidebarOpen && isMobile && (
        <div
          className="animate-fade fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {sidebarOpen && (
        <Sidebar
          floating={isMobile}
          me={me}
          section={section}
          counts={{ tasks: counts.open, unread: counts.unread, messages: messageUnread }}
          onSection={(s) => {
            if (s === 'report') {
              setSheetUserId(me.id);
            } else {
              setSection(s);
              setOpenTaskId(null);
            }
            if (isMobile) setSidebarOpen(false);
          }}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* ---- header ---- */}
        {/* ---- welcome bar: who, search, help, bell ---- */}
        <div className="flex h-[58px] shrink-0 items-center gap-3 border-b px-4">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost px-1.5" aria-label="Show menu">
              <Menu size={16} />
            </button>
          )}
          <div className="min-w-0 leading-tight">
            <div className="text-[11px] text-[var(--text-tertiary)]">Welcome,</div>
            <div className="truncate text-[14px] font-semibold">{me.name}</div>
          </div>

          <button
            onClick={() => setShowSearch(true)}
            className="mx-auto hidden w-full max-w-[420px] items-center gap-2 rounded-full border px-3.5 py-1.5 text-left text-[13px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] md:flex"
            style={{ background: 'var(--bg-input)' }}
          >
            <Search size={14} />
            <span className="flex-1">Find something</span>
            <kbd className="rounded-md border px-1.5 font-mono text-[10.5px]">Ctrl K</kbd>
          </button>

          <button onClick={() => setSection('support')} className="btn btn-ghost ml-auto px-1.5 md:ml-0" aria-label="Help">
            <HelpCircle size={17} />
          </button>
          {/* notifications */}
          <div className="relative">
            <button
              onClick={() => {
                setNotifOpen((o) => !o);
                refreshNotifications();
              }}
              className="btn btn-ghost relative px-1.5"
              title="Notifications"
            >
              <Bell size={15} />
              {counts.unread > 0 && (
                <span className="absolute right-0.5 top-0.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {counts.unread > 9 ? '9+' : counts.unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <NotificationsPanel
                notifications={notifications}
                onClose={() => setNotifOpen(false)}
                onOpenTask={(_id, n) => {
                  openFromNotification(n);
                  setNotifOpen(false);
                }}
                onMarkAll={async () => {
                  await api.notifications.read('all');
                  setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
                }}
                onMarkOne={async (id) => {
                  await api.notifications.read([id]);
                  setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
                }}
              />
            )}
          </div>
        </div>

        <header className="flex min-h-[46px] shrink-0 items-center gap-2 border-b px-4 py-1.5">
          {BOARD_SECTIONS.includes(section) ? (
            <>
              <div className="leading-tight">
                <div className="text-[15px] font-bold">{monthName}</div>
                <div className="text-[11px] text-[var(--text-tertiary)]">Today is {todayLabel}</div>
              </div>
              <span className="mx-2 hidden h-6 w-px sm:block" style={{ background: 'var(--border)' }} />
              <Popover
                width={200}
                trigger={({ toggle }) => (
                  <button onClick={toggle} className="btn btn-ghost gap-1.5 text-[13px]">
                    <span className="font-semibold">Board</span>
                    <span className="text-[var(--text-tertiary)]">· {SCOPES.find((x) => x.id === section)?.label}</span>
                    <ChevronDown size={13} className="text-[var(--text-tertiary)]" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    {SCOPES.filter((sc) => !sc.leadOnly || me.role === 'TEAM_LEAD' || me.role === 'CEO').map((sc) => (
                      <button key={sc.id} className="menu-item" data-active={section === sc.id} onClick={() => { setSection(sc.id); close(); }}>
                        {sc.label}
                        {section === sc.id && <Check size={13} className="ml-auto" />}
                      </button>
                    ))}
                  </>
                )}
              </Popover>
              <span className="hidden rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)] sm:inline" style={{ background: 'var(--well)' }}>
                {visible.length}
              </span>
              <div className="flex-1" />
              <div className="hidden lg:block"><AvatarStack users={users} max={5} /></div>
              <span className="mx-1 hidden h-6 w-px lg:block" style={{ background: 'var(--border)' }} />
            </>
          ) : (
            <>
              <h1 className="truncate text-[14px] font-semibold">{sectionTitle(section)}</h1>
              {section === 'meetings' && (
                <span className="hidden rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium text-[var(--text-secondary)] sm:inline" style={{ background: 'var(--well)' }}>
                  {meetings.length}
                </span>
              )}
              <div className="flex-1" />
            </>
          )}

          {section === 'meetings' && canScheduleMeeting(me) && (
            <button onClick={() => setScheduleOpen(true)} className="btn btn-primary py-1 text-[12.5px]">
              <Video size={13} />
              <span className="hidden sm:inline">Schedule meeting</span>
            </button>
          )}

          {BOARD_SECTIONS.includes(section) && (
            <>
              {/* view switcher */}
              <div className="flex shrink-0 items-center gap-0.5 rounded-md p-0.5" style={{ background: 'var(--bg-subtle)' }}>
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    className="btn px-2 py-1 text-[12.5px]"
                    style={{
                      background: view === v.id ? 'var(--bg)' : 'transparent',
                      boxShadow: view === v.id ? 'var(--shadow-sm)' : undefined,
                      color: view === v.id ? 'var(--text)' : 'var(--text-secondary)',
                    }}
                    title={`${v.label} view`}
                  >
                    {v.icon}
                    <span className="hidden sm:inline">{v.label}</span>
                  </button>
                ))}
              </div>

              {/* search */}
              {showSearch ? (
                <div className="flex items-center gap-1 rounded-md border px-2" style={{ background: 'var(--bg-input)' }}>
                  <Search size={13} className="text-[var(--text-tertiary)]" />
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onBlur={() => !search && setShowSearch(false)}
                    placeholder="Search tasks…"
                    className="w-40 bg-transparent py-1 text-[13px] outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} aria-label="Clear search">
                      <X size={13} className="text-[var(--text-tertiary)]" />
                    </button>
                  )}
                </div>
              ) : (
                <button onClick={() => setShowSearch(true)} className="btn btn-ghost px-1.5" title="Search (Ctrl+K)">
                  <Search size={15} />
                </button>
              )}

              <FilterMenu
                filters={filters}
                setFilters={setFilters}
                users={users}
                tags={tags}
                count={activeFilterCount}
              />

              {view === 'board' && (
                <Popover
                  width={180}
                  align="end"
                  trigger={({ toggle }) => (
                    <button onClick={toggle} className="btn btn-ghost px-1.5" title="Group by">
                      <Settings2 size={15} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                        Group by
                      </div>
                      {(['status', 'assignee', 'priority'] as GroupBy[]).map((g) => (
                        <button
                          key={g}
                          className="menu-item capitalize"
                          onClick={() => {
                            setGroupBy(g);
                            close();
                          }}
                        >
                          <span className="flex-1">{g}</span>
                          {groupBy === g && <Check size={13} />}
                        </button>
                      ))}
                    </>
                  )}
                </Popover>
              )}
            </>
          )}

          <span
            className="mr-0.5 hidden items-center gap-1.5 text-[11.5px] text-[var(--text-tertiary)] sm:inline-flex"
            title={
              live === 'live'
                ? 'Live — updates arrive the moment they happen'
                : live === 'connecting'
                  ? 'Connecting to the live feed…'
                  : 'Live feed offline — falling back to a refresh every 20s'
            }
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: live === 'live' ? '#10b981' : live === 'connecting' ? '#f59e0b' : '#94a3b8',
              }}
            />
            {live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting' : 'Offline'}
          </span>



          <button onClick={() => setNewTaskOpen(true)} className="btn btn-primary">
            <Plus size={14} />
            <span className="hidden sm:inline">Create task</span>
          </button>
        </header>

        {/* ---- body ---- */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {section === 'people' ? (
            <PeopleView me={me} onChanged={() => refresh()} onOpenSheet={setSheetUserId} />
          ) : section === 'dashboard' ? (
            <DashboardView tasks={tasks} users={users} onOpenTask={setOpenTaskId} />
          ) : section === 'activity' ? (
            <ActivityView
              notifications={notifications}
              onOpen={openFromNotification}
              onMarkAll={async () => { await api.notifications.read('all'); refreshNotifications(); }}
              onMarkOne={async (id) => { await api.notifications.read([id]); refreshNotifications(); }}
            />
          ) : section === 'messages' ? (
            <MessagesView
              me={me}
              users={users}
              openTaskId={messagesTaskId}
              onOpenTask={(id) => {
                // Task links in chat carry a ticket number, not an id.
                if (id.startsWith('seq:')) {
                  const seq = Number(id.slice(4));
                  const hit = tasks.flatMap((t) => [t, ...t.subtasks]).find((t) => t.seq === seq);
                  if (hit) setOpenTaskId(hit.id);
                  else flash(`TSK-${seq} is not on your board`);
                } else {
                  setOpenTaskId(id);
                }
              }}
              onUnread={setMessageUnread}
            />
          ) : section === 'profile' ? (
            <ProfileView
              me={me}
              theme={theme}
              onToggleTheme={toggleTheme}
              onSignedOut={() => router.replace('/login')}
              onOpenTask={setOpenTaskId}
            />
          ) : section === 'support' ? (
            <SupportView />
          ) : section === 'meetings' ? (
            <MeetingsView
              meetings={meetings}
              me={me}
              loading={meetingsLoading}
              scope={meetingScope}
              onScope={setMeetingScope}
              onChanged={refreshMeetings}
              onOpenTask={setOpenTaskId}
            />
          ) : visible.length === 0 ? (
            <Empty
              icon={section === 'inbox' ? <Inbox size={30} /> : <Archive size={30} />}
              title={emptyTitle(section, activeFilterCount > 0 || !!search)}
              hint={emptyHint(section, me.role)}
              action={
                section !== 'archived' && (
                  <button onClick={() => setNewTaskOpen(true)} className="btn btn-outline">
                    <Plus size={14} /> New task
                  </button>
                )
              }
            />
          ) : view === 'board' ? (
            <BoardView
              tasks={visible}
              users={users}
              me={me}
              groupBy={groupBy}
              onOpen={setOpenTaskId}
              onUpdate={updateTask}
              onSplit={(t) => setSplitTask(t)}
            />
          ) : view === 'table' ? (
            <TableView tasks={visible} users={users} me={me} onOpen={setOpenTaskId} onUpdate={updateTask} />
          ) : view === 'list' ? (
            <ListView tasks={visible} users={users} me={me} onOpen={setOpenTaskId} onUpdate={updateTask} />
          ) : (
            <CalendarView tasks={visible} onOpen={setOpenTaskId} onUpdate={updateTask} />
          )}
        </div>
      </main>

      {/* ---- overlays ---- */}
      {scheduleOpen && (
        <ScheduleMeetingModal
          users={users}
          me={me}
          onClose={() => setScheduleOpen(false)}
          onScheduled={(meeting) => {
            setScheduleOpen(false);
            setMeetings((prev) => [...prev, meeting].sort((a, b) => a.starts_at - b.starts_at));
            flash(
              meeting.join_url
                ? 'Meeting scheduled — invites are on their way'
                : 'Meeting saved, but Google did not issue a link. Try again from the card.'
            );
          }}
        />
      )}

      {openTask && (
        <TaskPanel
          taskId={openTask.id}
          me={me}
          users={users}
          tags={tags}
          reloadToken={panelReloadToken}
          onClose={() => setOpenTaskId(null)}
          onChanged={patchTaskLocal}
          onArchive={archiveTask}
          onDelete={deleteTask}
          onSplit={(t) => setSplitTask(t)}
          onOpenTask={setOpenTaskId}
          onTagCreated={(tag) => setTags((prev) => [...prev, tag])}
        />
      )}

      {sheetUserId && (
        <TaskSheetPanel
          userId={sheetUserId}
          me={me}
          onClose={() => setSheetUserId(null)}
          onOpenTask={(id) => {
            setSheetUserId(null);
            setOpenTaskId(id);
          }}
        />
      )}

      <NewTaskModal
        open={newTaskOpen}
        me={me}
        users={users}
        tags={tags}
        onClose={() => setNewTaskOpen(false)}
        onCreated={(task, routedTo) => {
          // The created task is already in the response — painting it locally
          // is instant, and the SSE echo refreshes the rest of the board.
          patchTaskLocal(task);
          setNewTaskOpen(false);
          flash(
            routedTo && task.assignee_id === routedTo.id
              ? `Task routed to ${routedTo.name} for triage`
              : 'Task created'
          );
        }}
      />

      {splitTask && (
        <SplitModal
          task={splitTask}
          users={users}
          onClose={() => setSplitTask(null)}
          onSplit={(updated) => {
            patchTaskLocal(updated);
            setSplitTask(null);
            // The detail panel holds its own copy — make it pick up the new subtasks.
            setPanelReloadToken((n) => n + 1);
            flash('Work split across the team');
            refresh();
          }}
        />
      )}

      {toast && (
        <div
          className="animate-pop fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-md px-3.5 py-2 text-[13px] font-medium text-white"
          style={{ background: '#2f2f2f', boxShadow: 'var(--shadow-lg)' }}
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FilterMenu({
  filters,
  setFilters,
  users,
  tags,
  count,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  users: User[];
  tags: Tag[];
  count: number;
}) {
  const toggle = <K extends keyof Filters>(key: K, value: string) => {
    const list = filters[key] as string[];
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    setFilters({ ...filters, [key]: next } as Filters);
  };

  return (
    <Popover
      width={230}
      align="end"
      trigger={({ toggle: t }) => (
        <button onClick={t} className="btn btn-ghost px-2" title="Filter">
          <ChevronDown size={13} />
          <span className="hidden text-[12.5px] sm:inline">Filter</span>
          {count > 0 && (
            <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold text-[var(--on-accent)]">{count}</span>
          )}
        </button>
      )}
    >
      {() => (
        <>
          <Group title="Status">
            {STATUSES.map((s) => (
              <button key={s.id} className="menu-item" onClick={() => toggle('status', s.id)}>
                <span className="h-2 w-2 rounded-full" style={{ background: s.dot }} />
                <span className="flex-1">{s.label}</span>
                {filters.status.includes(s.id) && <Check size={13} />}
              </button>
            ))}
          </Group>
          <Group title="Priority">
            {PRIORITIES.map((p) => (
              <button key={p.id} className="menu-item" onClick={() => toggle('priority', p.id)}>
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                <span className="flex-1">{p.label}</span>
                {filters.priority.includes(p.id) && <Check size={13} />}
              </button>
            ))}
          </Group>
          <Group title="Assignee">
            <button className="menu-item" onClick={() => toggle('assignee', '__none__')}>
              <Avatar user={null} size="xs" />
              <span className="flex-1">Unassigned</span>
              {filters.assignee.includes('__none__') && <Check size={13} />}
            </button>
            {users.map((u) => (
              <button key={u.id} className="menu-item" onClick={() => toggle('assignee', u.id)}>
                <Avatar user={u} size="xs" />
                <span className="flex-1 truncate">{u.name}</span>
                {filters.assignee.includes(u.id) && <Check size={13} />}
              </button>
            ))}
          </Group>
          {tags.length > 0 && (
            <Group title="Tags">
              {tags.map((t) => (
                <button key={t.id} className="menu-item" onClick={() => toggle('tag', t.id)}>
                  <span className="flex-1 truncate">{t.name}</span>
                  {filters.tag.includes(t.id) && <Check size={13} />}
                </button>
              ))}
            </Group>
          )}
          {count > 0 && (
            <>
              <div className="my-1 border-t" />
              <button className="menu-item text-[var(--text-secondary)]" onClick={() => setFilters(EMPTY_FILTERS)}>
                <X size={13} /> Clear all filters
              </button>
            </>
          )}
        </>
      )}
    </Popover>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        {title}
      </div>
      {children}
    </div>
  );
}

const sectionTitle = (s: Section) =>
  ({
    all: 'All tasks',
    inbox: 'Triage inbox',
    mine: 'My work',
    created: 'Raised by me',
    archived: 'Archive',
    people: 'Team',
    meetings: 'Schedule',
    activity: 'Activities',
    dashboard: 'Dashboard',
    messages: 'Messages',
    report: 'Report',
    profile: 'Settings',
    support: 'Support',
  })[s];

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const HOW_IT_WORKS: [string, string][] = [
  ['A Manager raises a task', "It lands in the Team Lead's triage inbox with the brief, links and any files or voice notes."],
  ['A Team Lead assigns or splits it', 'One developer, or several pieces each with their own owner and documents.'],
  ['Developers report progress', 'Tap the pips, say what is done and what is left, then submit for review.'],
  ['A Team Lead approves or sends it back', "Approval marks it done and closes the task's group chat."],
  ['Everyone is told', 'In-app, by email, by push on your phone, and in Slack if it is connected. Turn push on under Settings.'],
  ['Meetings', 'Schedule a Google Meet from Schedule; record the call and the minutes write themselves.'],
];

function SupportView() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h2 className="mb-1 text-[18px] font-bold">How Flow works</h2>
        <p className="mb-5 text-[13.5px] text-[var(--text-secondary)]">The chain of command, and where things go.</p>
        <ol className="card divide-y">
          {HOW_IT_WORKS.map(([h, b], i) => (
            <li key={h} className="flex gap-3 p-4">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{i + 1}</span>
              <span><span className="block text-[13.5px] font-semibold">{h}</span><span className="block text-[12.5px] text-[var(--text-secondary)]">{b}</span></span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-[12px] text-[var(--text-tertiary)]">Shortcuts: <kbd className="rounded border px-1">N</kbd> new task · <kbd className="rounded border px-1">Ctrl K</kbd> search · <kbd className="rounded border px-1">Esc</kbd> close.</p>
      </div>
    </div>
  );
}

function emptyTitle(section: Section, filtered: boolean) {
  if (filtered) return 'Nothing matches those filters';
  return {
    all: 'No tasks yet',
    inbox: 'Triage inbox is clear',
    mine: 'Nothing assigned to you',
    created: 'You have not raised anything yet',
    archived: 'Archive is empty',
    people: '', meetings: '', activity: '', dashboard: '', messages: '', report: '', profile: '', support: '',
  }[section];
}

function emptyHint(section: Section, role: string) {
  if (section === 'inbox') return 'New requests land here the moment an Employee raises them.';
  if (section === 'mine') {
    return role === 'DEV'
      ? 'Your Team Lead assigns work here. Nothing is waiting on you right now.'
      : 'Tasks assigned to you show up here.';
  }
  if (section === 'created') return 'Anything you raise routes straight to a Team Lead for triage.';
  return undefined;
}

export { roleShort };
