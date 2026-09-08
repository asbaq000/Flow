'use client';

import { useState } from 'react';
import { Loader2, Paperclip, Plus, Split, Trash2, Wand2, X } from 'lucide-react';
import type { TaskFull, User } from '@/lib/types';
import { MAX_ATTACHMENT_BYTES } from '@/lib/types';
import { api } from '@/lib/client';
import { Avatar, Modal, UserPicker } from './ui';

interface Piece {
  key: number;
  title: string;
  assigneeId: string | null;
  /** Files that belong to this piece alone, uploaded once it exists. */
  files: File[];
}

let nextKey = 1;
const makePiece = (title = ''): Piece => ({ key: nextKey++, title, assigneeId: null, files: [] });

export default function SplitModal({
  task, me, users, canAssign, onClose, onSplit,
}: {
  task: TaskFull;
  me: User;
  users: User[];
  /** A Lead hands pieces out; a developer's pieces are all their own. */
  canAssign: boolean;
  onClose: () => void;
  onSplit: (task: TaskFull) => void;
}) {
  const [pieces, setPieces] = useState<Piece[]>([makePiece(), makePiece()]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Pieces can only go to Developers — the server enforces the same rule.
  const pool = users.filter((u) => u.role === 'DEV');
  const filled = pieces.filter((p) => p.title.trim());
  // A developer breaking up their own task keeps every piece; the server
  // reassigns them back regardless, so the picker is simply not offered.
  const stages = !canAssign;

  const update = (key: number, patch: Partial<Piece>) =>
    setPieces((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  /** Round-robin the unassigned pieces across the devs with the lightest load. */
  const distribute = () => {
    if (!pool.length) return;
    setPieces((prev) => prev.map((p, i) => ({ ...p, assigneeId: pool[i % pool.length].id })));
  };

  const submit = async () => {
    if (filled.length < 2 || busy) return;
    setBusy(true);
    setError('');
    try {
      const { task: updated } = await api.tasks.split(
        task.id,
        filled.map((p) => ({ title: p.title.trim(), assigneeId: canAssign ? p.assigneeId : me.id }))
      );

      /*
       * The pieces only become real tasks once the split lands, so their
       * files go up afterwards, matched back by title. A file that fails to
       * upload must not undo the split — the work is already assigned, and
       * the document can be added again from the task itself.
       */
      const withFiles = filled.filter((p) => p.files.length);
      if (withFiles.length) {
        setUploading(true);
        const failed: string[] = [];
        for (const piece of withFiles) {
          const created = updated.subtasks.find((s) => s.title === piece.title.trim());
          if (!created) { failed.push(piece.title.trim()); continue; }
          for (const file of piece.files) {
            try {
              await api.attachments.upload(created.id, file);
            } catch {
              failed.push(`${file.name} → ${piece.title.trim()}`);
            }
          }
        }
        setUploading(false);
        if (failed.length) {
          setError(`Split done, but these files did not upload: ${failed.join(', ')}. Add them from the task.`);
          return;
        }
      }

      onSplit(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not split the task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={600}
      title={
        <span className="flex items-center gap-2">
          <Split size={15} /> {stages ? 'Break this into stages' : 'Split task across the team'}
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-[12px] text-[var(--text-tertiary)]">
            {filled.length < 2
              ? `Add at least two ${stages ? 'stages' : 'pieces'}`
              : `${filled.length} ${stages ? 'stages' : 'pieces'} will be created`}
          </span>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={filled.length < 2 || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Split size={14} />}
            {uploading
              ? 'Uploading files…'
              : stages ? `Create ${filled.length || 0} stages` : `Split into ${filled.length || 0}`}
          </button>
        </>
      }
    >
      <div className="mb-4 rounded-md border px-3 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Parent task</div>
        <div className="mt-0.5 text-[14px] font-medium">{task.title}</div>
        <p className="mt-1.5 text-[12.5px] text-[var(--text-secondary)]">
          {stages ? (
            <>
              Each stage becomes its own task, assigned to you, that you can hand in on its own — frontend today,
              backend tomorrow, deployment after that. This task stays as the umbrella over all of them.
            </>
          ) : (
            <>
              Each piece becomes its own task assigned to one developer. The parent stays as the umbrella and tracks
              progress across all of them.
            </>
          )}
        </p>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-medium">{stages ? 'Stages' : 'Pieces'}</span>
        {canAssign && pool.length > 0 && (
          <button onClick={distribute} className="btn btn-ghost text-[12px] text-[var(--text-secondary)]">
            <Wand2 size={12} /> Distribute evenly
          </button>
        )}
      </div>

      <div className="space-y-2">
        {pieces.map((piece, i) => (
          <div key={piece.key} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-semibold text-[var(--text-tertiary)]">
              {i + 1}
            </span>
            <input
              className="input flex-1 py-1.5 text-[13.5px]"
              placeholder={`Piece ${i + 1} — e.g. "${SUGGESTIONS[i % SUGGESTIONS.length]}"`}
              value={piece.title}
              onChange={(e) => update(piece.key, { title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && i === pieces.length - 1) setPieces((prev) => [...prev, makePiece()]);
              }}
            />
            {canAssign ? (
              <div className="w-[168px] shrink-0">
                <UserPicker
                  users={pool}
                  value={piece.assigneeId}
                  onChange={(assigneeId) => update(piece.key, { assigneeId })}
                  label="Assign dev"
                />
              </div>
            ) : (
              <span className="flex w-[120px] shrink-0 items-center gap-1.5 text-[12.5px] text-[var(--text-tertiary)]">
                <Avatar user={me} size="xs" /> Yours
              </span>
            )}
            <button
              onClick={() => setPieces((prev) => (prev.length > 2 ? prev.filter((p) => p.key !== piece.key) : prev))}
              disabled={pieces.length <= 2}
              className="btn btn-ghost px-1.5 disabled:opacity-30"
              aria-label="Remove piece"
            >
              <Trash2 size={14} />
            </button>
            </div>

            {/* Files for this piece only — they land on the subtask, so the
                developer assigned it sees their own documents and no one
                else's. */}
            <div className="flex flex-wrap items-center gap-1.5 pl-8">
              {piece.files.map((f) => (
                <span
                  key={f.name + f.size}
                  className="inline-flex max-w-[220px] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                >
                  <Paperclip size={10} className="shrink-0 text-[var(--text-tertiary)]" />
                  <span className="truncate">{f.name}</span>
                  <button
                    onClick={() => update(piece.key, { files: piece.files.filter((x) => x !== f) })}
                    className="shrink-0 text-[var(--text-tertiary)] hover:text-red-500"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <label className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] text-[var(--text-tertiary)] hover:text-[var(--text)]">
                <Paperclip size={11} />
                {piece.files.length ? 'Add another file' : 'Attach a file'}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    const tooBig = picked.find((f) => f.size > MAX_ATTACHMENT_BYTES);
                    if (tooBig) {
                      setError(`"${tooBig.name}" is over the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit.`);
                      return;
                    }
                    setError('');
                    update(piece.key, { files: [...piece.files, ...picked] });
                    e.target.value = '';
                  }}
                />
              </label>
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

      {!pool.length && (
        <p className="mt-3 rounded-md border px-3 py-2 text-[12.5px] text-[var(--text-secondary)]">
          Nobody has the Developer role yet, so there is no one to split this across. An Admin can assign
          roles on the People page.
        </p>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
    </Modal>
  );
}

const SUGGESTIONS = ['Backend API', 'Frontend UI', 'Tests & QA', 'Documentation', 'Database migration'];
