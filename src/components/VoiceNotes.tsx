'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Pause, Play, Square, Trash2, Volume2 } from 'lucide-react';
import type { User, VoiceNote } from '@/lib/types';
import { api } from '@/lib/client';
import { Avatar } from './ui';
import { timeAgo } from './views/shared';

const MAX_SECONDS = 300; // five minutes, matching the 8 MB server cap

/** mm:ss */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Picks a container the browser can actually record. Safari differs from Chrome. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/* ------------------------------------------------------------------ */
/* Recorder                                                            */
/* ------------------------------------------------------------------ */

export function VoiceRecorder({
  onRecorded,
  compact = false,
  label = 'Record a voice note',
}: {
  onRecorded: (blob: Blob, durationMs: number) => Promise<void> | void;
  compact?: boolean;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    tickRef.current = null;
    rafRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
  }, []);

  const start = async () => {
    setError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot record audio.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const durationMs = Date.now() - startedRef.current;
        const blob = new Blob(chunksRef.current, { type: mimeType ?? 'audio/webm' });
        cleanup();
        setState('saving');
        try {
          if (blob.size > 0) await onRecorded(blob, durationMs);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save the recording');
        } finally {
          setState('idle');
          setElapsed(0);
        }
      };

      // Live input level, purely so the user can see the mic is working.
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const sample = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 60));
          rafRef.current = requestAnimationFrame(sample);
        };
        sample();
      } catch {
        /* metering is optional */
      }

      startedRef.current = Date.now();
      recorder.start();
      setState('recording');
      setElapsed(0);

      tickRef.current = setInterval(() => {
        const secs = (Date.now() - startedRef.current) / 1000;
        setElapsed(secs);
        if (secs >= MAX_SECONDS) stop();
      }, 200);
    } catch (err) {
      cleanup();
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setError(
        denied
          ? 'Microphone access was blocked. Allow it in your browser settings and try again.'
          : 'No microphone was found.'
      );
    }
  };

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2">
        <button onClick={stop} className="btn btn-outline py-1 text-[12.5px]" style={{ borderColor: '#e03e3e', color: '#e03e3e' }}>
          <Square size={12} fill="currentColor" /> Stop
        </button>
        <span className="flex items-center gap-1.5 text-[12.5px] tabular-nums text-[var(--text-secondary)]">
          <span
            className="h-2 w-2 rounded-full bg-red-500"
            style={{ transform: `scale(${1 + level * 0.9})`, transition: 'transform 90ms linear' }}
          />
          {formatDuration(elapsed * 1000)}
          <span className="text-[var(--text-tertiary)]">/ {formatDuration(MAX_SECONDS * 1000)}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={compact ? 'inline-flex items-center gap-2' : ''}>
      <button
        onClick={start}
        disabled={state === 'saving'}
        className={compact ? 'btn btn-ghost px-1.5' : 'btn btn-outline py-1 text-[12.5px]'}
        title={label}
        aria-label={label}
      >
        {state === 'saving' ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
        {!compact && (state === 'saving' ? 'Saving…' : label)}
      </button>
      {error && <p className={compact ? 'text-[11.5px] text-red-600' : 'mt-1 text-[12px] text-red-600'}>{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

export function VoiceNotePlayer({
  note,
  me,
  onDelete,
  showAuthor = true,
}: {
  note: VoiceNote;
  me: User;
  onDelete?: (id: string) => void;
  showAuthor?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      // Pause anything else already playing so two notes never overlap.
      document.querySelectorAll('audio').forEach((a) => a !== el && a.pause());
      el.play().catch(() => {});
    }
  };

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration;
  };

  const canDelete = onDelete && (note.author_id === me.id || me.role === 'CEO');
  // duration_ms comes from the recorder; fall back to the element once loaded.
  const totalMs = note.duration_ms || (audioRef.current?.duration ?? 0) * 1000;

  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1.5" style={{ background: 'var(--bg-subtle)' }}>
      <audio
        ref={audioRef}
        src={api.voice.src(note.id)}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setCurrent(el.currentTime * 1000);
          if (Number.isFinite(el.duration) && el.duration > 0) {
            setProgress((el.currentTime / el.duration) * 100);
          }
        }}
      />

      <button
        onClick={toggle}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white"
        style={{ background: 'var(--accent)' }}
        aria-label={playing ? 'Pause' : 'Play voice note'}
      >
        {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-px" />}
      </button>

      {showAuthor && <Avatar user={note.author} size="xs" />}

      <div className="min-w-0 flex-1">
        <div
          onClick={scrub}
          className="h-1.5 cursor-pointer overflow-hidden rounded-full"
          style={{ background: 'var(--bg-active)' }}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--text-tertiary)]">
          <Volume2 size={9} />
          <span className="tabular-nums">
            {formatDuration(playing || current ? current : totalMs)}
            {(playing || current > 0) && totalMs > 0 && ` / ${formatDuration(totalMs)}`}
          </span>
          {showAuthor && note.author && <span className="truncate">· {note.author.name}</span>}
          <span>· {timeAgo(note.created_at)}</span>
        </div>
      </div>

      {canDelete && (
        <button
          onClick={() => onDelete!(note.id)}
          className="shrink-0 rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-red-500"
          aria-label="Delete voice note"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List + recorder together                                            */
/* ------------------------------------------------------------------ */

export function VoiceNoteList({
  notes,
  me,
  onDelete,
  emptyHint,
}: {
  notes: VoiceNote[];
  me: User;
  onDelete?: (id: string) => void;
  emptyHint?: string;
}) {
  if (!notes.length) {
    return emptyHint ? <p className="text-[12.5px] text-[var(--text-tertiary)]">{emptyHint}</p> : null;
  }
  return (
    <div className="space-y-1.5">
      {notes.map((note) => (
        <VoiceNotePlayer key={note.id} note={note} me={me} onDelete={onDelete} />
      ))}
    </div>
  );
}
