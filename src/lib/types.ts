export type Role = 'CEO' | 'MANAGER' | 'TEAM_LEAD' | 'DEV';
export type Status =
  | 'TODO' | 'IN_PROGRESS' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'DONE';
export type Priority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export const ROLES: { id: Role; label: string; rank: number; blurb: string }[] = [
  { id: 'CEO',       label: 'CEO',       rank: 0, blurb: 'Full oversight of every task. The only role that changes people’s roles.' },
  { id: 'MANAGER',   label: 'Manager',   rank: 1, blurb: 'Raises work. Every task they create routes to a Team Lead for triage.' },
  { id: 'TEAM_LEAD', label: 'Team Lead', rank: 2, blurb: 'The only role that assigns work. Splits it, and reviews what Devs submit.' },
  { id: 'DEV',       label: 'Developer', rank: 3, blurb: 'Executes assigned work, reports progress and submits it for review.' },
];

/*
 * `dot` and `tint` are CSS variables rather than literals so a status keeps
 * its meaning through a theme change — the pastels have to become deep
 * translucent washes on a dark ground or every column turns into a headlight.
 */
export const STATUSES: { id: Status; label: string; color: string; dot: string; group: string }[] = [
  { id: 'TODO',              label: 'To Do',             color: '', dot: 'var(--s-todo-dot)',     group: 'Active' },
  { id: 'IN_PROGRESS',       label: 'In Progress',       color: '', dot: 'var(--s-progress-dot)', group: 'Active' },
  { id: 'SUBMITTED',         label: 'In Review',         color: '', dot: 'var(--s-review-dot)',   group: 'Review' },
  { id: 'CHANGES_REQUESTED', label: 'Changes Requested', color: '', dot: 'var(--s-changes-dot)',  group: 'Review' },
  { id: 'DONE',              label: 'Done',              color: '', dot: 'var(--s-done-dot)',     group: 'Closed' },
];

/** Statuses a Developer may set on their own task. Approval is not theirs to give. */
export const DEV_SETTABLE: Status[] = ['TODO', 'IN_PROGRESS', 'SUBMITTED'];

/*
 * Urgency is a temperature, so the scale reads as one: deep red at the top,
 * cooling through red to a calm blue in the middle, and a warm amber at the
 * bottom for work that is real but not pressing. Nothing here is a hue
 * somebody has to learn — red is loud everywhere.
 */
export const PRIORITIES: { id: Priority; label: string; color: string; weight: number }[] = [
  { id: 'URGENT', label: 'Urgent', color: '#9b1c31', weight: 0 },
  { id: 'HIGH',   label: 'High',   color: '#e5484d', weight: 1 },
  { id: 'MEDIUM', label: 'Medium', color: '#3b6fd4', weight: 2 },
  { id: 'LOW',    label: 'Low',    color: '#e8963c', weight: 3 },
  { id: 'NONE',   label: 'None',   color: '#9797ac', weight: 4 },
];

/** What a task is unless somebody says otherwise. Most work raised here is. */
export const DEFAULT_PRIORITY: Priority = 'HIGH';

export const TAG_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/*
 * What a new organisation starts with, because an empty tag picker teaches
 * nobody anything. The set is the work this is actually used for — shipping
 * web software and building on models — in three groups: the surface, the
 * model, and the things every team does regardless.
 *
 * Nothing here is fixed. Tags are created by typing one, and these are only
 * a first shelf rather than a taxonomy anybody has to obey.
 */
export const STARTER_TAGS: { name: string; color: TagColor }[] = [
  { name: 'frontend', color: 'blue' },
  { name: 'backend', color: 'purple' },
  { name: 'api', color: 'green' },
  { name: 'database', color: 'brown' },
  { name: 'ui-ux', color: 'pink' },
  { name: 'mobile', color: 'orange' },
  { name: 'ai-model', color: 'purple' },
  { name: 'prompt', color: 'pink' },
  { name: 'dataset', color: 'yellow' },
  { name: 'rag', color: 'green' },
  { name: 'fine-tuning', color: 'orange' },
  { name: 'inference', color: 'blue' },
  { name: 'bug', color: 'red' },
  { name: 'feature', color: 'green' },
  { name: 'testing', color: 'yellow' },
  { name: 'deploy', color: 'orange' },
  { name: 'docs', color: 'gray' },
  { name: 'security', color: 'red' },
];

export interface Organization {
  id: string;
  name: string;
  /**
   * The CEO's code. Admits a Manager, a Team Lead or a Developer, so it is
   * only ever sent to the CEO.
   */
  invite_code?: string;
  /**
   * The Team Leads' code. Admits Developers and nothing else, so a Lead can
   * bring their own people in without being able to mint a Manager.
   */
  lead_invite_code?: string;
  created_at: number;
}

/** Which roles a given invite code is allowed to create. */
export const CODE_ROLES: Record<'admin' | 'lead', Role[]> = {
  admin: ['MANAGER', 'TEAM_LEAD', 'DEV'],
  lead: ['DEV'],
};

export interface User {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: Role;
  avatar_color: string;
  title: string | null;
  created_at: number;
}

export interface Tag { id: string; org_id?: string; name: string; color: TagColor }
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
  org_id: string;
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
  org_id: string;
  kind: ConversationKind;
  task_id: string | null;
  title: string;
  /** Set when the task behind a task conversation is done. */
  closed_at: number | null;
  created_at: number;
  updated_at: number;
}

export type MessageFileKind = 'file' | 'image' | 'voice';

/** A file sent in chat. The bytes are fetched separately, by id. */
export interface MessageFile {
  id: string;
  message_id: string;
  kind: MessageFileKind;
  filename: string;
  mime: string;
  byte_size: number;
  duration_ms: number;
  created_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  author_id: string | null;
  body: string;
  created_at: number;
  edited_at: number | null;
  /** Set when taken back; the body is emptied and the bubble reads "deleted". */
  deleted_at: number | null;
  author: User | null;
  files: MessageFile[];
}

/** What the profile page shows after "send me a test". */
export interface NotificationTestResult {
  inApp: { ok: boolean };
  email: { configured: boolean; ok: boolean; to: string; error?: string };
  push: { configured: boolean; devices: number; sent: number; ok: boolean };
  slack: { configured: boolean; ok: boolean };
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
  org_id: string;
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

/** Wraps a plain-typed brief into the block document the editor understands. */
export function docFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '[]';
  const blocks: Block[] = trimmed.split(/\n{2,}/).map((para, i) => ({
    id: `b${i}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'paragraph',
    text: para.trim(),
  }));
  return JSON.stringify(blocks);
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
