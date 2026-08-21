import type { Role, Status, TaskFull, User } from './types';

/**
 * The chain of command:
 *
 *   Manager ──raises──▶ Team Lead ──assigns──▶ Developer
 *                           ▲                      │
 *                           └──── submits for ─────┘
 *                                   review
 *
 * The CEO sits above all of it with full oversight and can do anything a Lead
 * can, plus manage roles.
 */

const RANK: Record<Role, number> = { CEO: 0, MANAGER: 1, TEAM_LEAD: 2, DEV: 3 };

export const isCeo = (u: User) => u.role === 'CEO';
export const isDev = (u: User) => u.role === 'DEV';

/**
 * Anyone with authority to triage, assign and review. Managers raise work —
 * they sit above Leads on the org chart but outside the delivery chain, so
 * they do not assign or approve.
 */
export const isLead = (u: User) => u.role === 'TEAM_LEAD' || u.role === 'CEO';

/** Raises work without running the board. */
export const isManager = (u: User) => u.role === 'MANAGER';

export const rankOf = (role: Role) => RANK[role];

/** Is the user personally attached to the task? */
export function isParticipant(user: User, task: TaskFull): boolean {
  return (
    task.creator_id === user.id ||
    task.assignee_id === user.id ||
    task.collaborators.some((c) => c.id === user.id) ||
    task.subtasks.some((s) => s.assignee_id === user.id)
  );
}

/** Leads and above see the whole board; everyone else sees only what touches them. */
export function canView(user: User, task: TaskFull): boolean {
  return isLead(user) || isParticipant(user, task);
}

export function canComment(user: User, task: TaskFull): boolean {
  return canView(user, task);
}

/** Only leads and above move work between people. */
export function canAssign(user: User): boolean {
  return isLead(user);
}

/** Work only ever flows down to a Developer. */
export function isAssignableRole(role: Role): boolean {
  return role === 'DEV';
}

export function canSplit(user: User, task: TaskFull): boolean {
  return isLead(user) && !task.parent_id;
}

/* ------------------------------------------------------------------ */
/* Meetings                                                            */
/* ------------------------------------------------------------------ */

/** Calling the team together is a coordination act, so it sits with the Leads. */
export function canScheduleMeeting(user: User): boolean {
  return isLead(user);
}

/** The organiser can call off their own meeting; so can any Lead or the CEO. */
export function canCancelMeeting(user: User, meeting: { organizer_id: string | null }): boolean {
  return isLead(user) || meeting.organizer_id === user.id;
}

/* ------------------------------------------------------------------ */
/* The review gate                                                     */
/* ------------------------------------------------------------------ */

/** Only the people who own review can hand down a final DONE. */
export function canApprove(user: User, task: TaskFull): boolean {
  return isLead(user) && task.status === 'SUBMITTED';
}

export function canRequestChanges(user: User, task: TaskFull): boolean {
  return isLead(user) && task.status === 'SUBMITTED';
}

/** The assigned Developer (or a lead acting for them) can hand work in. */
export function canSubmitForReview(user: User, task: TaskFull): boolean {
  if (task.status === 'SUBMITTED' || task.status === 'DONE') return false;
  if (isLead(user)) return true;
  return isDev(user) && isAssignedTo(user, task);
}

export function isAssignedTo(user: User, task: TaskFull): boolean {
  return task.assignee_id === user.id || task.collaborators.some((c) => c.id === user.id);
}

/** Developers report progress on their own work; leads can log on any task. */
export function canPostProgress(user: User, task: TaskFull): boolean {
  return isLead(user) || (isDev(user) && isAssignedTo(user, task));
}

/**
 * Which statuses may this user move the task into?
 *
 * A Developer drives their own work up to SUBMITTED and no further — marking
 * something DONE is a review decision, not a self-declaration.
 */
export function allowedStatuses(user: User, task: TaskFull): Status[] {
  if (isLead(user)) {
    return ['TRIAGE', 'TODO', 'IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED', 'BLOCKED', 'DONE'];
  }
  if (isDev(user) && isAssignedTo(user, task)) {
    return ['TODO', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED'];
  }
  return [];
}

export function canChangeStatus(user: User, task: TaskFull): boolean {
  return allowedStatuses(user, task).length > 0;
}

export function canSetStatus(user: User, task: TaskFull, next: Status): boolean {
  return allowedStatuses(user, task).includes(next);
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

/**
 * The brief belongs to whoever raised it and to the leads who own triage.
 * Developers execute the brief — they do not rewrite it.
 */
export function canEditContent(user: User, task: TaskFull): boolean {
  if (isLead(user)) return true;
  return task.creator_id === user.id && !isDev(user);
}

export function canEditPriority(user: User, task: TaskFull): boolean {
  return canEditContent(user, task);
}

export function canAddTaskVoiceNote(user: User, task: TaskFull): boolean {
  return canEditContent(user, task);
}

export function canAddCommentVoiceNote(user: User, task: TaskFull): boolean {
  return canComment(user, task);
}

export function canArchive(user: User, task: TaskFull): boolean {
  return isLead(user) || (task.creator_id === user.id && task.status === 'TRIAGE');
}

/**
 * Deleting is permanent and takes the comments, recordings and history with
 * it, so it stays with the people who run the board — a Team Lead or the CEO.
 * Anyone else may still delete something they raised themselves, but only
 * while it is untouched in triage.
 */
export function canDelete(user: User, task: TaskFull): boolean {
  return isLead(user) || (task.creator_id === user.id && task.status === 'TRIAGE');
}

/** Only the CEO reshapes the org chart. */
export function canManageUsers(user: User): boolean {
  return isCeo(user);
}

/**
 * Who may remove someone from the workspace when they leave.
 *
 * A Team Lead can offboard the people below them — Managers and Developers —
 * but not another Lead and not the CEO. Only the CEO can remove a Lead, and
 * nobody can remove themselves or the last remaining CEO.
 */
export function canRemoveUser(actor: User, target: User): boolean {
  if (actor.id === target.id) return false;
  if (target.role === 'CEO') return false;
  if (isCeo(actor)) return true;
  if (actor.role === 'TEAM_LEAD') return target.role === 'MANAGER' || target.role === 'DEV';
  return false;
}

/** Explains a refusal, so the UI can say why rather than just hiding a button. */
export function whyCannotRemove(actor: User, target: User): string | null {
  if (canRemoveUser(actor, target)) return null;
  if (actor.id === target.id) return 'You cannot remove your own account.';
  if (target.role === 'CEO') return 'The CEO cannot be removed.';
  if (actor.role === 'TEAM_LEAD' && target.role === 'TEAM_LEAD') {
    return 'Only the CEO can remove another Team Lead.';
  }
  return 'You do not have permission to remove this person.';
}

export function canChooseAssigneeAtCreation(): boolean {
  return false;
}

/** Leads and above can inspect anyone's sheet; everyone else only their own. */
export function canViewTaskSheet(user: User, targetId: string): boolean {
  return isLead(user) || user.id === targetId;
}

export interface TaskAbilities {
  view: boolean;
  comment: boolean;
  assign: boolean;
  split: boolean;
  status: boolean;
  allowedStatuses: Status[];
  edit: boolean;
  priority: boolean;
  archive: boolean;
  delete: boolean;
  voiceOnTask: boolean;
  voiceOnComment: boolean;
  postProgress: boolean;
  submit: boolean;
  approve: boolean;
  requestChanges: boolean;
}

export function abilitiesFor(user: User, task: TaskFull): TaskAbilities {
  return {
    view: canView(user, task),
    comment: canComment(user, task),
    assign: canAssign(user),
    split: canSplit(user, task),
    status: canChangeStatus(user, task),
    allowedStatuses: allowedStatuses(user, task),
    edit: canEditContent(user, task),
    priority: canEditPriority(user, task),
    archive: canArchive(user, task),
    delete: canDelete(user, task),
    voiceOnTask: canAddTaskVoiceNote(user, task),
    voiceOnComment: canAddCommentVoiceNote(user, task),
    postProgress: canPostProgress(user, task),
    submit: canSubmitForReview(user, task),
    approve: canApprove(user, task),
    requestChanges: canRequestChanges(user, task),
  };
}
