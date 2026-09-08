import { currentUser } from '@/lib/auth';
import { fail } from '@/lib/api';
import { getUser, taskSheet } from '@/lib/store';
import { canViewTaskSheet } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Somebody's whole record as a spreadsheet: every task they finished and
 * every one still open, with the dates that show how long each took.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id: raw } = await params;
  const id = raw === 'me' ? user.id : raw;
  const target = await getUser(id);
  if (!target || target.org_id !== user.org_id) return fail('Person not found', 404);
  if (!canViewTaskSheet(user, target)) return fail('You cannot export this record', 403);

  const sheet = await taskSheet(id);
  if (!sheet) return fail('Nothing to export', 404);

  const header = ['Ticket', 'Title', 'Status', 'Priority', 'Tags', 'Parent', 'Assigned by',
    'Created', 'Due', 'Completed', 'Turnaround (hours)', 'On time', 'Comments'];
  const rows = [...sheet.completed, ...sheet.active].map((e) => [
    `TSK-${e.seq}`, e.title, e.status, e.priority,
    e.tags.map((t) => t.name).join(' '), e.parent_title ?? '', e.assigned_by ?? '',
    new Date(e.created_at).toISOString(),
    e.due_date ? new Date(e.due_date).toISOString() : '',
    e.completed_at ? new Date(e.completed_at).toISOString() : '',
    e.turnaround_ms === null ? '' : (e.turnaround_ms / 3_600_000).toFixed(1),
    e.on_time === null ? '' : e.on_time ? 'yes' : 'no',
    e.comment_count,
  ]);

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${target.name.replace(/[^\w-]+/g, '_')}_flow_${stamp}.csv`;

  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
