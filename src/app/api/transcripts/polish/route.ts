import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { cleanTranscript, openRouterEnabled, writeMinutes } from '@/lib/openrouter';

/**
 * Tidies a transcript, or writes minutes from one.
 *
 * Whisper runs in the browser, but the language model cannot: its key would be
 * readable by anyone with devtools. So the browser sends the text it heard and
 * gets back a better version of it.
 */

interface Body {
  text?: string;
  lang?: 'ur' | 'en' | null;
  /** 'clean' tidies a transcript; 'minutes' summarises a meeting. */
  mode?: 'clean' | 'minutes';
}

const MAX_CHARS = 60_000;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const body = await readJson<Body>(req);
  const text = (body.text ?? '').trim();

  if (!text) return fail('There is no text to work on');
  if (text.length > MAX_CHARS) return fail('That transcript is too long to polish');

  // Not configured is a normal state, not an error: the caller keeps what it
  // already had and nothing about the recording is lost.
  if (!openRouterEnabled) {
    return ok({ text, lang: body.lang ?? null, polished: false });
  }

  if (body.mode === 'minutes') {
    const minutes = await writeMinutes(text);
    return ok({ text: minutes ?? text, lang: body.lang ?? null, polished: Boolean(minutes) });
  }

  const cleaned = await cleanTranscript(text, body.lang ?? null);
  return ok({
    text: cleaned.text,
    lang: cleaned.lang,
    polished: cleaned.text !== text,
  });
}
