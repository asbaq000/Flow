'use client';

import type {
  Attachment, Block, Comment, ConversationFull, MeetingFull, Message, Notification, NotificationTestResult,
  Organization, Priority,
  ProgressUpdate, Status, Tag, TaskFull,
  TaskSheet, User, VoiceNote,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  tasks: {
    list: (params: { archived?: boolean; q?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.archived) search.set('archived', '1');
      if (params.q) search.set('q', params.q);
      const qs = search.toString();
      return request<{ tasks: TaskFull[]; users: User[]; tags: Tag[]; me: User }>(
        `/api/tasks${qs ? `?${qs}` : ''}`
      );
    },
    get: (id: string) =>
      request<{
        task: TaskFull;
        comments: Comment[];
        activity: import('./types').ActivityItem[];
        members: User[];
        abilities: import('./permissions').TaskAbilities;
      }>(`/api/tasks/${id}`),
    create: (body: {
      title: string;
      description?: string;
      priority?: Priority;
      /** Leads only — anyone else's task routes to a Lead for triage. */
      assigneeId?: string | null;
      parentId?: string | null;
      dueDate?: number | null;
      links?: { url: string; label?: string }[];
      tagIds?: string[];
    }) =>
      request<{
        task: TaskFull;
        routedTo: { id: string; name: string } | null;
        assignedDirectly?: boolean;
      }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      body: Partial<{
        title: string;
        description: string;
        status: Status;
        priority: Priority;
        assigneeId: string | null;
        dueDate: number | null;
        estimate: number | null;
        position: number;
        archived: boolean;
        tagIds: string[];
      }>
    ) => request<{ task: TaskFull }>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<{ ok: true }>(`/api/tasks/${id}`, { method: 'DELETE' }),
    split: (
      id: string,
      pieces: { title: string; description?: string; assigneeId: string | null; estimate?: number | null }[]
    ) =>
      request<{ task: TaskFull }>(`/api/tasks/${id}/split`, {
        method: 'POST',
        body: JSON.stringify({ pieces }),
      }),
    addLink: (id: string, url: string, label: string) =>
      request<{ link: import('./types').TaskLink }>(`/api/tasks/${id}/links`, {
        method: 'POST',
        body: JSON.stringify({ url, label }),
      }),
    removeLink: (linkId: string) => request<{ ok: true }>(`/api/links/${linkId}`, { method: 'DELETE' }),
    /** People who can be @mentioned on this task — i.e. who can actually see it. */
    members: (id: string) => request<{ members: User[] }>(`/api/tasks/${id}/members`),
  },
  voice: {
    /** Uploads a recording. Omit commentId to attach it to the task brief. */
    upload: async (taskId: string, blob: Blob, durationMs: number, commentId?: string) => {
      const form = new FormData();
      form.append('audio', blob, 'note.webm');
      form.append('durationMs', String(Math.round(durationMs)));
      if (commentId) form.append('commentId', commentId);

      // No Content-Type header — the browser must set the multipart boundary.
      const res = await fetch(`/api/tasks/${taskId}/voice`, { method: 'POST', body: form });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new ApiError(data.error ?? 'Upload failed', res.status);
      return data as { voiceNote: VoiceNote };
    },
    remove: (id: string) => request<{ ok: true }>(`/api/voice/${id}`, { method: 'DELETE' }),
    src: (id: string) => `/api/voice/${id}`,
    /** True if this tab won the race to transcribe — false means someone else already is. */
    claimTranscription: (id: string) =>
      request<{ claimed: boolean }>(`/api/voice/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'claim' }),
      }),
    saveTranscript: (id: string, transcript: string, lang: string | null) =>
      request<{ voiceNote: VoiceNote }>(`/api/voice/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done', transcript, lang }),
      }),
    markTranscriptFailed: (id: string) =>
      request<{ voiceNote: VoiceNote }>(`/api/voice/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'failed' }),
      }),
  },
  sheet: {
    get: (userId: string) => request<{ sheet: TaskSheet }>(`/api/users/${userId}/sheet`),
  },
  progress: {
    list: (taskId: string) => request<{ updates: ProgressUpdate[] }>(`/api/tasks/${taskId}/progress`),
    /** Log a routine update. */
    post: (taskId: string, body: {
      percent: number; doneSummary: string; remaining?: string; blockers?: string; hoursSpent?: number | null;
    }) =>
      request<{ update: ProgressUpdate; task: TaskFull }>(`/api/tasks/${taskId}/progress`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    /** Hand the task to a Team Lead for review. */
    submit: (taskId: string, body: {
      doneSummary: string; remaining?: string; blockers?: string; percent?: number; hoursSpent?: number | null;
    }) =>
      request<{ task: TaskFull }>(`/api/tasks/${taskId}/progress`, {
        method: 'POST',
        body: JSON.stringify({ ...body, submit: true }),
      }),
  },
  review: {
    decide: (taskId: string, decision: 'approve' | 'request_changes', note: string) =>
      request<{ task: TaskFull }>(`/api/tasks/${taskId}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      }),
  },
  comments: {
    list: (taskId: string) => request<{ comments: Comment[] }>(`/api/tasks/${taskId}/comments`),
    add: (taskId: string, body: string) =>
      request<{ comment: Comment }>(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    remove: (id: string) => request<{ ok: true }>(`/api/comments/${id}`, { method: 'DELETE' }),
    setResolved: (id: string, resolved: boolean) =>
      request<{ ok: true }>(`/api/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ resolved }) }),
  },
  activity: {
    list: (taskId: string) =>
      request<{ activity: import('./types').ActivityItem[] }>(`/api/tasks/${taskId}/activity`),
  },
  notifications: {
    test: () => request<NotificationTestResult>('/api/notifications/test', { method: 'POST' }),
    list: () => request<{ notifications: Notification[]; unread: number }>('/api/notifications'),
    read: (ids: string[] | 'all') =>
      request<{ ok: true }>('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  },
  users: {
    list: () => request<{ users: (User & { open_tasks: number })[] }>('/api/users'),
    update: (id: string, body: { role?: string; title?: string }) =>
      request<{ user: User }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    /** Offboards someone who has left. Their work history is kept. */
    remove: (id: string) =>
      request<{ removed: { name: string; email: string; reassigned: number } }>(
        `/api/users/${id}`,
        { method: 'DELETE' }
      ),
  },
  tags: {
    create: (name: string, color: string) =>
      request<{ tag: Tag }>('/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
  },
  attachments: {
    upload: async (taskId: string, file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('filename', file.name);
      // No Content-Type header — the browser sets the multipart boundary.
      const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: form });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new ApiError(data.error ?? `Upload failed (${res.status})`, res.status);
      return data as { attachment: Attachment };
    },
    remove: (id: string) => request<{ ok: true }>(`/api/attachments/${id}`, { method: 'DELETE' }),
    downloadUrl: (id: string) => `/api/attachments/${id}`,
  },
  transcripts: {
    /** Sends one chunk of a recording to the hosted speech model. */
    speech: (audio: string) =>
      request<{ text: string; configured: boolean; error?: string }>(
        '/api/transcripts/speech',
        { method: 'POST', body: JSON.stringify({ audio }) }
      ),
    /** Tidies raw speech-to-text, or turns a meeting transcript into minutes. */
    polish: (text: string, lang: 'ur' | 'en' | null, mode: 'clean' | 'minutes' = 'clean') =>
      request<{ text: string; lang: 'ur' | 'en' | null; polished: boolean }>(
        '/api/transcripts/polish',
        { method: 'POST', body: JSON.stringify({ text, lang, mode }) }
      ),
  },
  meetings: {
    list: (scope: 'upcoming' | 'past' = 'upcoming') =>
      request<{ meetings: MeetingFull[] }>(`/api/meetings?scope=${scope}`),
    create: (input: {
      title: string;
      agenda?: string;
      startsAt: number;
      durationMin: number;
      timeZone: string;
      participantIds: string[];
      taskId?: string | null;
    }) =>
      request<{ meeting: MeetingFull }>('/api/meetings', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    retry: (id: string) =>
      request<{ meeting: MeetingFull }>(`/api/meetings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'retry' }),
      }),
    saveMinutes: (id: string, minutes: string) =>
      request<{ meeting: MeetingFull }>(`/api/meetings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'minutes', minutes }),
      }),
    setAttendance: (id: string, userId: string, attended: boolean | null) =>
      request<{ meeting: MeetingFull }>(`/api/meetings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'attendance', userId, attended }),
      }),
    cancel: (id: string) =>
      request<{ meeting: MeetingFull }>(`/api/meetings/${id}`, { method: 'DELETE' }),
  },
  conversations: {
    list: () => request<{ conversations: ConversationFull[] }>('/api/conversations'),
    open: (id: string) =>
      request<{ conversation: ConversationFull; messages: Message[] }>(`/api/conversations/${id}`),
    direct: (userId: string) =>
      request<{ conversation: ConversationFull }>('/api/conversations', {
        method: 'POST', body: JSON.stringify({ userId }),
      }),
    send: (id: string, body: string) =>
      request<{ message: Message }>(`/api/conversations/${id}/messages`, {
        method: 'POST', body: JSON.stringify({ body }),
      }),
    /** A photo, a document or a voice note, with an optional caption. */
    sendFile: async (
      id: string,
      file: Blob,
      opts: { filename: string; body?: string; kind?: 'voice'; durationMs?: number }
    ) => {
      const form = new FormData();
      form.append('file', file, opts.filename);
      form.append('filename', opts.filename);
      if (opts.body) form.append('body', opts.body);
      if (opts.kind) form.append('kind', opts.kind);
      if (opts.durationMs) form.append('durationMs', String(opts.durationMs));
      const res = await fetch(`/api/conversations/${id}/files`, { method: 'POST', body: form });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new ApiError(data.error ?? 'Upload failed', res.status);
      return data as { message: Message };
    },
    fileUrl: (fileId: string) => `/api/message-files/${fileId}`,
    /** Empties the thread for you alone. */
    clear: (id: string) => request<{ ok: true }>(`/api/conversations/${id}/clear`, { method: 'POST' }),
    /** Drops the room from your list (and clears it for you) until someone writes again. */
    remove: (id: string) => request<{ ok: true }>(`/api/conversations/${id}`, { method: 'DELETE' }),
  },
  messages: {
    edit: (id: string, body: string) =>
      request<{ message: Message }>(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
    remove: (id: string) => request<{ ok: true }>(`/api/messages/${id}`, { method: 'DELETE' }),
  },
  profile: {
    withPictures: () => request<{ avatars: { id: string; v: number }[] }>('/api/users/avatars'),
    avatarUrl: (userId: string) => `/api/users/${userId}/avatar`,
    setAvatar: async (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch('/api/users/me/avatar', { method: 'POST', body: form });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new ApiError(data.error ?? 'Upload failed', res.status);
      return data as { ok: true; version: number };
    },
    changePassword: (current: string, next: string) =>
      request<{ ok: true; signedOut: boolean }>('/api/users/me/password', {
        method: 'POST', body: JSON.stringify({ current, next }),
      }),
    exportUrl: (userId: string) => `/api/users/${userId}/export`,
  },
  org: {
    get: () => request<{ org: Organization; seatVacant: boolean }>('/api/org'),
    update: (body: { name?: string; rotateInvite?: boolean; rotateLeadInvite?: boolean }) =>
      request<{ org: Organization }>('/api/org', { method: 'PATCH', body: JSON.stringify(body) }),
  },
  push: {
    key: () => request<{ enabled: boolean; key: string | null }>('/api/push/key'),
    subscribe: (sub: PushSubscriptionJSON) =>
      request<{ ok: true }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
    unsubscribe: (endpoint: string) =>
      request<{ ok: true }>('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  },
  /** Tells the server which clock this browser reads times in. */
  setTimeZone: (timeZone: string) =>
    request<{ user: User }>('/api/me', { method: 'PATCH', body: JSON.stringify({ timeZone }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
};

export const serializeDoc = (blocks: Block[]) => JSON.stringify(blocks);
