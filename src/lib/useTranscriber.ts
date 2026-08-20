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

      if (!rawText) return { text: '', lang: null };

      if (hasArabicScript(rawText)) {
        return { text: urduToRoman(rawText), lang: 'ur' };
      }
      return { text: rawText, lang: 'en' };
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
