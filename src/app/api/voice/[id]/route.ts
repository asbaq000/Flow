import { currentUser } from '@/lib/auth';
import { fail } from '@/lib/api';
import { deleteVoiceNote, getTask, getVoiceNote, getVoiceNoteData } from '@/lib/store';
import { canView } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

/** Streams the audio itself. Access mirrors access to the parent task. */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const note = await getVoiceNote(id);
  if (!note) return fail('Voice note not found', 404);

  const task = await getTask(note.task_id);
  if (!task || !canView(user, task)) return fail('You do not have access to this recording', 403);

  const payload = await getVoiceNoteData(id);
  if (!payload) return fail('Voice note not found', 404);

  return new Response(new Uint8Array(payload.data), {
    headers: {
      'Content-Type': payload.mime,
      'Content-Length': String(payload.data.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `inline; filename="voice-${id}.webm"`,
    },
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const note = await getVoiceNote(id);
  if (!note) return fail('Voice note not found', 404);

  // Authors clean up their own recordings; admins can clean up anything.
  if (note.author_id !== user.id && user.role !== 'CEO') {
    return fail('You can only delete your own recordings', 403);
  }

  await deleteVoiceNote(id);
  return Response.json({ ok: true });
}
