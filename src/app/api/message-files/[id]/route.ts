import { currentUser } from '@/lib/auth';
import { fail } from '@/lib/api';
import { getMessageFile, isConversationMember } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * The bytes behind a file sent in chat. Only people in that conversation can
 * fetch it. Pictures and voice notes are served as what they are so they show
 * and play in the thread; everything else is a download under an opaque type,
 * so a document can never run as a page.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const file = await getMessageFile(id);
  if (!file) return fail('File not found', 404);
  if (!(await isConversationMember(file.conversation_id, user.id))) {
    return fail('You are not in this conversation', 403);
  }

  const inline =
    (file.kind === 'image' && IMAGE_MIMES.has(file.mime)) ||
    (file.kind === 'voice' && file.mime.startsWith('audio/'));

  const ascii = file.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': inline ? file.mime : 'application/octet-stream',
      'Content-Length': String(file.data.length),
      'Content-Disposition':
        `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
