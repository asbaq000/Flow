'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Check, CheckCircle2, Loader2, MessageSquare, Send, Trash2, X } from 'lucide-react';
import type { Comment, User } from '@/lib/types';
import { escapeHtml } from '@/lib/sanitize';
import { Avatar } from './ui';
import { VoiceNoteList, VoiceRecorder } from './VoiceNotes';
import { formatDateTime, timeAgo } from './views/shared';

/** Mentions are stored as `@[Display Name](userId)` so they survive edits and renames. */
const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

export default function CommentThread({
  comments, me, users, canComment, onAdd, onDelete, onResolve, onDeleteVoice,
}: {
  comments: Comment[];
  me: User;
  users: User[];
  canComment: boolean;
  /** Resolves once the comment (and any attached recording) has been saved. */
  onAdd: (body: string, voice?: { blob: Blob; durationMs: number }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => Promise<void>;
  onDeleteVoice: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const [recording, setRecording] = useState<{ blob: Blob; durationMs: number; url: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);
  const shown = showResolved ? comments : open;

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return users.filter((u) => u.id !== me.id && u.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, users, me.id]);

  useEffect(() => setCursor(0), [mention?.query]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    autoGrow(e.target);

    // Detect an in-progress "@word" immediately before the caret.
    const upto = value.slice(0, e.target.selectionStart);
    const match = upto.match(/(?:^|\s)@([\w\s]{0,20})$/);
    setMention(match ? { query: match[1], start: upto.length - match[1].length - 1 } : null);
  };

  const insertMention = (user: User) => {
    if (!mention) return;
    const before = draft.slice(0, mention.start);
    const after = draft.slice(mention.start + mention.query.length + 1);
    const next = `${before}@[${user.name}](${user.id}) ${after}`;
    setDraft(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + user.name.length + user.id.length + 6;
      el.setSelectionRange(pos, pos);
      autoGrow(el);
    });
  };

  // A recording on its own is a valid comment — text is not required.
  const canSubmit = Boolean(draft.trim() || recording);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      await onAdd(
        draft.trim() || (recording ? '\u{1F3A4} Voice note' : ''),
        recording ? { blob: recording.blob, durationMs: recording.durationMs } : undefined
      );
      setDraft('');
      if (recording) URL.revokeObjectURL(recording.url);
      setRecording(null);
      if (inputRef.current) inputRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post comment');
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => (c + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => (c - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(candidates[cursor]);
        return;
      }
      if (e.key === 'Escape') {
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="mt-8 border-t pt-5">
      <header className="mb-3 flex items-center gap-2">
        <MessageSquare size={14} className="text-[var(--text-secondary)]" />
        <h3 className="text-[13px] font-semibold">Comments</h3>
        <span className="text-[11.5px] text-[var(--text-tertiary)]">{open.length}</span>
        {resolved.length > 0 && (
          <button
            onClick={() => setShowResolved((s) => !s)}
            className="ml-auto text-[12px] text-[var(--text-secondary)] hover:text-[var(--text)]"
          >
            {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
          </button>
        )}
      </header>

      {shown.length === 0 && (
        <p className="mb-4 text-[13px] text-[var(--text-tertiary)]">
          No comments yet. Use <span className="font-medium">@</span> to pull someone in.
        </p>
      )}

      <ol className="mb-4 space-y-3.5">
        {shown.map((c) => (
          <li key={c.id} className="group flex items-start gap-2.5">
            <Avatar user={c.author} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium">{c.author?.name ?? 'Unknown'}</span>
                <span className="text-[11.5px] text-[var(--text-tertiary)]" title={formatDateTime(c.created_at)}>
                  {timeAgo(c.created_at)}
                </span>
                {c.resolved === 1 && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 text-[10.5px] font-medium text-emerald-600">
                    <Check size={9} strokeWidth={3} /> Resolved
                  </span>
                )}

                <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => onResolve(c.id, c.resolved === 0)}
                    className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                    title={c.resolved ? 'Reopen' : 'Resolve'}
                  >
                    <CheckCircle2 size={13} />
                  </button>
                  {(c.author_id === me.id || me.role === 'CEO') && (
                    <button
                      onClick={() => onDelete(c.id)}
                      className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </div>

              <div
                className={`mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed ${c.resolved ? 'text-[var(--text-tertiary)]' : ''}`}
                dangerouslySetInnerHTML={{ __html: renderMentions(c.body) }}
              />

              {c.voice_notes.length > 0 && (
                <div className="mt-1.5 max-w-[420px]">
                  <VoiceNoteList notes={c.voice_notes} me={me} onDelete={onDeleteVoice} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {canComment ? (
        <div className="relative">
          <div className="flex items-start gap-2.5">
            <Avatar user={me} size="md" />
            <div className="min-w-0 flex-1">
              <div
                className="rounded-md border transition-colors focus-within:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)' }}
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Add a comment… use @ to mention, or record a voice note"
                  className="max-h-40 w-full resize-none bg-transparent px-3 py-2 text-[13.5px] outline-none placeholder:text-[var(--text-tertiary)]"
                />
                {recording && (
                  <div className="flex items-center gap-2 border-t px-2 py-1.5">
                    <audio src={recording.url} controls className="h-8 flex-1" />
                    <button
                      onClick={() => {
                        URL.revokeObjectURL(recording.url);
                        setRecording(null);
                      }}
                      className="btn btn-ghost px-1.5"
                      aria-label="Discard recording"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-[var(--text-tertiary)]">
                    <AtSign size={11} /> mention · <kbd className="rounded border px-1">Ctrl</kbd>+
                    <kbd className="rounded border px-1">Enter</kbd> to send
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {!recording && (
                      <VoiceRecorder
                        compact
                        label="Record a voice note"
                        onRecorded={(blob, durationMs) =>
                          setRecording({ blob, durationMs, url: URL.createObjectURL(blob) })
                        }
                      />
                    )}
                    <button onClick={submit} className="btn btn-primary py-1 text-[12.5px]" disabled={!canSubmit || busy}>
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      Comment
                    </button>
                  </span>
                </div>
              </div>
              {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
            </div>
          </div>

          {mention && candidates.length > 0 && (
            <div className="menu absolute bottom-full left-10 mb-1 w-[230px]">
              {candidates.map((u, i) => (
                <button
                  key={u.id}
                  data-active={i === cursor}
                  className="menu-item"
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(u);
                  }}
                >
                  <Avatar user={u} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">{shortRole(u.role)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--text-tertiary)]">You do not have permission to comment here.</p>
      )}
    </section>
  );
}

/**
 * Escape first, then swap mention markers for styled spans. escapeHtml leaves
 * brackets alone, so the markers survive escaping intact.
 */
function renderMentions(body: string): string {
  return escapeHtml(body).replace(
    /@\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, name: string) => `<span class="mention">@${name}</span>`
  );
}

const shortRole = (role: string) =>
  ({ CEO: 'CEO', MANAGER: 'Manager', TEAM_LEAD: 'Lead', DEV: 'Dev' })[role] ?? role;

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

export { MENTION_RE };
