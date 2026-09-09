'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, Info, Link2, Loader2, Mic, Paperclip, Plus, Split, UserRound,
  Wand2, X,
} from 'lucide-react';
import type { Block, Priority, Tag, TaskFull, User } from '@/lib/types';
import { DEFAULT_PRIORITY, MAX_ATTACHMENT_BYTES, docFromText, emptyDoc } from '@/lib/types';
import { api, serializeDoc } from '@/lib/client';
import { canChooseAssigneeAtCreation } from '@/lib/permissions';
import { Modal, PriorityPicker, TagChip, UserPicker } from './ui';
import { VoiceRecorder } from './VoiceNotes';
import { fileSize } from './Attachments';
import { appendTranscriptToDescription, autoTranscribe, useTranscriber } from '@/lib/useTranscriber';
import BlockEditor from './BlockEditor';
import { fromDateInput } from './views/shared';

/** One piece of a split, written while the task is still being created. */
interface Piece {
  key: number;
  title: string;
  description: string;
  assigneeId: string | null;
}

let nextKey = 1;
const makePiece = (): Piece => ({ key: nextKey++, title: '', description: '', assigneeId: null });

const STEPS = ['The task', 'Priority & timing', 'Who does it'] as const;

/**
 * Raising a task, one question at a time.
 *
 * Everything used to arrive at once — title, brief, priority, dates, tags,
 * files, recordings, assignment — and the form read as a wall. It is three
 * steps now, in the order somebody actually thinks: what needs doing, how
 * urgent it is, and who picks it up. Nothing was dropped; it is only ever
 * asking one thing at a time.
 */
export default function NewTaskModal({
  open, me, users, tags, onClose, onCreated,
}: {
  open: boolean;
  me: User;
  users: User[];
  tags: Tag[];
  onClose: () => void;
  onCreated: (
    task: TaskFull,
    routedTo: { id: string; name: string } | null,
    assignedDirectly: boolean,
  ) => void;
}) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<Block[]>(emptyDoc());
  const [priority, setPriority] = useState<Priority>(DEFAULT_PRIORITY);
  const [due, setDue] = useState('');
  // Recorded before the task exists, so they are uploaded right after creation.
  const [pending, setPending] = useState<{ blob: Blob; durationMs: number; url: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<{ url: string; label: string }[]>([]);
  const [showLinks, setShowLinks] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [handover, setHandover] = useState<'one' | 'split'>('one');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([makePiece(), makePiece()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { transcribe } = useTranscriber();

  // A Lead can name the developer here; for everyone else routing is not a choice.
  const canAssign = canChooseAssigneeAtCreation(me);
  const devs = users.filter((u) => u.role === 'DEV');
  const routingLead =
    users.find((u) => u.role === 'TEAM_LEAD' && u.id !== me.id) ??
    users.find((u) => u.role === 'TEAM_LEAD') ??
    null;
  const filledPieces = pieces.filter((p) => p.title.trim());
  const splitting = canAssign && handover === 'split';

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setTitle('');
    setDoc(emptyDoc());
    setPriority(DEFAULT_PRIORITY);
    setDue('');
    setPending((prev) => {
      prev.forEach((r) => URL.revokeObjectURL(r.url));
      return [];
    });
    setLinks([]);
    setFiles([]);
    setShowLinks(false);
    setTagIds([]);
    setHandover('one');
    setAssigneeId(null);
    setPieces([makePiece(), makePiece()]);
    setError('');
  }, [open]);

  const updatePiece = (key: number, patch: Partial<Piece>) =>
    setPieces((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  /** Round-robin the pieces across the developers. */
  const distribute = () => {
    if (!devs.length) return;
    setPieces((prev) => prev.map((p, i) => ({ ...p, assigneeId: devs[i % devs.length].id })));
  };

  const canLeaveStep = step !== 0 || title.trim().length > 0;
  const canSubmit = title.trim().length > 0 && !busy && (!splitting || filledPieces.length >= 2);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const { task, routedTo, assignedDirectly = false } = await api.tasks.create({
        title: title.trim(),
        description: serializeDoc(doc),
        priority,
        assigneeId: canAssign && !splitting ? assigneeId : undefined,
        dueDate: fromDateInput(due),
        links: links.filter((l) => l.url.trim()),
        tagIds,
      });

      // Voice notes need a task id, so they follow immediately after creation.
      // The modal closes before transcription finishes, so the finished text
      // is written straight to the saved task rather than into this form.
      for (const rec of pending) {
        const { voiceNote } = await api.voice.upload(task.id, rec.blob, rec.durationMs);
        void autoTranscribe(voiceNote.id, rec.blob, transcribe, (text) =>
          appendTranscriptToDescription(task.id, text)
        );
      }

      /*
       * Files need a task id too, so they go up after creation. A file that
       * fails must not lose the task somebody just wrote — they are told
       * which one to re-add from the task itself.
       */
      const failed: string[] = [];
      for (const file of files) {
        try {
          await api.attachments.upload(task.id, file);
        } catch {
          failed.push(file.name);
        }
      }

      // The split happens against the task that now exists, so the pieces
      // land with their own briefs and their own people in one go.
      let finalTask = task;
      if (splitting) {
        try {
          const { task: afterSplit } = await api.tasks.split(
            task.id,
            filledPieces.map((p) => ({
              title: p.title.trim(),
              description: docFromText(p.description),
              assigneeId: p.assigneeId,
            }))
          );
          finalTask = afterSplit;
        } catch (err) {
          setError(
            `The task was created, but the split did not go through: ${
              err instanceof Error ? err.message : 'unknown error'
            }. Split it from the task itself.`
          );
          onCreated(task, routedTo, assignedDirectly);
          return;
        }
      }

      if (failed.length) {
        setError(`Task created, but these files did not upload: ${failed.join(', ')}.`);
        onCreated(finalTask, routedTo, assignedDirectly);
        return;
      }

      onCreated(finalTask, routedTo, assignedDirectly);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create task');
    } finally {
      setBusy(false);
    }
  };

  const last = step === STEPS.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      title={
        <span className="flex items-center gap-2.5">
          New task
          <span className="text-[12px] font-normal text-[var(--text-tertiary)]">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </span>
        </span>
      }
      footer={
        <>
          {step > 0 && (
            <button onClick={() => setStep((s) => s - 1)} className="btn btn-ghost mr-auto">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          {step === 0 && (
            <span className="mr-auto text-[11.5px] text-[var(--text-tertiary)]">
              <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">Enter</kbd> to move on
            </span>
          )}
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          {last ? (
            <button onClick={submit} className="btn btn-primary" disabled={!canSubmit}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {splitting ? `Create and split into ${filledPieces.length}` : 'Create task'}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="btn btn-primary"
              disabled={!canLeaveStep}
              title={canLeaveStep ? undefined : 'Give the task a title first'}
            >
              Next <ArrowRight size={14} />
            </button>
          )}
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (last) submit();
            else if (canLeaveStep) setStep((s) => s + 1);
          }
        }}
      >
        {/* where it lands — the rule made visible, or the choice offered */}
        <Stepper step={step} onStep={(s) => (s < step || canLeaveStep) && setStep(s)} />

        {step === 0 && (
          <>
            <label className="mb-1.5 block text-[12.5px] font-medium">Task</label>
            <input
              autoFocus
              className="input mb-4 text-[16px] font-medium"
              placeholder="What needs to happen?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label className="mb-1.5 block text-[12.5px] font-medium">Description</label>
            <div
              className="scroll-thin mb-4 max-h-[220px] min-h-[110px] overflow-y-auto rounded-md border px-2.5 py-2"
              style={{ background: 'var(--bg-input)' }}
            >
              <BlockEditor
                value={doc}
                onChange={setDoc}
                placeholder="Describe it in detail. Type '/' for headings, checklists, code…"
              />
            </div>

            {/* voice notes */}
            <div className="mb-4">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
                <Mic size={13} /> Voice note
                <span className="font-normal text-[var(--text-tertiary)]">
                  optional — say it out loud when typing is slower
                </span>
              </span>
              <div className="flex flex-col gap-2">
                {pending.map((rec, i) => (
                  <div key={rec.url} className="flex items-center gap-2">
                    <audio src={rec.url} controls className="h-8 flex-1" />
                    <button
                      onClick={() =>
                        setPending((prev) => {
                          URL.revokeObjectURL(rec.url);
                          return prev.filter((_, j) => j !== i);
                        })
                      }
                      className="btn btn-ghost px-1.5"
                      aria-label="Remove recording"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <VoiceRecorder
                  label={pending.length ? 'Record another' : 'Record a voice note'}
                  onRecorded={(blob, durationMs) =>
                    setPending((prev) => [...prev, { blob, durationMs, url: URL.createObjectURL(blob) }])
                  }
                />
              </div>
            </div>

            {/* files */}
            <div className="mb-4">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
                <Paperclip size={13} /> Files
                <span className="font-normal text-[var(--text-tertiary)]">
                  optional — the spec, a screenshot, the export that came out wrong
                </span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {files.map((f) => (
                  <span
                    key={f.name + f.size + f.lastModified}
                    className="inline-flex max-w-[240px] items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px]"
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-[var(--text-tertiary)]">{fileSize(f.size)}</span>
                    <button
                      onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                      className="shrink-0 text-[var(--text-tertiary)] hover:text-red-500"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                  <Paperclip size={12} />
                  {files.length ? 'Add another' : 'Attach a file'}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      const tooBig = picked.find((f) => f.size > MAX_ATTACHMENT_BYTES);
                      if (tooBig) {
                        setError(`"${tooBig.name}" is ${fileSize(tooBig.size)} — the limit is ${fileSize(MAX_ATTACHMENT_BYTES)}.`);
                        return;
                      }
                      setError('');
                      setFiles((prev) => [...prev, ...picked]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>

            {/* links */}
            {showLinks || links.length > 0 ? (
              <div>
                <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
                  <Link2 size={13} /> Links
                  <span className="font-normal text-[var(--text-tertiary)]">optional</span>
                </span>
                <div className="space-y-1.5">
                  {links.map((link, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        className="input flex-1 py-1.5 text-[13px]"
                        placeholder="https://…"
                        value={link.url}
                        onChange={(e) =>
                          setLinks((prev) => prev.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))
                        }
                      />
                      <input
                        className="input py-1.5 text-[13px]"
                        style={{ width: 150 }}
                        placeholder="Label"
                        value={link.label}
                        onChange={(e) =>
                          setLinks((prev) => prev.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))
                        }
                      />
                      <button
                        onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                        className="btn btn-ghost px-1.5"
                        aria-label="Remove link"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setLinks((prev) => [...prev, { url: '', label: '' }])}
                    className="btn btn-ghost text-[12.5px] text-[var(--text-secondary)]"
                  >
                    <Plus size={13} /> Add another link
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setShowLinks(true);
                  setLinks([{ url: '', label: '' }]);
                }}
                className="btn btn-ghost text-[12.5px] text-[var(--text-secondary)]"
              >
                <Link2 size={13} /> Add a link
              </button>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <label className="mb-2 block text-[12.5px] font-medium">How urgent is it?</label>
            <div className="mb-5">
              <PriorityPicker value={priority} onChange={setPriority} />
              <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">
                This is the colour the card carries on the board, so it is worth being honest about.
              </p>
            </div>

            <label className="mb-1.5 block text-[12.5px] font-medium">Due date</label>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="input mb-5 w-[200px] text-[13px]"
            />

            {tags.length > 0 && (
              <div>
                <span className="mb-1.5 block text-[12.5px] font-medium">
                  Tags <span className="font-normal text-[var(--text-tertiary)]">optional</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const on = tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => setTagIds((prev) => (on ? prev.filter((x) => x !== tag.id) : [...prev, tag.id]))}
                        style={{ opacity: on ? 1 : 0.45 }}
                      >
                        <TagChip tag={tag} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            {!canAssign ? (
              <div
                className="flex items-start gap-2 rounded-md border px-3 py-2.5 text-[12.5px]"
                style={{ background: 'var(--bg-subtle)' }}
              >
                <Info size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <p className="text-[var(--text-secondary)]">
                  {routingLead ? (
                    <>
                      This goes to <strong className="text-[var(--text)]">{routingLead.name}</strong>, who decides who
                      picks it up. Only a Team Lead assigns work onward, and only to a developer.
                    </>
                  ) : (
                    <>No Team Lead exists yet, so this routes to the CEO to hand out.</>
                  )}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <Choice
                    on={handover === 'one'}
                    icon={<UserRound size={15} />}
                    title="One developer"
                    blurb="One person owns it end to end."
                    onClick={() => setHandover('one')}
                  />
                  <Choice
                    on={handover === 'split'}
                    icon={<Split size={15} />}
                    title="Split across the team"
                    blurb="Each piece its own brief and its own person."
                    onClick={() => setHandover('split')}
                  />
                </div>

                {handover === 'one' ? (
                  <div>
                    <span className="mb-1.5 block text-[12.5px] font-medium">Assign to</span>
                    <UserPicker
                      users={devs}
                      value={assigneeId}
                      onChange={setAssigneeId}
                      label="Assign to a developer"
                    />
                    <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">
                      {assigneeId
                        ? 'It starts on their desk in To Do, and they are told.'
                        : 'Leave this empty and it waits on your desk until you hand it out.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[12.5px] font-medium">Pieces</span>
                      {devs.length > 0 && (
                        <button onClick={distribute} className="btn btn-ghost text-[12px] text-[var(--text-secondary)]">
                          <Wand2 size={12} /> Distribute evenly
                        </button>
                      )}
                    </div>

                    <div className="space-y-2.5">
                      {pieces.map((piece, i) => (
                        <div key={piece.key} className="rounded-md border p-2.5" style={{ background: 'var(--bg-subtle)' }}>
                          <div className="flex items-center gap-2">
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-semibold text-[var(--text-tertiary)]">
                              {i + 1}
                            </span>
                            <input
                              className="input flex-1 py-1.5 text-[13.5px]"
                              placeholder={`Piece ${i + 1} — e.g. "${SUGGESTIONS[i % SUGGESTIONS.length]}"`}
                              value={piece.title}
                              onChange={(e) => updatePiece(piece.key, { title: e.target.value })}
                            />
                            <div className="w-[160px] shrink-0">
                              <UserPicker
                                users={devs}
                                value={piece.assigneeId}
                                onChange={(id) => updatePiece(piece.key, { assigneeId: id })}
                                label="Assign dev"
                              />
                            </div>
                            <button
                              onClick={() =>
                                setPieces((prev) => (prev.length > 2 ? prev.filter((p) => p.key !== piece.key) : prev))
                              }
                              disabled={pieces.length <= 2}
                              className="btn btn-ghost px-1.5 disabled:opacity-30"
                              aria-label="Remove piece"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <div className="mt-1.5 pl-8">
                            <textarea
                              className="input w-full resize-y py-1.5 text-[12.5px]"
                              rows={2}
                              placeholder="What this person is being asked for (optional)"
                              value={piece.description}
                              onChange={(e) => updatePiece(piece.key, { description: e.target.value })}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => setPieces((prev) => [...prev, makePiece()])}
                      className="btn btn-ghost mt-2 text-[12.5px] text-[var(--text-secondary)]"
                    >
                      <Plus size={13} /> Add another piece
                    </button>

                    {!devs.length && (
                      <p className="mt-3 rounded-md border px-3 py-2 text-[12.5px] text-[var(--text-secondary)]">
                        Nobody has the Developer role yet, so there is no one to split this across.
                      </p>
                    )}
                    {filledPieces.length < 2 && (
                      <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
                        A split needs at least two pieces with a title.
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {/* what they are about to create, in one line */}
            <div className="mt-5 border-t pt-3 text-[12.5px] text-[var(--text-secondary)]">
              <Check size={13} className="mr-1.5 inline text-[var(--accent)]" />
              <strong className="text-[var(--text)]">{title.trim() || 'Untitled'}</strong>
              {' · '}{priority.toLowerCase()}
              {due ? ` · due ${due}` : ''}
              {files.length ? ` · ${files.length} file${files.length > 1 ? 's' : ''}` : ''}
              {pending.length ? ` · ${pending.length} recording${pending.length > 1 ? 's' : ''}` : ''}
            </div>
          </>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Three dots and a rule — where you are, and what is still to come. */
function Stepper({ step, onStep }: { step: number; onStep: (s: number) => void }) {
  return (
    <div className="mb-5 flex items-center gap-1.5">
      {STEPS.map((label, i) => {
        const done = i < step;
        const on = i === step;
        return (
          <button
            key={label}
            onClick={() => onStep(i)}
            className="flex flex-1 items-center gap-2 text-left"
            aria-current={on ? 'step' : undefined}
          >
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold transition-colors"
              style={{
                background: on || done ? 'var(--accent)' : 'var(--bg-active)',
                color: on || done ? 'var(--on-accent)' : 'var(--text-tertiary)',
              }}
            >
              {done ? <Check size={11} strokeWidth={3} /> : i + 1}
            </span>
            <span
              className="hidden truncate text-[12px] sm:block"
              style={{ color: on ? 'var(--text)' : 'var(--text-tertiary)', fontWeight: on ? 600 : 400 }}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="h-px flex-1" style={{ background: done ? 'var(--accent)' : 'var(--border)' }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function Choice({
  on, icon, title, blurb, onClick,
}: {
  on: boolean;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border p-3 text-left transition-colors"
      style={{
        borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
        background: on ? 'var(--accent-soft)' : 'transparent',
      }}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: on ? 'var(--accent)' : undefined }}>
        {icon} {title}
      </span>
      <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-secondary)]">{blurb}</span>
    </button>
  );
}

const SUGGESTIONS = ['Backend API', 'Frontend UI', 'Tests & QA', 'Documentation', 'Database migration'];
