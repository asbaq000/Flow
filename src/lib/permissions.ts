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

/**
 * Leads and above see the whole board; everyone else sees only what touches
 * them. Both stop at the organisation's edge — this is the one check every
 * task route goes through, so it is where the tenancy wall is enforced.
 */
export function canView(user: User, task: TaskFull): boolean {
  if (task.org_id !== user.org_id) return false;
  return isLead(user) || isParticipant(user, task);
}

export function canComment(user: User, task: TaskFull): boolean {
  return canView(user, task);
}

/**
 * Handing work to a Developer is the Team Lead's job and nobody else's.
 *
 * Not the CEO's and not a Manager's: a Manager raises work, the CEO oversees
 * it, and both routing around the Lead would leave the person accountable for
 * a developer's workload unable to see what landed on them.
 */
export function canAssign(user: User): boolean {
  return user.role === 'TEAM_LEAD';
}

/** Work only ever flows down to a Developer. */
export function isAssignableRole(role: Role): boolean {
  return role === 'DEV';
}

/**
 * Splitting is two different acts wearing one name.
 *
 * A Lead splits work *across* people. A Developer splits their own task *for
 * themselves* — frontend today, backend tomorrow, deployment after that — so
 * each piece can be handed in on its own instead of one lump at the end.
 * Either way a piece is not split again: one level is a plan, two is a maze.
 */
export function canSplit(user: User, task: TaskFull): boolean {
  if (task.parent_id) return false;
  // Splitting across people is assigning, so it follows canAssign exactly.
  return canAssign(user) || (isDev(user) && isAssignedTo(user, task));
}

/** A Developer's split is only ever their own workload, never a handout to someone else. */
export function canAssignPieces(user: User): boolean {
  return canAssign(user);
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

/**
 * Handing work in belongs to whoever did it. A Lead does not submit — they are
 * the other end of that exchange, and can close a task outright anyway.
 */
export function canSubmitForReview(user: User, task: TaskFull): boolean {
  if (task.status === 'SUBMITTED' || task.status === 'DONE') return false;
  return isDev(user) && isAssignedTo(user, task);
}

export function isAssignedTo(user: User, task: TaskFull): boolean {
  return task.assignee_id === user.id || task.collaborators.some((c) => c.id === user.id);
}

/**
 * Reporting progress is the Developer's account of their own work. A Lead has
 * nothing to report — they read these, they do not write them.
 */
export function canPostProgress(user: User, task: TaskFull): boolean {
  return isDev(user) && isAssignedTo(user, task);
}

/**
 * Which statuses may this user move the task into?
 *
 * A Developer drives their own work up to SUBMITTED and no further — marking
 * something DONE is a review decision, not a self-declaration.
 */
export function allowedStatuses(user: User, task: TaskFull): Status[] {
  if (isLead(user)) {
    return ['TODO', 'IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED', 'DONE'];
  }
  if (isDev(user) && isAssignedTo(user, task)) {
    return ['TODO', 'IN_PROGRESS', 'SUBMITTED'];
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

/**
 * Anyone on the task can attach a file. Unlike the brief, which is the
 * requester's statement of what they want, a document is usually evidence —
 * a screenshot of the bug, the spec, the export that came out wrong — and
 * the developer working on it is exactly who tends to have it.
 */
export function canAddAttachment(user: User, task: TaskFull): boolean {
  return canView(user, task);
}

/** Whoever put it there can take it away, as can a Lead. */
export function canRemoveAttachment(
  user: User,
  attachment: { uploader_id: string | null }
): boolean {
  return isLead(user) || attachment.uploader_id === user.id;
}

export function canArchive(user: User, task: TaskFull): boolean {
  return isLead(user) || (task.creator_id === user.id && task.status === 'TODO');
}

/**
 * Deleting is permanent and takes the comments, recordings and history with
 * it, so it stays with the people who run the board — a Team Lead or the CEO.
 * Anyone else may still delete something they raised themselves, but only
 * while it is untouched in triage.
 */
export function canDelete(user: User, task: TaskFull): boolean {
  return isLead(user) || (task.creator_id === user.id && task.status === 'TODO');
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

/**
 * A Manager raising work does not get to choose who does it — that is the
 * routing rule, and it is the whole point of triage. A Team Lead already holds
 * that authority, so making them raise a task and then assign it in a second
 * step was ceremony: they can name the Developer as they write it.
 */
export function canChooseAssigneeAtCreation(user: User): boolean {
  return canAssign(user);
}

/**
 * Who may read whose record of work.
 *
 * The CEO has no sheet at all — they do not carry tasks, so there is nothing
 * to count. A Manager's sheet is the CEO's business and their own, not
 * something a Lead or a Developer can open. Below that it is the ordinary
 * shape: a Lead reads their developers, and everybody reads themselves.
 */
export function canViewTaskSheet(user: User, target: Pick<User, 'id' | 'role'>): boolean {
  if (target.role === 'CEO') return false;
  if (isCeo(user)) return true;
  if (target.id === user.id) return true;
  if (target.role === 'MANAGER') return false;
  return user.role === 'TEAM_LEAD' && target.role === 'DEV';
}

/** True when this person has a sheet of their own to look at. */
export function hasOwnTaskSheet(user: User): boolean {
  return user.role !== 'CEO';
}

export interface TaskAbilities {
  view: boolean;
  comment: boolean;
  assign: boolean;
  split: boolean;
  /** Whether this person's split can hand pieces to other people. */
  assignPieces: boolean;
  status: boolean;
  allowedStatuses: Status[];
  edit: boolean;
  priority: boolean;
  archive: boolean;
  delete: boolean;
  attach: boolean;
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
    assignPieces: canAssignPieces(user),
    status: canChangeStatus(user, task),
    allowedStatuses: allowedStatuses(user, task),
    edit: canEditContent(user, task),
    priority: canEditPriority(user, task),
    archive: canArchive(user, task),
    delete: canDelete(user, task),
    attach: canAddAttachment(user, task),
    voiceOnTask: canAddTaskVoiceNote(user, task),
    voiceOnComment: canAddCommentVoiceNote(user, task),
    postProgress: canPostProgress(user, task),
    submit: canSubmitForReview(user, task),
    approve: canApprove(user, task),
    requestChanges: canRequestChanges(user, task),
  };
}
