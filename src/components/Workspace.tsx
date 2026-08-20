'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive, Bell, CalendarDays, Check, ChevronDown, Columns3, Inbox, LayoutList, Menu, Moon,
  Plus, Search, Settings2, Sun, Table2, Users2, X,
} from 'lucide-react';
import type { Notification, Priority, Status, Tag, TaskFull, User } from '@/lib/types';
import { PRIORITIES, STATUSES } from '@/lib/types';
import { api } from '@/lib/client';
import { useLiveEvents } from '@/lib/useLiveEvents';
import { canSplit } from '@/lib/permissions';
import { Avatar, Empty, Popover, roleShort } from './ui';
import Sidebar from './Sidebar';
import BoardView from './views/BoardView';
import TableView from './views/TableView';
import ListView from './views/ListView';
import CalendarView from './views/CalendarView';
import PeopleView from './views/PeopleView';
import TaskPanel from './TaskPanel';
import NewTaskModal from './NewTaskModal';
import SplitModal from './SplitModal';
import NotificationsPanel from './NotificationsPanel';
import TaskSheetPanel from './TaskSheetPanel';

export type ViewKind = 'board' | 'table' | 'list' | 'calendar';
export type Section = 'all' | 'inbox' | 'mine' | 'created' | 'archived' | 'people';
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

  const [section, setSection] = useState<Section>(
    me.role === 'TEAM_LEAD' || me.role === 'CEO' ? 'inbox' : 'mine'
  );
  const [view, setView] = useState<ViewKind>('board');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

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

  useEffect(() => {
    refresh();
  }, [section, refresh]);

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
        refresh();
        if (event.type === 'task.updated' || event.type === 'task.created') {
          refreshNotifications();
        }
      },
      [refresh, refreshNotifications]
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
          counts={counts}
          onSection={(s) => {
            setSection(s);
            setOpenTaskId(null);
            if (isMobile) setSidebarOpen(false);
          }}
          onNewTask={() => {
            setNewTaskOpen(true);
            if (isMobile) setSidebarOpen(false);
          }}
          onOpenMySheet={() => {
            setSheetUserId(me.id);
            if (isMobile) setSidebarOpen(false);
          }}
          onLogout={async () => {
            await api.logout();
            // login/page.tsx is force-dynamic too — see the note in AuthForm's submit.
            router.replace('/login');
          }}
          theme={theme}
          onToggleTheme={toggleTheme}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* ---- header ---- */}
        <header className="flex h-[46px] shrink-0 items-center gap-2 border-b px-3">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost px-1.5" aria-label="Show menu">
              <Menu size={16} />
            </button>
          )}

          <h1 className="truncate text-[14px] font-semibold">{sectionTitle(section)}</h1>
          <span className="hidden rounded bg-[var(--bg-active)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] sm:inline">
            {visible.length}
          </span>

          <div className="flex-1" />

          {section !== 'people' && (
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
                onOpenTask={(id) => {
                  setOpenTaskId(id);
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

          <button onClick={() => setNewTaskOpen(true)} className="btn btn-primary">
            <Plus size={14} />
            <span className="hidden sm:inline">New</span>
          </button>
        </header>

        {/* ---- body ---- */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {section === 'people' ? (
            <PeopleView me={me} onChanged={() => refresh()} onOpenSheet={setSheetUserId} />
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
          patchTaskLocal(task);
          setNewTaskOpen(false);
          flash(
            routedTo && task.assignee_id === routedTo.id
              ? `Task routed to ${routedTo.name} for triage`
              : 'Task created'
          );
          refresh();
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
            <span className="rounded bg-[var(--accent)] px-1 text-[10px] font-bold text-white">{count}</span>
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
    people: 'People',
  })[s];

function emptyTitle(section: Section, filtered: boolean) {
  if (filtered) return 'Nothing matches those filters';
  return {
    all: 'No tasks yet',
    inbox: 'Triage inbox is clear',
    mine: 'Nothing assigned to you',
    created: 'You have not raised anything yet',
    archived: 'Archive is empty',
    people: '',
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
