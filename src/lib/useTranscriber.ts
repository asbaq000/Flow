'use client';

import { useCallback, useRef } from 'react';
import { hasArabicScript, urduToRoman } from './urduRoman';
import { api, serializeDoc } from './client';
import { parseDoc } from './types';
import type { Block } from './types';

const SAMPLE_RATE = 16_000;

export interface TranscribeResult {
  /** Roman Urdu when the source was Urdu, the model's raw text otherwise. */
  text: string;
  lang: 'ur' | 'en' | null;
}

/*
 * A minute of audio per request. 16kHz mono PCM is about 2MB a minute, and
 * base64 adds a third on top — which lands safely under the ~4.5MB body a
 * serverless request will carry. Longer recordings go up a chunk at a time.
 */
const CHUNK_SECONDS = 60;

/** Wraps raw PCM in a WAV header, the one audio container these models take. */
function pcmToWav(pcm: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: string | number, text?: string) => {
    const [o, s] = typeof offset === 'number' ? [offset, text!] : [0, offset];
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  for (let i = 0; i < pcm.length; i++) {
    // Clamp before scaling: a sample slightly over 1.0 would wrap to silence.
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** btoa on a whole recording blows the call stack, so feed it in slices. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

/**
 * Decodes a recording into mono 16kHz PCM.
 *
 * This has to run on the main thread — AudioContext and OfflineAudioContext
 * are Window APIs, not available inside a Worker — which is exactly why the
 * heavy model inference is handed off to one separately.
 */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();

  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);

    if (decoded.sampleRate === SAMPLE_RATE && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0).slice();
    }

    const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    void ctx.close();
  }
}

type WorkerMsg =
  | { type: 'loaded' }
  | { type: 'progress'; progress: number }
  | { type: 'result'; id: string; text: string }
  | { type: 'error'; id: string; message: string };

let sharedWorker: Worker | null = null;
function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./transcribe.worker.ts', import.meta.url));
  }
  return sharedWorker;
}

/**
 * Client-side speech-to-text for voice notes. Runs entirely in the browser —
 * no server cost, no API key — trading that for a one-time ~40MB model
 * download on a visitor's first transcription (cached after) and running on
 * whatever CPU the visitor's device has.
 */
/** Letters and digits in any script, so Urdu counts as readily as English. */
const WORD_CHAR = /[\p{L}\p{N}]/gu;

/**
 * Whatever the model heard, or empty when it did not really hear anything.
 *
 * Fed silence or noise, Whisper does not return nothing — it returns filler
 * like ",,,,, ,,, ," or a lone "you", because it is built to always emit
 * something. Saving that as a transcript is worse than saving none: it looks
 * like the feature ran and produced gibberish. Anything without at least a
 * couple of real characters is treated as "nothing was said".
 */
export function spokenWords(raw: string): string {
  const text = raw.trim();
  if ((text.match(WORD_CHAR) ?? []).length < 2) return '';
  // Trim the punctuation runs Whisper tacks on around real speech.
  return text.replace(/^[\s\p{P}]+/u, '').replace(/[\s\p{P}]+$/u, (tail) =>
    /[.!?…]/.test(tail) ? tail.trimEnd() : ''
  ).trim();
}

/**
 * Sends the audio up a minute at a time and stitches the words back together.
 *
 * Returns null when the hosted model cannot do it — no key, no credit, or the
 * service is down — which is the caller's signal to fall back to the model in
 * the browser rather than leave somebody with no transcript at all.
 */
async function listenRemotely(
  audio: Float32Array,
  onProgress?: (percent: number) => void
): Promise<string | null> {
  const perChunk = CHUNK_SECONDS * SAMPLE_RATE;
  const chunks = Math.max(1, Math.ceil(audio.length / perChunk));
  const parts: string[] = [];

  for (let i = 0; i < chunks; i++) {
    const slice = audio.subarray(i * perChunk, Math.min((i + 1) * perChunk, audio.length));
    // A sliver of trailing audio is silence, not speech worth a round trip.
    if (slice.length < SAMPLE_RATE / 2) continue;

    let res;
    try {
      res = await api.transcripts.speech(toBase64(pcmToWav(slice)));
    } catch {
      return null;
    }

    // Unconfigured or refused: hand the whole job to the local model rather
    // than return half a transcript.
    if (!res.configured || res.error) {
      if (res.error) console.warn('[transcribe] hosted model refused:', res.error);
      return null;
    }

    if (res.text.trim()) parts.push(res.text.trim());
    onProgress?.(Math.round(((i + 1) / chunks) * 100));
  }

  return parts.join(' ').trim();
}

export function useTranscriber(onProgress?: (percent: number) => void) {
  // One in-flight request at a time per hook instance; the API-level "claim"
  // handles cross-tab/cross-visitor duplication.
  const busy = useRef(false);
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;

  const transcribe = useCallback(async (blob: Blob): Promise<TranscribeResult> => {
    if (busy.current) throw new Error('A transcription is already running');
    busy.current = true;

    try {
      const audio = await decodeToMono16k(blob);

      /*
       * The hosted speech model first. It hears Urdu properly, handles a
       * sentence that switches language halfway, and costs a visitor nothing
       * to download. Whisper stays behind it for installs with no API key,
       * and for the times the service will not answer.
       */
      const heard = await listenRemotely(audio, progressRef.current);
      if (heard !== null) {
        const speech = spokenWords(heard);
        if (!speech) return { text: '', lang: null };
        return { text: speech, lang: hasArabicScript(speech) ? 'ur' : 'en' };
      }

      const worker = getWorker();
      const id = Math.random().toString(36).slice(2);

      const rawText = await new Promise<string>((resolve, reject) => {
        const onMessage = (e: MessageEvent<WorkerMsg>) => {
          const msg = e.data;
          if (msg.type === 'result' && msg.id === id) {
            worker.removeEventListener('message', onMessage);
            resolve(msg.text);
          } else if (msg.type === 'error' && msg.id === id) {
            worker.removeEventListener('message', onMessage);
            reject(new Error(msg.message));
          } else if (msg.type === 'progress') {
            // The model is a large one-time download; without this the UI
            // would just sit on "Transcribing…" for minutes the first time.
            progressRef.current?.(msg.progress);
          }
        };
        worker.addEventListener('message', onMessage);
        // The Float32Array's buffer is transferred, not copied — cheap even
        // for a multi-minute recording.
        worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
      });

      const speech = spokenWords(rawText);
      if (!speech) return { text: '', lang: null };

      const isUrdu = hasArabicScript(speech);

      /*
       * Hand the raw hearing to the language model, which punctuates it,
       * repairs mis-heard words and writes Urdu as people actually type it.
       * When it is unavailable the local result stands: the rule-based
       * transliteration for Urdu, the raw text for English.
       */
      try {
        const polished = await api.transcripts.polish(speech, isUrdu ? 'ur' : 'en');
        if (polished.polished && polished.text.trim()) {
          return { text: polished.text.trim(), lang: isUrdu ? 'ur' : 'en' };
        }
      } catch {
        // Falls through to the local result below.
      }

      if (isUrdu) return { text: urduToRoman(speech), lang: 'ur' };
      return { text: speech, lang: 'en' };
    } finally {
      busy.current = false;
    }
  }, []);

  return { transcribe };
}

/**
 * Adds the spoken words to a description as a new paragraph.
 *
 * A brand-new task's description is a single empty paragraph, so the common
 * case is filling that in rather than appending below it. Existing writing is
 * never overwritten — the transcript goes underneath whatever is already
 * there.
 */
export function withTranscriptAppended(doc: Block[], text: string): Block[] {
  const blocks = doc.length ? doc : parseDoc(null);
  const paragraph: Block = {
    id: 'b' + Math.random().toString(36).slice(2, 10),
    type: 'paragraph',
    text,
  };

  const onlyBlockIsEmpty = blocks.length === 1 && !blocks[0].text.trim() && blocks[0].type === 'paragraph';
  if (onlyBlockIsEmpty) return [{ ...blocks[0], text }];

  return [...blocks, paragraph];
}

/** Writes a transcript into a task's description, reading its current one first. */
export async function appendTranscriptToDescription(taskId: string, text: string): Promise<void> {
  const { task } = await api.tasks.get(taskId);
  const next = withTranscriptAppended(parseDoc(task.description), text);
  await api.tasks.update(taskId, { description: serializeDoc(next) });
}

/** True when this browser can plausibly run the transcriber at all. */
export function transcriptionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) &&
      typeof Worker !== 'undefined'
  );
}

/**
 * Fire-and-forget: claims, transcribes, and saves the result for a note that
 * was just recorded — called right after upload, using the Blob still held
 * in memory from the recording rather than re-downloading the audio.
 *
 * "Claim" first, so if the recorder's tab and a teammate who already opened
 * the task both attempt this, only one of them actually runs the model.
 * Every failure is swallowed on purpose: transcription is a bonus on top of
 * a voice note that has already saved successfully, and must never surface
 * as an error about the note itself.
 */
export async function autoTranscribe(
  voiceNoteId: string,
  blob: Blob,
  transcribe: (blob: Blob) => Promise<TranscribeResult>,
  /**
   * Called with the finished transcript, for notes on a task's brief — it is
   * what copies the spoken words into the description. Left off for notes on
   * a comment, where the transcript belongs under the comment instead.
   */
  onTranscribed?: (text: string) => Promise<void> | void
): Promise<void> {
  try {
    const { claimed } = await api.voice.claimTranscription(voiceNoteId);
    if (!claimed) return;

    const { text, lang } = await transcribe(blob);
    if (!text) {
      await api.voice.markTranscriptFailed(voiceNoteId);
      return;
    }
    await api.voice.saveTranscript(voiceNoteId, text, lang);

    // Kept separate from the save above: if writing the description fails
    // (say the recorder may not edit the brief), the transcript itself is
    // already stored and still shows under the note.
    try {
      await onTranscribed?.(text);
    } catch (err) {
      console.warn('[transcribe] could not write transcript into the description', err);
    }
  } catch (err) {
    console.warn('[transcribe] failed for', voiceNoteId, err);
    await api.voice.markTranscriptFailed(voiceNoteId).catch(() => {});
  }
}
