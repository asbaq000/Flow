import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { addVoiceNote, getComment, getTask } from '@/lib/store';
import { canAddCommentVoiceNote, canAddTaskVoiceNote, canView } from '@/lib/permissions';

type Ctx = { params: Promise<{ id: string }> };

/** 8 MB is roughly 15 minutes of Opus at the bitrate the recorder uses. */
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

export async function POST(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail('Task not found', 404);
  if (!canView(user, task)) return fail('You do not have access to this task', 403);

  const form = await req.formData();
  const file = form.get('audio');
  const commentId = (form.get('commentId') as string) || null;
  const durationMs = Number(form.get('durationMs') ?? 0);

  if (!(file instanceof Blob)) return fail('No audio was uploaded');
  if (file.size === 0) return fail('The recording was empty');
  if (file.size > MAX_BYTES) return fail('That recording is too long — keep it under 8 MB');

  // A note on the brief follows the brief's edit rules; one on a comment
  // only needs comment access.
  if (commentId) {
    const comment = await getComment(commentId);
    if (!comment || comment.task_id !== id) return fail('Comment not found', 404);
    if (comment.author_id !== user.id) return fail('You can only attach audio to your own comment', 403);
    if (!canAddCommentVoiceNote(user, task)) return fail('You cannot comment on this task', 403);
  } else if (!canAddTaskVoiceNote(user, task)) {
    return fail('Only the person who raised this task or a Team Lead can add notes to the brief', 403);
  }

  const baseMime = (file.type || 'audio/webm').split(';')[0].trim();
  const mime = ALLOWED_MIME.includes(baseMime) ? baseMime : 'audio/webm';

  const note = await addVoiceNote({
    taskId: id,
    commentId,
    authorId: user.id,
    mime,
    durationMs,
    data: Buffer.from(await file.arrayBuffer()),
  });

  return ok({ voiceNote: note }, 201);
}
