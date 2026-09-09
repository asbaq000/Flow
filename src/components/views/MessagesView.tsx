'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, Download, Eraser, FileText, Hash, Loader2, Lock, MessageSquare, MoreHorizontal,
  Paperclip, Pencil, Plus, Send, Trash2, Users2, X,
} from 'lucide-react';
import type { ConversationFull, Message, MessageFile, TaskFull, User } from '@/lib/types';
import { MAX_ATTACHMENT_BYTES } from '@/lib/types';
import { api } from '@/lib/client';
import { useLiveEvents } from '@/lib/useLiveEvents';
import { escapeHtml } from '@/lib/sanitize';
import { isLead } from '@/lib/permissions';
import { Avatar, AvatarStack, Popover } from '../ui';
import { VoiceRecorder, formatDuration } from '../VoiceNotes';
import { fileSize } from '../Attachments';
import { formatDateTime, timeAgo } from './shared';

/** An in-progress "@na" or "#12" just before the caret. */
type Hint = { kind: '@' | '#'; query: string; start: number };

/**
 * How many suggestions the pop-up will hold. Six was too few to be a list of
 * "the tasks" at all; this is enough to scroll through and still bounded, so
 * a board of four hundred does not become the dropdown.
 */
const MAX_HINTS = 40;

/**
 * Messages: one list of rooms on the left, the open one on the right.
 *
 * Task groups appear on their own the moment a task has more than two people
 * on it, and lock when the task is approved — the history stays, the typing
 * stops. Direct conversations are whoever you start one with. Anything can be
 * said in a message: words, a link, a photo, a document, a voice note.
 */
export default function MessagesView({
  me, users, tasks, openTaskId, onOpenTask, onUnread,
}: {
  me: User;
  users: User[];
  /** The board, so "#" can offer tasks by number or title. */
  tasks: TaskFull[];
  /** Deep link from a notification: land in this task's group. */
  openTaskId?: string | null;
  onOpenTask: (id: string) => void;
  onUnread: (n: number) => void;
}) {
  const [rooms, setRooms] = useState<ConversationFull[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState<Hint | null>(null);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // The highlighted row, so arrowing past the fold scrolls it into view.
  const activeHintRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshRooms = useCallback(async () => {
    try {
      const { conversations } = await api.conversations.list();
      setRooms(conversations);
      onUnread(conversations.reduce((n, c) => n + c.unread, 0));
    } catch {
      /* transient */
    } finally {
      setLoading(false);
    }
  }, [onUnread]);

  const loadThread = useCallback(async (id: string) => {
    const { messages: list } = await api.conversations.open(id);
    setMessages((prev) => {
      // Nothing new: keep the same array so React does not re-render the thread
      // (and does not yank the scroll position) three times a minute for nothing.
      const same =
        prev.length === list.length &&
        prev.every((m, i) => m.id === list[i].id && m.body === list[i].body &&
          m.edited_at === list[i].edited_at && m.deleted_at === list[i].deleted_at &&
          m.files.length === list[i].files.length);
      return same ? prev : list;
    });
  }, []);

  const openRoom = useCallback(async (id: string) => {
    setCurrent(id);
    setError('');
    setEditing(null);
    try {
      const { conversation, messages: list } = await api.conversations.open(id);
      setMessages(list);
      // Opening a room reads it, so the badge drops by that room's count.
      setRooms((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...conversation, unread: 0 } : r));
        onUnread(next.reduce((n, c) => n + c.unread, 0));
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that conversation');
    }
  }, [onUnread]);

  useEffect(() => { refreshRooms(); }, [refreshRooms]);

  // Land in a task's group when asked to.
  useEffect(() => {
    if (!openTaskId || !rooms.length) return;
    const room = rooms.find((r) => r.task_id === openTaskId);
    if (room && room.id !== current) openRoom(room.id);
  }, [openTaskId, rooms, current, openRoom]);

  useLiveEvents(
    useCallback((event) => {
      const mine = event.actorId === me.id;
      if (event.type === 'message.added' || event.type === 'conversation.updated') {
        refreshRooms();
        if (event.conversationId && event.conversationId === current && !mine) loadThread(current).catch(() => {});
      } else if (event.type === 'message.updated' || event.type === 'message.deleted') {
        refreshRooms();
        if (event.conversationId && event.conversationId === current && !mine) loadThread(current).catch(() => {});
      }
    }, [refreshRooms, loadThread, current, me.id])
  );

  /*
   * The live stream is one in-memory pub/sub per server process. On a single
   * machine that is every tab; on Vercel each request can land on a different
   * instance, so a message posted over there never reaches the stream held
   * over here and the thread only moved when somebody reloaded.
   *
   * So the room polls. Three seconds while a conversation is open is cheap —
   * it is one query for the list and one for the thread — and it makes the
   * chat behave like a chat wherever it is deployed. It pauses with the tab:
   * a backgrounded phone is not waiting on a reply it cannot see.
   */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      refreshRooms();
      if (current) loadThread(current).catch(() => {});
    };
    const id = setInterval(tick, 3000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refreshRooms, loadThread, current]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, current]);

  const room = useMemo(() => rooms.find((r) => r.id === current) ?? null, [rooms, current]);

  /* ---------- the composer's two pop-ups ---------- */

  /*
   * Newest first, because the task somebody is about to mention is nearly
   * always one they have just been working on — board order is position on a
   * column, which is not the same thing at all.
   */
  const allTasks = useMemo(
    () => tasks.flatMap((t) => [t, ...t.subtasks]).sort((a, b) => b.created_at - a.created_at),
    [tasks]
  );
  // In a room, @ offers the people in it; a direct chat has exactly one other person.
  const mentionPool = useMemo(
    () => (room && room.members.length > 1 ? room.members : users).filter((u) => u.id !== me.id),
    [room, users, me.id]
  );
  const userHits = useMemo(() => {
    if (hint?.kind !== '@') return [];
    const q = hint.query.trim().toLowerCase();
    return mentionPool.filter((u) => u.name.toLowerCase().includes(q)).slice(0, MAX_HINTS);
  }, [hint, mentionPool]);

  const taskHits = useMemo(() => {
    if (hint?.kind !== '#') return [];
    const q = hint.query.trim().toLowerCase();
    // "12", "tsk-12" and "tsk12" are all somebody reaching for a ticket number.
    const n = q.replace(/^tsk-?/, '');

    // Bare "#": the whole board, newest first, rather than an arbitrary six.
    if (!q) return allTasks.slice(0, MAX_HINTS);

    const matches = allTasks.filter(
      (t) => (n && String(t.seq).startsWith(n)) || t.title.toLowerCase().includes(q)
    );
    // A typed number is almost always the ticket, so those go above a title
    // that happens to contain the same digits.
    return matches
      .sort((a, b) => {
        const an = n && String(a.seq).startsWith(n) ? 0 : 1;
        const bn = n && String(b.seq).startsWith(n) ? 0 : 1;
        return an - bn || b.created_at - a.created_at;
      })
      .slice(0, MAX_HINTS);
  }, [hint, allTasks]);
  const hits = hint?.kind === '@' ? userHits.length : taskHits.length;

  useEffect(() => setCursor(0), [hint?.query, hint?.kind]);

  // A list this long scrolls, so the keyboard has to drag the view with it.
  useEffect(() => {
    activeHintRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor, hint?.query]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    autoGrow(e.target);
    const upto = value.slice(0, e.target.selectionStart);
    const at = upto.match(/(?:^|\s)@([\w\s]{0,20})$/);
    const hash = upto.match(/(?:^|\s)#([\w-]{0,12})$/);
    if (at) setHint({ kind: '@', query: at[1], start: upto.length - at[1].length - 1 });
    else if (hash) setHint({ kind: '#', query: hash[1], start: upto.length - hash[1].length - 1 });
    else setHint(null);
  };

  const insertAt = (text: string) => {
    if (!hint) return;
    const before = draft.slice(0, hint.start);
    const after = draft.slice(hint.start + hint.query.length + 1);
    setDraft(`${before}${text} ${after}`);
    setHint(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + text.length + 1;
      el.setSelectionRange(pos, pos);
      autoGrow(el);
    });
  };

  const pick = (i: number) => {
    if (!hint) return;
    if (hint.kind === '@') {
      const u = userHits[i];
      if (u) insertAt(`@[${u.name}](${u.id})`);
    } else {
      const t = taskHits[i];
      if (t) insertAt(`#TSK-${t.seq}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (hint && hits > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % hits); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + hits) % hits); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(cursor); return; }
      if (e.key === 'Escape') { setHint(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  /* ---------- sending ---------- */

  const send = async () => {
    if (!room || !draft.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const { message } = await api.conversations.send(room.id, draft.trim());
      setMessages((prev) => [...prev, message]);
      setDraft('');
      setHint(null);
      if (inputRef.current) inputRef.current.style.height = 'auto';
      refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  const sendFiles = async (list: FileList | null) => {
    if (!room || !list?.length || uploading) return;
    setUploading(true);
    setError('');
    try {
      // The caption rides with the first file; the rest go on their own.
      let caption = draft.trim();
      for (const file of Array.from(list)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError(`${file.name} is over ${fileSize(MAX_ATTACHMENT_BYTES)} — keep files under that.`);
          continue;
        }
        const { message } = await api.conversations.sendFile(room.id, file, { filename: file.name, body: caption });
        caption = '';
        setMessages((prev) => [...prev, message]);
      }
      setDraft('');
      setHint(null);
      if (inputRef.current) inputRef.current.style.height = 'auto';
      refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that file');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const sendVoice = async (blob: Blob, durationMs: number) => {
    if (!room) return;
    setError('');
    const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
    try {
      const { message } = await api.conversations.sendFile(room.id, blob, {
        filename: `voice-note.${ext}`, kind: 'voice', durationMs,
      });
      setMessages((prev) => [...prev, message]);
      refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the voice note');
    }
  };

  /* ---------- editing, deleting, clearing ---------- */

  const saveEdit = async () => {
    if (!editing) return;
    const text = editing.body.trim();
    if (!text) return;
    try {
      const { message } = await api.messages.edit(editing.id, text);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
      setEditing(null);
      refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the edit');
    }
  };

  const removeMessage = async (m: Message) => {
    if (!window.confirm('Delete this message? It will show as deleted for everyone in the room.')) return;
    try {
      await api.messages.remove(m.id);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, body: '', deleted_at: Date.now(), files: [] } : x)));
      refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that');
    }
  };

  const clearChat = async () => {
    if (!room) return;
    if (!window.confirm('Clear this chat for you? Everyone else keeps what was said.')) return;
    try {
      await api.conversations.clear(room.id);
      setMessages([]);
      refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear the chat');
    }
  };

  const deleteChat = async () => {
    if (!room) return;
    if (!window.confirm('Delete this chat for you? It leaves your list and its history is cleared for you. It comes back if somebody writes here again.')) return;
    try {
      await api.conversations.remove(room.id);
      setCurrent(null);
      setMessages([]);
      refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the chat');
    }
  };

  const startDirect = async (userId: string) => {
    const { conversation } = await api.conversations.direct(userId);
    await refreshRooms();
    openRoom(conversation.id);
  };

  const others = users.filter((u) => u.id !== me.id);
  const lead = isLead(me);

  return (
    <div className="flex h-full min-h-0">
      {/*
        * Two panes side by side needs room for both. A phone has room for one,
        * so it shows the list until somebody picks a room and the thread after
        * — the ordinary way a messages app behaves on a small screen.
        */}
      <div
        className={`${current ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r md:w-[300px]`}
        style={{ background: 'var(--bg-sidebar)' }}
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <h2 className="text-[14px] font-semibold">Messages</h2>
          <Popover
            width={240}
            trigger={({ toggle }) => (
              <button onClick={toggle} className="btn btn-ghost ml-auto px-1.5" title="New conversation">
                <Plus size={15} />
              </button>
            )}
          >
            {(close) => (
              <div className="max-h-[280px] overflow-y-auto">
                <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  Message someone
                </div>
                {others.map((u) => (
                  <button key={u.id} className="menu-item" onClick={() => { close(); startDirect(u.id); }}>
                    <Avatar user={u} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Popover>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="grid place-items-center py-10"><Loader2 size={16} className="animate-spin text-[var(--text-tertiary)]" /></div>
          ) : rooms.length === 0 ? (
            <p className="px-2 py-8 text-center text-[12.5px] text-[var(--text-tertiary)]">
              No conversations yet. A group opens on its own when a task has more than two people on it.
            </p>
          ) : (
            rooms.map((r) => <RoomRow key={r.id} room={r} me={me} active={r.id === current} onOpen={() => openRoom(r.id)} />)
          )}
        </div>
      </div>

      {/* thread */}
      <div className={`${current ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {!room ? (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <MessageSquare size={30} className="mx-auto mb-3 text-[var(--text-tertiary)]" />
              <p className="text-[14px] font-medium">Pick a conversation</p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                Type <span className="font-mono">#</span> to link a task and <span className="font-mono">@</span> to mention someone.
                Photos, documents and voice notes go in too.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
              <button
                onClick={() => setCurrent(null)}
                className="btn btn-ghost -ml-1 shrink-0 px-1.5 md:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft size={16} />
              </button>
              {room.kind === 'task' ? (
                <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  <Hash size={15} />
                </span>
              ) : (
                <Avatar user={room.members.find((m) => m.id !== me.id) ?? null} size="md" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[14px] font-semibold">{roomTitle(room, me)}</h3>
                  {room.closed_at && (
                    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10.5px] font-medium" style={{ background: 'var(--well)', color: 'var(--text-secondary)' }}>
                      <Lock size={9} /> Closed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-tertiary)]">
                  <Users2 size={11} /> {room.members.length} people
                  {room.task_id && (
                    <>
                      {' · '}
                      <button onClick={() => onOpenTask(room.task_id!)} className="text-[var(--accent)] hover:underline">
                        Open task
                      </button>
                    </>
                  )}
                </div>
              </div>
              <AvatarStack users={room.members} max={5} />
              <Popover
                width={220}
                trigger={({ toggle }) => (
                  <button onClick={toggle} className="btn btn-ghost px-1.5" title="Chat options">
                    <MoreHorizontal size={15} />
                  </button>
                )}
              >
                {(close) => (
                  <div>
                    <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                      Only for you
                    </div>
                    <button className="menu-item" onClick={() => { close(); clearChat(); }}>
                      <Eraser size={14} /> Clear chat
                    </button>
                    <button className="menu-item text-red-600" onClick={() => { close(); deleteChat(); }}>
                      <Trash2 size={14} /> Delete chat
                    </button>
                    <p className="px-2 pb-1.5 pt-1 text-[11px] leading-snug text-[var(--text-tertiary)]">
                      Everyone else keeps their copy. A deleted chat returns when somebody writes in it.
                    </p>
                  </div>
                )}
              </Popover>
            </header>

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <p className="py-10 text-center text-[12.5px] text-[var(--text-tertiary)]">Nothing here yet.</p>
              )}
              {messages.map((m, i) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  mine={m.author_id === me.id}
                  showHead={i === 0 || messages[i - 1].author_id !== m.author_id || m.created_at - messages[i - 1].created_at > 5 * 60_000}
                  canEdit={!room.closed_at && m.author_id === me.id && !m.deleted_at}
                  canDelete={!m.deleted_at && (m.author_id === me.id || lead)}
                  editing={editing?.id === m.id ? editing.body : null}
                  onStartEdit={() => setEditing({ id: m.id, body: m.body })}
                  onEditChange={(body) => setEditing((e) => (e ? { ...e, body } : e))}
                  onSaveEdit={saveEdit}
                  onCancelEdit={() => setEditing(null)}
                  onDelete={() => removeMessage(m)}
                  onOpenTask={onOpenTask}
                />
              ))}
              <div ref={endRef} />
            </div>

            {room.closed_at ? (
              <div className="border-t px-4 py-3 text-center text-[12.5px] text-[var(--text-tertiary)]">
                This group closed when the task was approved. It stays here as the record.
              </div>
            ) : (
              <div className="relative border-t p-3">
                {hint && hits > 0 && (
                  <div className="menu scroll-thin absolute bottom-full left-3 mb-1 max-h-[280px] w-[320px] overflow-y-auto">
                    <div className="sticky top-0 px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]" style={{ background: 'var(--bg-panel)' }}>
                      {hint.kind === '@' ? 'Mention' : 'Link a task'}
                      <span className="ml-1 font-normal normal-case tracking-normal opacity-70">
                        {hits}{hits === MAX_HINTS ? '+' : ''}
                      </span>
                    </div>
                    {hint.kind === '@'
                      ? userHits.map((u, i) => (
                          <button
                            key={u.id}
                            ref={i === cursor ? activeHintRef : undefined}
                            data-active={i === cursor}
                            className="menu-item"
                            onMouseEnter={() => setCursor(i)}
                            onMouseDown={(e) => { e.preventDefault(); pick(i); }}
                          >
                            <Avatar user={u} size="xs" />
                            <span className="min-w-0 flex-1 truncate">{u.name}</span>
                          </button>
                        ))
                      : taskHits.map((t, i) => (
                          <button
                            key={t.id}
                            ref={i === cursor ? activeHintRef : undefined}
                            data-active={i === cursor}
                            className="menu-item"
                            onMouseEnter={() => setCursor(i)}
                            onMouseDown={(e) => { e.preventDefault(); pick(i); }}
                          >
                            <span className="shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">TSK-{t.seq}</span>
                            <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          </button>
                        ))}
                  </div>
                )}
                <div className="flex items-end gap-1.5 rounded-2xl border px-2.5 py-2" style={{ background: 'var(--bg-input)' }}>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="btn btn-ghost px-1.5 py-1"
                    title="Send a photo or document"
                  >
                    {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => sendFiles(e.target.files)}
                  />
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={draft}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onBlur={() => setHint(null)}
                    placeholder={`Message ${room.kind === 'task' ? 'the group' : roomTitle(room, me)} — # links a task, @ mentions someone`}
                    className="max-h-32 flex-1 resize-none bg-transparent py-1 text-[13.5px] outline-none placeholder:text-[var(--text-tertiary)]"
                  />
                  <VoiceRecorder compact label="Send a voice note" onRecorded={sendVoice} />
                  <button onClick={send} disabled={!draft.trim() || sending} className="btn btn-primary px-2.5 py-1.5">
                    {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  </button>
                </div>
                {error && <p className="mt-1.5 text-[12px] text-red-600">{error}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
}

function roomTitle(room: ConversationFull, me: User): string {
  if (room.kind === 'task') return room.title;
  const other = room.members.find((m) => m.id !== me.id);
  return other?.name ?? 'Conversation';
}

function RoomRow({ room, me, active, onOpen }: { room: ConversationFull; me: User; active: boolean; onOpen: () => void }) {
  const other = room.members.find((m) => m.id !== me.id) ?? null;
  const last = room.last_message;
  const preview = last
    ? `${last.author ? last.author.name.split(' ')[0] + ': ' : ''}${last.deleted_at ? 'Message deleted' : last.body}`
    : 'No messages yet';
  return (
    <button
      onClick={onOpen}
      className="mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
      style={{ background: active ? 'var(--accent-soft)' : undefined }}
    >
      {room.kind === 'task' ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--well)', color: 'var(--text-secondary)' }}>
          <Hash size={15} />
        </span>
      ) : (
        <Avatar user={other} size="md" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`min-w-0 flex-1 truncate text-[13px] ${room.unread ? 'font-semibold' : 'font-medium'}`}>
            {roomTitle(room, me)}
          </span>
          {last && (
            <span className="shrink-0 text-[10.5px] text-[var(--text-tertiary)]">{timeAgo(last.created_at)}</span>
          )}
        </span>
        <span className={`block truncate text-[12px] ${room.unread ? 'text-[var(--text)]' : 'text-[var(--text-tertiary)]'}`}>
          {room.closed_at ? '🔒 ' : ''}{preview}
        </span>
      </span>
      {room.unread > 0 && (
        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 font-mono text-[10.5px] font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          {room.unread}
        </span>
      )}
    </button>
  );
}

/** File-only messages carry a stand-in line for the room list; the bubble shows the file instead. */
const PLACEHOLDER_RE = /^(\u{1F3A4}|\u{1F5BC}|\u{1F4CE}) /u;

function MessageRow({
  message, mine, showHead, canEdit, canDelete, editing,
  onStartEdit, onEditChange, onSaveEdit, onCancelEdit, onDelete, onOpenTask,
}: {
  message: Message;
  mine: boolean;
  showHead: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** The draft while this message is being edited, else null. */
  editing: string | null;
  onStartEdit: () => void;
  onEditChange: (body: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onOpenTask: (id: string) => void;
}) {
  // System lines (no author) sit centred and quiet.
  if (!message.author_id) {
    return (
      <div className="my-3 text-center text-[11.5px] text-[var(--text-tertiary)]">{message.body}</div>
    );
  }

  const deleted = Boolean(message.deleted_at);
  const onlyFiles = message.files.length > 0 && PLACEHOLDER_RE.test(message.body);

  return (
    <div className={`group flex gap-2.5 ${showHead ? 'mt-3' : 'mt-0.5'} ${mine ? 'flex-row-reverse' : ''}`}>
      <div className="w-7 shrink-0">{showHead && <Avatar user={message.author} size="sm" />}</div>
      <div className={`flex max-w-[72%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {showHead && (
          <div className={`mb-0.5 flex items-baseline gap-1.5 text-[11px] ${mine ? 'justify-end' : ''}`}>
            <span className="font-semibold text-[var(--text-secondary)]">{message.author?.name ?? 'Someone'}</span>
            <span className="text-[var(--text-tertiary)]" title={formatDateTime(message.created_at)}>{timeAgo(message.created_at)}</span>
          </div>
        )}

        {editing !== null ? (
          <div className="w-[min(420px,100%)] rounded-2xl border p-2" style={{ background: 'var(--bg-card)' }}>
            <textarea
              autoFocus
              value={editing}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
                if (e.key === 'Escape') onCancelEdit();
              }}
              rows={2}
              className="input w-full resize-y text-[13px]"
            />
            <div className="mt-1.5 flex items-center justify-end gap-1">
              <span className="mr-auto text-[11px] text-[var(--text-tertiary)]">Enter saves · Esc cancels</span>
              <button onClick={onCancelEdit} className="btn btn-ghost px-2 py-1 text-[12px]"><X size={12} /> Cancel</button>
              <button onClick={onSaveEdit} disabled={!editing.trim()} className="btn btn-primary px-2 py-1 text-[12px]"><Check size={12} /> Save</button>
            </div>
          </div>
        ) : (
          <div className={`flex items-end gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
            <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
              {message.files.map((f) => <FileBubble key={f.id} file={f} />)}
              {deleted ? (
                <div className="rounded-2xl border border-dashed px-3 py-1.5 text-[12.5px] italic text-[var(--text-tertiary)]">
                  This message was deleted
                </div>
              ) : !onlyFiles && message.body ? (
                <div
                  className="whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13.5px] leading-relaxed"
                  style={mine
                    ? { background: 'var(--accent)', color: 'var(--on-accent)', borderTopRightRadius: showHead ? 6 : undefined }
                    : { background: 'var(--bg-card)', border: '1px solid var(--border)', borderTopLeftRadius: showHead ? 6 : undefined }}
                  onClick={(e) => {
                    const t = (e.target as HTMLElement).closest('[data-task]') as HTMLElement | null;
                    if (t?.dataset.task) onOpenTask(t.dataset.task);
                  }}
                  dangerouslySetInnerHTML={{ __html: renderBody(message.body, mine) }}
                />
              ) : null}
              {message.edited_at && !deleted && (
                <span className="px-1 text-[10.5px] text-[var(--text-tertiary)]" title={formatDateTime(message.edited_at)}>edited</span>
              )}
            </div>

            {(canEdit || canDelete) && (
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {canEdit && (
                  <button onClick={onStartEdit} className="btn btn-ghost px-1 py-1" title="Edit">
                    <Pencil size={12} />
                  </button>
                )}
                {canDelete && (
                  <button onClick={onDelete} className="btn btn-ghost px-1 py-1 text-red-600" title="Delete">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FileBubble({ file }: { file: MessageFile }) {
  const url = api.conversations.fileUrl(file.id);
  if (file.kind === 'image') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block max-w-[320px] overflow-hidden rounded-2xl border" title={file.filename}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={file.filename} loading="lazy" className="block max-h-72 w-auto max-w-full" />
      </a>
    );
  }
  if (file.kind === 'voice') {
    return (
      <div className="flex items-center gap-2 rounded-2xl border px-2.5 py-1.5" style={{ background: 'var(--bg-card)' }}>
        <audio controls preload="none" src={url} className="h-8 max-w-[240px]" />
        {file.duration_ms > 0 && (
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{formatDuration(file.duration_ms)}</span>
        )}
      </div>
    );
  }
  return (
    <a
      href={url}
      download={file.filename}
      className="flex max-w-[320px] items-center gap-2.5 rounded-2xl border px-3 py-2 transition-colors hover:bg-[var(--bg-hover)]"
      style={{ background: 'var(--bg-card)' }}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--well)', color: 'var(--text-secondary)' }}>
        <FileText size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{file.filename}</span>
        <span className="block text-[11px] text-[var(--text-tertiary)]">{fileSize(file.byte_size)}</span>
      </span>
      <Download size={14} className="shrink-0 text-[var(--text-tertiary)]" />
    </a>
  );
}

/** Where a link starts and, more carefully, where it stops: not on the full stop that ends the sentence. */
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)\]'"])/gi;

/**
 * Lights up three things in a message: links, @mentions, and task references
 * written as #12 or #TSK-12. Each piece is escaped on its own — the URL is
 * split out of the raw text first so an escaped quote can never leak into
 * an href. The task id is not in the text, so the click resolves it by ticket
 * number through the board the workspace already holds.
 */
function renderBody(body: string, mine: boolean): string {
  const linkStyle = mine ? 'text-decoration:underline;font-weight:600' : 'color:var(--accent);font-weight:600';
  return body.split(URL_RE).map((part, i) => {
    if (i % 2 === 1) {
      const href = /^www\./i.test(part) ? `https://${part}` : part;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="${linkStyle};text-decoration:underline">${escapeHtml(part)}</a>`;
    }
    return escapeHtml(part)
      .replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (_m, name: string) => `<span class="mention">@${name}</span>`)
      .replace(/#(?:TSK-)?(\d{1,6})\b/gi, (_m, n: string) =>
        `<button type="button" data-seq="${n}" data-task="seq:${n}" style="${linkStyle}">#TSK-${n}</button>`);
  }).join('');
}
