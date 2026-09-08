import { currentUser } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { getAvatar, getUser, setAvatar } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

/** Raster only. An SVG is a document that can run script, not a picture. */
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_BYTES = 1024 * 1024;

export async function GET(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  const target = await getUser(id);
  if (!target || target.org_id !== user.org_id) return fail('No picture', 404);
  const avatar = await getAvatar(id);
  if (!avatar) return fail('No picture', 404);

  /*
   * A picture is cached hard but never blindly: the URL carries the version
   * stamp, and the ETag carries it too. So a browser holding an old copy
   * revalidates and is told about the new one in a 304-sized answer, rather
   * than showing yesterday's face until some timer runs out.
   */
  const etag = `"${id}-${avatar.version}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, no-cache' } });
  }

  return new Response(new Uint8Array(avatar.data), {
    headers: {
      'Content-Type': avatar.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-cache',
      ETag: etag,
    },
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const { id } = await params;
  if (id !== user.id && id !== 'me') return fail('You can only change your own picture', 403);

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) return fail('No picture was uploaded');
  if (file.size > MAX_BYTES) return fail('Keep the picture under 1 MB');

  const mime = (file.type || '').split(';')[0].trim();
  if (!ALLOWED.has(mime)) return fail('Use a PNG, JPEG, WebP or GIF');

  const version = await setAvatar(user.id, Buffer.from(await file.arrayBuffer()), mime);
  return ok({ ok: true, version });
}
