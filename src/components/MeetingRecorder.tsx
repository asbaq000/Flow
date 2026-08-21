'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Circle, Loader2, Square, Wand2 } from 'lucide-react';
import type { MeetingFull } from '@/lib/types';
import { api } from '@/lib/client';
import { transcriptionSupported, useTranscriber } from '@/lib/useTranscriber';

type Stage =
  | { kind: 'idle' }
  | { kind: 'recording'; seconds: number }
  | { kind: 'transcribing'; percent: number }
  | { kind: 'summarising' }
  | { kind: 'saving' };

/**
 * Turns a call into written minutes without anybody typing.
 *
 * Google only transcribes for paid Workspace accounts, so the audio is
 * captured here instead and run through the same in-browser Whisper model the
 * voice notes use. The recording never leaves the machine — it is transcribed
 * locally and only the text is saved, which also keeps hours of meeting audio
 * out of a database sized for text.
 */
export default function MeetingRecorder({
  meeting, onSaved,
}: {
  meeting: MeetingFull;
  onSaved: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { transcribe } = useTranscriber((percent) =>
    setStage((s) => (s.kind === 'transcribing' ? { kind: 'transcribing', percent } : s))
  );

  // Never leave the microphone or tab capture running if this unmounts.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const start = async (source: 'call' | 'mic') => {
    setError('');
    setHint('');
    chunksRef.current = [];

    try {
      let stream: MediaStream;

      if (source === 'call') {
        /*
         * Capturing the tab rather than the microphone is what picks up
         * everyone else on the call — a mic only ever hears whoever is
         * sitting in front of it, plus whatever leaks out of the speakers.
         */
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        const audioTracks = display.getAudioTracks();

        if (!audioTracks.length) {
          display.getTracks().forEach((t) => t.stop());
          setError(
            'That share had no audio. Pick the Google Meet tab and turn on "Also share tab audio" — without it the recording is silent.'
          );
          return;
        }

        // The video is only there because tab audio cannot be shared without
        // it. Keep the track alive so the browser keeps showing its sharing
        // bar, but record the audio alone.
        streamRef.current = display;
        stream = new MediaStream(audioTracks);

        // If they stop the share from the browser's own bar, end cleanly.
        audioTracks[0].addEventListener('ended', () => stop());
      } else {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = mic;
        stream = mic;
        setHint('Recording the microphone — it will only clearly hear people in the room with you.');
      }

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void finish();
      // A timeslice means a long call is not held as one growing buffer.
      recorder.start(5_000);
      recorderRef.current = recorder;

      setStage({ kind: 'recording', seconds: 0 });
      tickRef.current = setInterval(
        () => setStage((s) => (s.kind === 'recording' ? { kind: 'recording', seconds: s.seconds + 1 } : s)),
        1000
      );
    } catch (err) {
      releaseStream();
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /denied|not allowed/i.test(message)
          ? 'Permission was refused, so nothing is being recorded.'
          : `Could not start recording: ${message}`
      );
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const finish = async () => {
    releaseStream();
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];

    if (blob.size < 2000) {
      setStage({ kind: 'idle' });
      setError('That recording was empty — nothing was captured.');
      return;
    }

    setStage({ kind: 'transcribing', percent: 0 });
    try {
      const { text, lang } = await transcribe(blob);
      if (!text.trim()) {
        setStage({ kind: 'idle' });
        setError('Nothing could be made out in that recording.');
        return;
      }

      setStage({ kind: 'summarising' });

      /*
       * A transcript is a wall of speech; minutes are what somebody actually
       * reads afterwards. If the model is unavailable the transcript itself
       * is saved, which is still the record of the call.
       */
      let written = text.trim();
      try {
        const minutes = await api.transcripts.polish(written, lang, 'minutes');
        if (minutes.polished && minutes.text.trim()) written = minutes.text.trim();
      } catch {
        // Keep the transcript.
      }

      setStage({ kind: 'saving' });
      // Never overwrite minutes somebody already wrote.
      const existing = meeting.minutes.trim();
      const next = existing ? `${existing}\n\n---\n\n${written}` : written;
      await api.meetings.saveMinutes(meeting.id, next);
      onSaved();
      setStage({ kind: 'idle' });
    } catch (err) {
      setStage({ kind: 'idle' });
      setError(err instanceof Error ? err.message : 'The transcription failed.');
    }
  };

  if (!transcriptionSupported()) return null;

  return (
    <div className="mt-2.5 rounded-md border px-3 py-2" style={{ background: 'var(--bg-subtle)' }}>
      {stage.kind === 'idle' && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Wand2 size={12} className="text-[var(--text-tertiary)]" />
            <span className="text-[12px] font-medium">Write the minutes for me</span>
            <span className="ml-auto flex gap-1.5">
              <button onClick={() => start('call')} className="btn btn-primary py-1 text-[12px]">
                <Circle size={10} fill="currentColor" /> Record the call
              </button>
              <button onClick={() => start('mic')} className="btn btn-ghost py-1 text-[12px]">
                Microphone
              </button>
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
            Choose the Google Meet tab and tick <span className="font-medium">Also share tab audio</span>. The
            audio is transcribed on this device and never uploaded — only the text is saved. Let the others
            know they are being recorded.
          </p>
        </>
      )}

      {stage.kind === 'recording' && (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="text-[12.5px] font-medium">Recording · {formatClock(stage.seconds)}</span>
          <button onClick={stop} className="btn btn-primary ml-auto py-1 text-[12px]">
            <Square size={10} fill="currentColor" /> Stop and write it up
          </button>
        </div>
      )}

      {stage.kind === 'transcribing' && (
        <div>
          <div className="flex items-center gap-2 text-[12.5px]">
            <Loader2 size={13} className="animate-spin" />
            <span>Writing up the meeting…</span>
            <span className="ml-auto text-[11.5px] text-[var(--text-tertiary)]">{Math.round(stage.percent)}%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-active)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(2, stage.percent)}%`, background: 'var(--accent)' }}
            />
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            This runs on your machine, so a long call takes a while. Leave the tab open.
          </p>
        </div>
      )}

      {stage.kind === 'summarising' && (
        <div className="flex items-center gap-2 text-[12.5px]">
          <Loader2 size={13} className="animate-spin" /> Turning it into minutes…
        </div>
      )}

      {stage.kind === 'saving' && (
        <div className="flex items-center gap-2 text-[12.5px]">
          <Loader2 size={13} className="animate-spin" /> Saving the minutes…
        </div>
      )}

      {hint && <p className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">{hint}</p>}

      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-amber-700 dark:text-amber-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
