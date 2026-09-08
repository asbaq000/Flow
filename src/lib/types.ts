export type Role = 'CEO' | 'MANAGER' | 'TEAM_LEAD' | 'DEV';
export type Status =
  | 'TRIAGE' | 'TODO' | 'IN_PROGRESS' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'BLOCKED' | 'DONE';
export type Priority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export const ROLES: { id: Role; label: string; rank: number; blurb: string }[] = [
  { id: 'CEO',       label: 'CEO',       rank: 0, blurb: 'Full oversight of every task. The only role that changes people’s roles.' },
  { id: 'MANAGER',   label: 'Manager',   rank: 1, blurb: 'Raises work. Every task they create routes to a Team Lead for triage.' },
  { id: 'TEAM_LEAD', label: 'Team Lead', rank: 2, blurb: 'Triages the inbox, assigns and splits work, reviews what Devs submit.' },
  { id: 'DEV',       label: 'Developer', rank: 3, blurb: 'Executes assigned work, reports progress and submits it for review.' },
];

/*
 * `dot` and `tint` are CSS variables rather than literals so a status keeps
 * its meaning through a theme change — the pastels have to become deep
 * translucent washes on a dark ground or every column turns into a headlight.
 */
export const STATUSES: { id: Status; label: string; color: string; dot: string; group: string }[] = [
  { id: 'TRIAGE',            label: 'Triage',            color: '', dot: 'var(--s-triage-dot)',   group: 'Inbox' },
  { id: 'TODO',              label: 'To Do',             color: '', dot: 'var(--s-todo-dot)',     group: 'Active' },
  { id: 'IN_PROGRESS',       label: 'In Progress',       color: '', dot: 'var(--s-progress-dot)', group: 'Active' },
  { id: 'SUBMITTED',         label: 'In Review',         color: '', dot: 'var(--s-review-dot)',   group: 'Review' },
  { id: 'CHANGES_REQUESTED', label: 'Changes Requested', color: '', dot: 'var(--s-changes-dot)',  group: 'Review' },
  { id: 'BLOCKED',           label: 'Blocked',           color: '', dot: 'var(--s-blocked-dot)',  group: 'Active' },
  { id: 'DONE',              label: 'Done',              color: '', dot: 'var(--s-done-dot)',     group: 'Closed' },
];

/** Statuses a Developer may set on their own task. Approval is not theirs to give. */
export const DEV_SETTABLE: Status[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED'];

export const PRIORITIES: { id: Priority; label: string; color: string; weight: number }[] = [
  { id: 'URGENT', label: 'Urgent', color: '#ec4a72', weight: 0 },
  { id: 'HIGH',   label: 'High',   color: '#f4693f', weight: 1 },
  { id: 'MEDIUM', label: 'Medium', color: '#f0913a', weight: 2 },
  { id: 'LOW',    label: 'Low',    color: '#3d8bfd', weight: 3 },
  { id: 'NONE',   label: 'None',   color: '#9797ac', weight: 4 },
];

export const TAG_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  avatar_color: string;
  title: string | null;
  created_at: number;
}

export interface Tag { id: string; name: string; color: TagColor }
export interface TaskLink { id: string; task_id: string; url: string; label: string; position: number }

export type ProgressKind = 'update' | 'submitted' | 'approved' | 'changes_requested';

export interface ProgressUpdate {
  id: string;
  task_id: string;
  author_id: string | null;
  kind: ProgressKind;
  percent: number;
  done_summary: string;
  remaining: string;
  blockers: string;
  hours_spent: number | null;
  created_at: number;
  author: User | null;
}

export type MeetingStatus = 'scheduled' | 'failed' | 'cancelled';

export interface Meeting {
  id: string;
  title: string;
  agenda: string;
  organizer_id: string | null;
  task_id: string | null;
  starts_at: number;
  duration_min: number;
  time_zone: string;
  /** The Google Meet URL. Null while a sync is still failing. */
  join_url: string | null;
  calendar_event_id: string | null;
  status: MeetingStatus;
  /** Why Google refused the event, shown to the organiser so they can retry. */
  sync_error: string | null;
  /** What was discussed, written up in the app after the call. */
  minutes: string;
  minutes_author_id: string | null;
  minutes_updated_at: number | null;
  created_at: number;
  updated_at: number;
}

/** A participant plus whether they actually turned up. */
export interface MeetingAttendee extends User {
  /** null = nobody has said, 1 = joined, 0 = did not. */
  attended: number | null;
}

export interface MeetingFull extends Meeting {
  organizer: User | null;
  participants: MeetingAttendee[];
  task_title?: string | null;
}

export const MEETING_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

export type MeetingPhase = 'upcoming' | 'live' | 'ended' | 'cancelled';

/**
 * Where a meeting is in its life, worked out from the clock rather than
 * stored. Google will not tell a free account when a call actually broke up,
 * so the scheduled window is the honest source: no polling, no stale row, and
 * it flips on its own the moment the end time passes.
 */
export function meetingPhase(
  meeting: Pick<Meeting, 'status' | 'starts_at' | 'duration_min'>,
  now: number = Date.now()
): MeetingPhase {
  if (meeting.status === 'cancelled') return 'cancelled';
  const endsAt = meeting.starts_at + meeting.duration_min * 60_000;
  if (now >= endsAt) return 'ended';
  // Doors open a few minutes early, the way people actually join a call.
  if (now >= meeting.starts_at - 5 * 60_000) return 'live';
  return 'upcoming';
}

export type ConversationKind = 'direct' | 'task';

export interface Conversation {
  id: string;
  kind: ConversationKind;
  task_id: string | null;
  title: string;
  /** Set when the task behind a task conversation is done. */
  closed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  author_id: string | null;
  body: string;
  created_at: number;
  author: User | null;
}

export interface ConversationFull extends Conversation {
  members: User[];
  last_message: Message | null;
  unread: number;
  task_seq?: number | null;
  task_status?: Status | null;
}

/** Roughly "does this person have a picture", without shipping the bytes. */
export interface UserProfile extends User {
  has_avatar: boolean;
}

export interface Attachment {
  id: string;
  task_id: string;
  uploader_id: string | null;
  filename: string;
  mime: string;
  byte_size: number;
  created_at: number;
  uploader?: User | null;
}

/** Per file. The whole database is 500 MB on Supabase's free tier. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface Task {
  id: string;
  seq: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  /** Null when the person who raised it has been removed from the workspace. */
  creator_id: string | null;
  assignee_id: string | null;
  parent_id: string | null;
  due_date: number | null;
  start_date: number | null;
  estimate: number | null;
  progress: number;
  position: number;
  archived: number;
  created_at: number;
  updated_at: number;
  submitted_at: number | null;
  completed_at: number | null;
}

export interface TaskFull extends Task {
  creator: User | null;
  assignee: User | null;
  collaborators: User[];
  tags: Tag[];
  links: TaskLink[];
  subtasks: TaskFull[];
  comment_count: number;
  voice_notes: VoiceNote[];
  attachments: Attachment[];
  progress_updates: ProgressUpdate[];
  parent_title?: string | null;
}

export type TranscriptStatus = 'none' | 'pending' | 'done' | 'failed';

export interface VoiceNote {
  id: string;
  task_id: string;
  comment_id: string | null;
  author_id: string | null;
  mime: string;
  duration_ms: number;
  byte_size: number;
  created_at: number;
  /** Roman script for Urdu speech, spoken-language script otherwise. */
  transcript: string | null;
  /** BCP-47-ish tag detected by the speech model, e.g. 'en' or 'ur'. */
  transcript_lang: string | null;
  transcript_status: TranscriptStatus;
  author?: User | null;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  resolved: number;
  created_at: number;
  updated_at: number;
  author: User | null;
  voice_notes: VoiceNote[];
}

export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  task_id: string | null;
  comment_id: string | null;
  message: string;
  read: number;
  created_at: number;
  actor: User | null;
  task_title?: string | null;
  task_seq?: number | null;
}

export interface ActivityItem {
  id: string;
  task_id: string;
  actor_id: string | null;
  type: string;
  meta: string;
  created_at: number;
  actor: User | null;
}

/* ---------- Block editor document model ---------- */

export type BlockType =
  | 'paragraph' | 'heading1' | 'heading2' | 'heading3'
  | 'bulleted' | 'numbered' | 'todo' | 'toggle'
  | 'quote' | 'callout' | 'code' | 'divider' | 'image';

export interface Block {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
  collapsed?: boolean;
  language?: string;
  emoji?: string;
  url?: string;
  children?: Block[];
}

export function emptyDoc(): Block[] {
  return [{ id: 'b' + Math.random().toString(36).slice(2, 10), type: 'paragraph', text: '' }];
}

export function parseDoc(raw: string | null | undefined): Block[] {
  if (!raw) return emptyDoc();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed as Block[];
    return emptyDoc();
  } catch {
    // Legacy plain-text descriptions degrade into a single paragraph.
    return [{ id: 'legacy', type: 'paragraph', text: String(raw) }];
  }
}

/** Strips block markup to a single line — used for previews and search. */
export function docToPlain(raw: string | null | undefined): string {
  return parseDoc(raw)
    .flatMap((b) => [b.text, ...(b.children ?? []).map((c) => c.text)])
    .map((t) => t.replace(/<[^>]*>/g, '').trim())
    .filter(Boolean)
    .join(' ');
}

/* ---------- developer task sheet ---------- */

export interface SheetEntry {
  id: string;
  seq: number;
  title: string;
  status: Status;
  priority: Priority;
  parent_title: string | null;
  tags: Tag[];
  created_at: number;
  completed_at: number | null;
  due_date: number | null;
  /** Wall-clock time from creation to completion, in ms. */
  turnaround_ms: number | null;
  /** True when the task was finished on or before its due date. */
  on_time: boolean | null;
  comment_count: number;
  assigned_by: string | null;
}

export interface TaskSheet {
  user: User;
  completed: SheetEntry[];
  active: SheetEntry[];
  stats: {
    completed_total: number;
    completed_7d: number;
    completed_30d: number;
    active_total: number;
    overdue: number;
    on_time_rate: number | null;
    median_turnaround_ms: number | null;
  };
}
