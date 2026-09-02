import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { deleteAttachment, getAttachment, getAttachmentData, getTask } from '@/lib/store';
import { canRemoveAttachment, canView } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Hands back an uploaded file.
 *
 * Always as a download, never rendered in place. An HTML or SVG file uploaded
 * to a task and then opened inline would run its own script on this origin,
 * with the viewer's session — so the content type is discarded on the way out
 * and the browser is told, twice, not to interpret what it is given.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const meta = await getAttachment(id);
  if (!meta) return fail('File not found', 404);

  const task = await getTask(meta.task_id);
  if (!task || !canView(user, task)) return fail('You do not have access to this file', 403);

  const row = await getAttachmentData(id);
  if (!row) return fail('File not found', 404);

  // RFC 5987, so a name with spaces or non-Latin characters survives.
  const encoded = encodeURIComponent(meta.filename);

  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(row.data.byteLength),
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
      'X-Content-Type-Options': 'nosniff',
      // Private: this is somebody's file behind a permission check.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const meta = await getAttachment(id);
  if (!meta) return fail('File not found', 404);

  const task = await getTask(meta.task_id);
  if (!task || !canView(user, task)) return fail('You do not have access to this file', 403);
  if (!canRemoveAttachment(user, meta)) {
    return fail('Only whoever uploaded this, or a Team Lead, can remove it', 403);
  }

  await deleteAttachment(id);
  return ok({ ok: true });
}
