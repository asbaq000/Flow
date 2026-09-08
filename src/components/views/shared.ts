import type { Status } from '@/lib/types';

const DAY = 86_400_000;

/** Human due-date label plus an urgency colour. Returns null when there is no date. */
export function dueMeta(due: number | null, status: Status): { label: string; color: string } | null {
  if (!due) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(due);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / DAY);

  const neutral = 'var(--text-tertiary)';
  if (status === 'DONE') return { label: formatDay(target), color: neutral };

  if (days < 0) return { label: days === -1 ? 'Yesterday' : `${Math.abs(days)}d overdue`, color: '#e03e3e' };
  if (days === 0) return { label: 'Today', color: '#d9730d' };
  if (days === 1) return { label: 'Tomorrow', color: '#d9730d' };
  if (days <= 7) return { label: `${days}d left`, color: 'var(--text-secondary)' };
  return { label: formatDay(target), color: neutral };
}

export function formatDay(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "3h ago", "2d ago" — compact relative time for feeds. */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDay(new Date(ms));
}

/** yyyy-mm-dd in local time, for <input type="date"> round-trips. */
export function toDateInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}


/**
 * A stable hue for a task, so the same card is the same colour on every
 * screen and after every reload. Derived from the id rather than stored:
 * a colour nobody chose does not deserve a column in the database.
 *
 * Hues are pulled off a 12-step wheel with the muddy yellow-greens skipped,
 * so two cards side by side stay easy to tell apart and none of them turns
 * the text grey.
 */
const TINT_HUES = [352, 330, 300, 270, 245, 215, 190, 168, 140, 96, 42, 22];

export function tintHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINT_HUES[h % TINT_HUES.length];
}
