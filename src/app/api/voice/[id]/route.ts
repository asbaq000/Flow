import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import {
  claimVoiceTranscription, deleteVoiceNote, getTask, getVoiceNote, getVoiceNoteData,
  setVoiceTranscript,
} from '@/lib/store';
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

interface PatchBody {
  /** 'claim' locks the note so only one open tab transcribes it at a time. */
  action?: 'claim';
  status?: 'done' | 'failed';
  transcript?: string;
  lang?: string | null;
}

/**
 * Transcription runs entirely in the requester's browser (see
 * src/lib/transcribe.ts) — this endpoint only records the result. Anyone who
 * can view the task can transcribe its recordings; the work is derived and
 * non-destructive, so this is deliberately broader than delete access.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const note = await getVoiceNote(id);
  if (!note) return fail('Voice note not found', 404);

  const task = await getTask(note.task_id);
  if (!task || !canView(user, task)) return fail('You do not have access to this recording', 403);

  const body = await readJson<PatchBody>(req);

  if (body.action === 'claim') {
    return ok({ claimed: await claimVoiceTranscription(id) });
  }

  if (body.status === 'done') {
    if (!body.transcript || !body.transcript.trim()) return fail('Transcript text is empty');
    /*
     * Fed silence, Whisper answers with filler like ",,,, ,," rather than
     * nothing. The client screens that out, but a stored transcript is what
     * people end up reading, so refuse it here as well.
     */
    if ((body.transcript.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) {
      return fail('That transcript has no words in it');
    }
    const updated = await setVoiceTranscript(id, {
      status: 'done',
      transcript: body.transcript.trim(),
      lang: body.lang ?? null,
    });
    return ok({ voiceNote: updated });
  }

  if (body.status === 'failed') {
    const updated = await setVoiceTranscript(id, { status: 'failed' });
    return ok({ voiceNote: updated });
  }

  return fail('Nothing to update');
}
