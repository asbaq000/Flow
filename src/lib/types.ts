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

export const STATUSES: { id: Status; label: string; color: string; dot: string; group: string }[] = [
  { id: 'TRIAGE',            label: 'Triage',            color: '', dot: '#f59e0b', group: 'Inbox' },
  { id: 'TODO',              label: 'To Do',             color: '', dot: '#64748b', group: 'Active' },
  { id: 'IN_PROGRESS',       label: 'In Progress',       color: '', dot: '#3b82f6', group: 'Active' },
  { id: 'SUBMITTED',         label: 'In Review',         color: '', dot: '#8b5cf6', group: 'Review' },
  { id: 'CHANGES_REQUESTED', label: 'Changes Requested', color: '', dot: '#f97316', group: 'Review' },
  { id: 'BLOCKED',           label: 'Blocked',           color: '', dot: '#f43f5e', group: 'Active' },
  { id: 'DONE',              label: 'Done',              color: '', dot: '#10b981', group: 'Closed' },
];

/** Statuses a Developer may set on their own task. Approval is not theirs to give. */
export const DEV_SETTABLE: Status[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED'];

export const PRIORITIES: { id: Priority; label: string; color: string; weight: number }[] = [
  { id: 'URGENT', label: 'Urgent', color: '#ef4444', weight: 0 },
  { id: 'HIGH',   label: 'High',   color: '#f97316', weight: 1 },
  { id: 'MEDIUM', label: 'Medium', color: '#eab308', weight: 2 },
  { id: 'LOW',    label: 'Low',    color: '#3b82f6', weight: 3 },
  { id: 'NONE',   label: 'None',   color: '#94a3b8', weight: 4 },
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
  progress_updates: ProgressUpdate[];
  parent_title?: string | null;
}

export interface VoiceNote {
  id: string;
  task_id: string;
  comment_id: string | null;
  author_id: string | null;
  mime: string;
  duration_ms: number;
  byte_size: number;
  created_at: number;
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
