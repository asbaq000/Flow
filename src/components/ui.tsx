'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { PRIORITIES, STATUSES } from '@/lib/types';
import type { Priority, Status, Tag, User } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */

const SIZES = { xs: 18, sm: 22, md: 28, lg: 36, xl: 56 } as const;

export function Avatar({
  user,
  size = 'sm',
  ring = false,
}: {
  user: Pick<User, 'name' | 'avatar_color'> | null | undefined;
  size?: keyof typeof SIZES;
  ring?: boolean;
}) {
  const px = SIZES[size];
  if (!user) {
    return (
      <div
        className="grid shrink-0 place-items-center rounded-full border border-dashed text-[var(--text-tertiary)]"
        style={{ width: px, height: px, fontSize: px * 0.42 }}
        aria-label="Unassigned"
      >
        ?
      </div>
    );
  }
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{
        width: px,
        height: px,
        background: user.avatar_color,
        fontSize: px * 0.4,
        boxShadow: ring ? '0 0 0 2px var(--bg)' : undefined,
      }}
      title={user.name}
    >
      {initials}
    </div>
  );
}

export function AvatarStack({ users, max = 3 }: { users: User[]; max?: number }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((u, i) => (
        <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <Avatar user={u} size="xs" ring />
        </div>
      ))}
      {extra > 0 && (
        <div
          className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--bg-active)] px-1 text-[9px] font-semibold text-[var(--text-secondary)]"
          style={{ marginLeft: -6, boxShadow: '0 0 0 2px var(--bg)' }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Popover — anchored, portalled, flips when it would overflow          */
/* ------------------------------------------------------------------ */

export function Popover({
  trigger,
  children,
  align = 'start',
  width = 220,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'start' | 'end';
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (v: boolean) => {
    if (controlledOpen === undefined) setUncontrolled(v);
    onOpenChange?.(v);
  };

  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;

    const place = () => {
      const rect = anchorRef.current!.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 260;
      const gap = 4;

      let top = rect.bottom + gap;
      if (top + menuH > window.innerHeight - 8) {
        // Not enough room below — flip above the trigger.
        top = Math.max(8, rect.top - menuH - gap);
      }
      let left = align === 'end' ? rect.right - width : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

      setPos({ top, left });
    };

    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div ref={anchorRef} className="inline-flex">
        {trigger({ open, toggle: () => setOpen(!open) })}
      </div>
      {mounted && open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="menu animate-pop scroll-thin fixed max-h-[min(420px,70vh)] overflow-y-auto"
              style={{ top: pos.top, left: pos.left, width }}
            >
              {children(() => setOpen(false))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Status & priority                                                   */
/* ------------------------------------------------------------------ */

export const statusMeta = (s: Status) => STATUSES.find((x) => x.id === s)!;
export const priorityMeta = (p: Priority) => PRIORITIES.find((x) => x.id === p)!;

export function StatusBadge({ status, compact = false }: { status: Status; compact?: boolean }) {
  const meta = statusMeta(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-medium"
      style={{ background: `${meta.dot}1f`, color: meta.dot }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.dot }} />
      {!compact && meta.label}
    </span>
  );
}

export function StatusPicker({
  value,
  onChange,
  disabled,
  children,
  allowed,
}: {
  value: Status;
  onChange: (s: Status) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  /** Restricts the menu to statuses this user may actually set. */
  allowed?: Status[];
}) {
  if (disabled) return <>{children ?? <StatusBadge status={value} />}</>;
  return (
    <Popover
      width={190}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="rounded-[4px] hover:bg-[var(--bg-hover)]">
          {children ?? <StatusBadge status={value} />}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
            Status
          </div>
          {STATUSES.filter((s) => !allowed || allowed.includes(s.id) || s.id === value).map((s) => {
            const locked = allowed ? !allowed.includes(s.id) : false;
            return (
              <button
                key={s.id}
                className="menu-item"
                disabled={locked}
                style={locked ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                title={locked ? 'Only a Team Lead can set this' : undefined}
                onClick={() => {
                  if (locked) return;
                  onChange(s.id);
                  close();
                }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.dot }} />
                <span className="flex-1">{s.label}</span>
                {value === s.id && <Check size={13} className="text-[var(--text-secondary)]" />}
              </button>
            );
          })}
        </>
      )}
    </Popover>
  );
}

export function PriorityBadge({ priority, showNone = false }: { priority: Priority; showNone?: boolean }) {
  const meta = priorityMeta(priority);
  if (priority === 'NONE' && !showNone) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: meta.color }}>
      <PriorityBars priority={priority} />
      {meta.label}
    </span>
  );
}

/** Signal-bar glyph: taller bars mean higher urgency. */
export function PriorityBars({ priority }: { priority: Priority }) {
  const meta = priorityMeta(priority);
  const filled = 4 - meta.weight;
  return (
    <span className="inline-flex h-3 items-end gap-[1.5px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px]"
          style={{
            height: 4 + i * 3,
            background: i < filled ? meta.color : 'var(--border-strong)',
          }}
        />
      ))}
    </span>
  );
}

export function PriorityPicker({
  value,
  onChange,
  disabled,
  children,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const fallback = (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <PriorityBars priority={value} />
      {priorityMeta(value).label}
    </span>
  );
  if (disabled) return <>{children ?? fallback}</>;
  return (
    <Popover
      width={170}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="rounded-[4px] px-1 py-0.5 hover:bg-[var(--bg-hover)]">
          {children ?? fallback}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
            Priority
          </div>
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              className="menu-item"
              onClick={() => {
                onChange(p.id);
                close();
              }}
            >
              <PriorityBars priority={p.id} />
              <span className="flex-1">{p.label}</span>
              {value === p.id && <Check size={13} className="text-[var(--text-secondary)]" />}
            </button>
          ))}
        </>
      )}
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* People picker                                                       */
/* ------------------------------------------------------------------ */

export function UserPicker({
  users,
  value,
  onChange,
  disabled,
  allowUnassign = true,
  children,
  label = 'Assign to',
  pinned = [],
}: {
  users: User[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  allowUnassign?: boolean;
  children?: React.ReactNode;
  label?: string;
  /**
   * People shown in addition to `users` — used for the current holder of a
   * task when they are outside the selectable set (a Team Lead during triage),
   * so the field still reads correctly without offering them as a target.
   */
  pinned?: User[];
}) {
  const [query, setQuery] = useState('');
  const selected = [...users, ...pinned].find((u) => u.id === value) ?? null;

  const fallback = (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <Avatar user={selected} size="xs" />
      <span className={selected ? '' : 'text-[var(--text-tertiary)]'}>{selected?.name ?? 'Unassigned'}</span>
    </span>
  );

  if (disabled) return <>{children ?? fallback}</>;

  const filtered = users.filter((u) => u.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <Popover
      width={250}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="rounded-[4px] px-1 py-0.5 text-left hover:bg-[var(--bg-hover)]">
          {children ?? fallback}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="p-1">
            <input
              autoFocus
              className="input py-1 text-[13px]"
              placeholder={`${label}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {allowUnassign && (
            <button
              className="menu-item"
              onClick={() => {
                onChange(null);
                close();
              }}
            >
              <Avatar user={null} size="xs" />
              <span className="flex-1 text-[var(--text-secondary)]">Unassigned</span>
              {value === null && <Check size={13} />}
            </button>
          )}
          {!filtered.length && !query && (
            <div className="px-2 py-3 text-center text-[12.5px] text-[var(--text-tertiary)]">
              No developers yet. An Admin can set roles on the People page.
            </div>
          )}
          {filtered.map((u) => (
            <button
              key={u.id}
              className="menu-item"
              onClick={() => {
                onChange(u.id);
                close();
              }}
            >
              <Avatar user={u} size="xs" />
              <span className="flex-1 truncate">
                {u.name}
                <span className="ml-1 text-[11px] text-[var(--text-tertiary)]">{roleShort(u.role)}</span>
              </span>
              {value === u.id && <Check size={13} />}
            </button>
          ))}
          {!filtered.length && (
            <div className="px-2 py-3 text-center text-[12.5px] text-[var(--text-tertiary)]">No people found</div>
          )}
        </>
      )}
    </Popover>
  );
}

export const roleShort = (role: string) =>
  ({ CEO: 'CEO', MANAGER: 'Manager', TEAM_LEAD: 'Lead', DEV: 'Dev' })[role] ?? role;

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

const TAG_STYLES: Record<string, { bg: string; fg: string }> = {
  gray: { bg: 'rgba(120,119,116,0.18)', fg: '#787774' },
  brown: { bg: 'rgba(159,107,63,0.18)', fg: '#9f6b3f' },
  orange: { bg: 'rgba(217,115,13,0.18)', fg: '#d9730d' },
  yellow: { bg: 'rgba(203,145,47,0.2)', fg: '#cb912f' },
  green: { bg: 'rgba(68,131,97,0.18)', fg: '#448361' },
  blue: { bg: 'rgba(51,126,169,0.18)', fg: '#337ea9' },
  purple: { bg: 'rgba(144,101,176,0.18)', fg: '#9065b0' },
  pink: { bg: 'rgba(193,76,138,0.18)', fg: '#c14c8a' },
  red: { bg: 'rgba(212,76,71,0.18)', fg: '#d44c47' },
};

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  const style = TAG_STYLES[tag.color] ?? TAG_STYLES.gray;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[11.5px] font-medium"
      style={{ background: style.bg, color: style.fg }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="opacity-50 hover:opacity-100" aria-label={`Remove ${tag.name}`}>
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]"
      style={{ background: 'rgba(15,15,15,0.42)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="animate-pop w-full rounded-lg"
        style={{ maxWidth: width, background: 'var(--bg-panel)', boxShadow: 'var(--shadow-lg)' }}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="btn btn-ghost -mr-1 px-1.5 py-1" aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-3 text-[var(--text-tertiary)]">{icon}</div>
      <p className="text-[14px] font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] text-[var(--text-secondary)]">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
