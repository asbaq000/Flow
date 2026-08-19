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

const MODEL_ID = 'Xenova/whisper-tiny';

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      // The quantized weights are roughly half the size of full precision —
      // the difference between ~75MB and ~41MB on a visitor's first use.
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
    const output = await transcriber(audio, { task: 'transcribe' });
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
