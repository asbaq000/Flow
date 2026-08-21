import { currentUser } from '@/lib/auth';
import { fail, ok, readJson } from '@/lib/api';
import { openRouterEnabled, speechModel, transcribeAudio } from '@/lib/openrouter';

/**
 * Listens to a piece of a recording and returns the words in it.
 *
 * The browser decodes whatever the recorder produced, re-encodes it as WAV and
 * sends it a minute at a time. A minute rather than the whole recording
 * because a serverless request body caps out around 4.5 MB, and 16kHz mono
 * WAV is about 2 MB a minute before base64 inflates it by a third.
 */

interface Body {
  /** Base64 WAV, one chunk of the recording. */
  audio?: string;
}

/*
 * Comfortably under the platform's request cap, with room for the JSON
 * around it. Anything larger is the client failing to chunk, not a user
 * doing something unreasonable.
 */
const MAX_BASE64 = 4_000_000;

export async function GET() {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  return ok({
    configured: openRouterEnabled,
    model: speechModel,
    hint: openRouterEnabled
      ? 'Recordings are transcribed by the speech model.'
      : 'No OPENROUTER_API_KEY here, so transcription falls back to the in-browser model.',
  });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Not signed in', 401);

  const body = await readJson<Body>(req);
  const audio = body.audio ?? '';

  if (!audio) return fail('There is no audio to transcribe');
  if (audio.length > MAX_BASE64) return fail('That audio chunk is too large');

  if (!openRouterEnabled) {
    // A normal state, not an error: the browser falls back to its own model.
    return ok({ text: '', configured: false });
  }

  const result = await transcribeAudio(audio);

  if (result.error) {
    /*
     * Surfaced rather than swallowed. The usual cause is an OpenRouter
     * account with no credit — audio needs a positive balance — and that is
     * worth saying plainly instead of leaving someone to wonder why every
     * recording comes back empty.
     */
    return ok({ text: '', configured: true, error: result.error });
  }

  return ok({ text: result.text, configured: true });
}
