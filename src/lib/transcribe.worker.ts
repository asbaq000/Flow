/**
 * Runs the speech model off the main thread so a multi-second transcription
 * never freezes the UI. This file only does inference — decoding the
 * recording into PCM audio happens on the main thread first (see
 * useTranscriber.ts), because AudioContext/OfflineAudioContext are not
 * available inside a Worker.
 *
 * The model itself is fetched from Hugging Face's public CDN the first time
 * any voice note is transcribed, then cached by the browser — no API key,
 * no account, no server cost, and no network call after the first use.
 */

import { pipeline, env } from '@xenova/transformers';
import type { AutomaticSpeechRecognitionPipeline } from '@xenova/transformers';

// This app ships no local copy of the model — always fetch from the hub.
env.allowLocalModels = false;

/*
 * Tiny — what this used to use — is weak on English and close to unusable on
 * Urdu, which is most of why transcripts came out badly. Small is a large
 * step up on both, and is the biggest Whisper that still runs in a browser
 * tab, so it is the default.
 *
 * It is not free: ~238MB downloaded once (cached afterwards) and enough
 * memory that a modest phone can have its tab killed mid-transcription. A
 * crashed tab is worse than a rougher transcript, so low-memory devices get
 * base (~73MB) instead. deviceMemory is a coarse, Chromium-only hint, so an
 * unknown value is treated as capable rather than assumed weak.
 */
const LOW_MEMORY_GB = 4;

function pickModel(): string {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof gb === 'number' && gb < LOW_MEMORY_GB
    ? 'Xenova/whisper-base'
    : 'Xenova/whisper-small';
}

const MODEL_ID = pickModel();

/** Whisper hears 30s at a time; longer audio must be fed as overlapping windows. */
const CHUNK_SECONDS = 30;
const CHUNK_OVERLAP_SECONDS = 5;

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      // Quantized weights are roughly half the size of full precision, which
      // matters a lot at this model size.
      quantized: true,
      progress_callback: (p: { status: string; progress?: number }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          postMessage({ type: 'progress', progress: Math.round(p.progress) });
        }
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  }
  return transcriberPromise;
}

interface TranscribeRequest {
  type: 'transcribe';
  id: string;
  /** Mono PCM at 16kHz, decoded on the main thread. */
  audio: Float32Array;
}

self.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const { type, id, audio } = event.data;
  if (type !== 'transcribe') return;

  try {
    const transcriber = await getTranscriber();
    postMessage({ type: 'loaded' });

    // No `language` option: letting Whisper auto-detect is what lets one
    // recorder handle both English and Urdu without the user choosing.
    const output = await transcriber(audio, {
      task: 'transcribe',
      /*
       * Without chunking, anything past the model's 30s window is silently
       * dropped — a two-minute note would transcribe only its opening.
       * Overlapping windows are stitched back together by the pipeline.
       */
      chunk_length_s: CHUNK_SECONDS,
      stride_length_s: CHUNK_OVERLAP_SECONDS,
      /*
       * Whisper's characteristic failure is looping a phrase forever once it
       * loses the thread, especially on silence or background noise. Greedy
       * decoding keeps it fast enough to be usable at this model size, and
       * blocking repeated 3-grams stops the loop.
       */
      temperature: 0,
      no_repeat_ngram_size: 3,
    });
    const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text;

    postMessage({ type: 'result', id, text: (text ?? '').trim() });
  } catch (err) {
    postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'Transcription failed',
    });
  }
};
