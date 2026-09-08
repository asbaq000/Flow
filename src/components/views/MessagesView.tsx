'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Loader2, Lock, MessageSquare, Plus, Send, Users2 } from 'lucide-react';
import type { ConversationFull, Message, User } from '@/lib/types';
import { api } from '@/lib/client';
import { useLiveEvents } from '@/lib/useLiveEvents';
import { escapeHtml } from '@/lib/sanitize';
import { Avatar, AvatarStack, Popover } from '../ui';
import { formatDateTime, timeAgo } from './shared';

/**
 * Messages: one list of rooms on the left, the open one on the right.
 *
 * Task groups appear on their own the moment a task has more than two people
 * on it, and lock when the task is approved — the history stays, the typing
 * stops. Direct conversations are whoever you start one with.
 */
export default function MessagesView({
  me, users, openTaskId, onOpenTask, onUnread,
}: {
  me: User;
  users: User[];
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
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

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

  const openRoom = useCallback(async (id: string) => {
    setCurrent(id);
    setError('');
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
      if (event.type === 'message.added' || event.type === 'conversation.updated') {
        refreshRooms();
        if (event.conversationId && event.conversationId === current && event.actorId !== me.id) {
          api.conversations.open(current).then(({ messages: list }) => setMessages(list)).catch(() => {});
        }
      }
    }, [refreshRooms, current, me.id])
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, current]);

  const room = useMemo(() => rooms.find((r) => r.id === current) ?? null, [rooms, current]);

  const send = async () => {
    if (!room || !draft.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const { message } = await api.conversations.send(room.id, draft.trim());
      setMessages((prev) => [...prev, message]);
      setDraft('');
      refreshRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  const startDirect = async (userId: string) => {
    const { conversation } = await api.conversations.direct(userId);
    await refreshRooms();
    openRoom(conversation.id);
  };

  const others = users.filter((u) => u.id !== me.id);

  return (
    <div className="flex h-full min-h-0">
      {/* rooms */}
      <div className="flex w-[300px] shrink-0 flex-col border-r" style={{ background: 'var(--bg-sidebar)' }}>
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
      <div className="flex min-w-0 flex-1 flex-col">
        {!room ? (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <MessageSquare size={30} className="mx-auto mb-3 text-[var(--text-tertiary)]" />
              <p className="text-[14px] font-medium">Pick a conversation</p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                Mention a task with <span className="font-mono">#12</span> and it links straight to it.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b px-4 py-2.5">
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
            </header>

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {messages.map((m, i) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  mine={m.author_id === me.id}
                  showHead={i === 0 || messages[i - 1].author_id !== m.author_id || m.created_at - messages[i - 1].created_at > 5 * 60_000}
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
              <div className="border-t p-3">
                <div className="flex items-end gap-2 rounded-2xl border px-3 py-2" style={{ background: 'var(--bg-input)' }}>
                  <textarea
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                    }}
                    placeholder={`Message ${room.kind === 'task' ? 'the group' : roomTitle(room, me)} — #12 links a task, @ mentions someone`}
                    className="max-h-32 flex-1 resize-none bg-transparent py-1 text-[13.5px] outline-none placeholder:text-[var(--text-tertiary)]"
                  />
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

function roomTitle(room: ConversationFull, me: User): string {
  if (room.kind === 'task') return room.title;
  const other = room.members.find((m) => m.id !== me.id);
  return other?.name ?? 'Conversation';
}

function RoomRow({ room, me, active, onOpen }: { room: ConversationFull; me: User; active: boolean; onOpen: () => void }) {
  const other = room.members.find((m) => m.id !== me.id) ?? null;
  const preview = room.last_message
    ? `${room.last_message.author ? room.last_message.author.name.split(' ')[0] + ': ' : ''}${room.last_message.body}`
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
          {room.last_message && (
            <span className="shrink-0 text-[10.5px] text-[var(--text-tertiary)]">{timeAgo(room.last_message.created_at)}</span>
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

function MessageRow({ message, mine, showHead, onOpenTask }: {
  message: Message; mine: boolean; showHead: boolean; onOpenTask: (id: string) => void;
}) {
  // System lines (no author) sit centred and quiet.
  if (!message.author_id) {
    return (
      <div className="my-3 text-center text-[11.5px] text-[var(--text-tertiary)]">{message.body}</div>
    );
  }
  return (
    <div className={`flex gap-2.5 ${showHead ? 'mt-3' : 'mt-0.5'} ${mine ? 'flex-row-reverse' : ''}`}>
      <div className="w-7 shrink-0">{showHead && <Avatar user={message.author} size="sm" />}</div>
      <div className={`max-w-[72%] ${mine ? 'items-end' : ''}`}>
        {showHead && (
          <div className={`mb-0.5 flex items-baseline gap-1.5 text-[11px] ${mine ? 'justify-end' : ''}`}>
            <span className="font-semibold text-[var(--text-secondary)]">{message.author?.name ?? 'Someone'}</span>
            <span className="text-[var(--text-tertiary)]" title={formatDateTime(message.created_at)}>{timeAgo(message.created_at)}</span>
          </div>
        )}
        <div
          className="whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[13.5px] leading-relaxed"
          style={mine
            ? { background: 'var(--accent)', color: 'var(--on-accent)', borderTopRightRadius: showHead ? 6 : undefined }
            : { background: 'var(--bg-card)', border: '1px solid var(--border)', borderTopLeftRadius: showHead ? 6 : undefined }}
          onClick={(e) => {
            const t = (e.target as HTMLElement).closest('[data-task]') as HTMLElement | null;
            if (t?.dataset.task) onOpenTask(t.dataset.task);
          }}
          dangerouslySetInnerHTML={{ __html: renderBody(message.body, mine) }}
        />
      </div>
    </div>
  );
}

/**
 * Escapes, then lights up two things: @mentions, and task references written
 * as #12 or #TSK-12. The task id is not in the text, so the click resolves
 * it by ticket number through the board the workspace already holds.
 */
function renderBody(body: string, mine: boolean): string {
  const linkStyle = mine ? 'text-decoration:underline;font-weight:600' : 'color:var(--accent);font-weight:600';
  return escapeHtml(body)
    .replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (_m, name: string) => `<span class="mention">@${name}</span>`)
    .replace(/#(?:TSK-)?(\d{1,6})\b/gi, (_m, n: string) =>
      `<button type="button" data-seq="${n}" data-task="seq:${n}" style="${linkStyle}">#TSK-${n}</button>`);
}
