'use client';

import { useState } from 'react';
import { GripVertical, Loader2, Plus, Split, Trash2, Wand2 } from 'lucide-react';
import type { TaskFull, User } from '@/lib/types';
import { api } from '@/lib/client';
import { Avatar, Modal, UserPicker } from './ui';

interface Piece {
  key: number;
  title: string;
  assigneeId: string | null;
}

let nextKey = 1;
const makePiece = (title = ''): Piece => ({ key: nextKey++, title, assigneeId: null });

export default function SplitModal({
  task, users, onClose, onSplit,
}: {
  task: TaskFull;
  users: User[];
  onClose: () => void;
  onSplit: (task: TaskFull) => void;
}) {
  const [pieces, setPieces] = useState<Piece[]>([makePiece(), makePiece()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pieces can only go to Developers — the server enforces the same rule.
  const pool = users.filter((u) => u.role === 'DEV');
  const filled = pieces.filter((p) => p.title.trim());

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
        filled.map((p) => ({ title: p.title.trim(), assigneeId: p.assigneeId }))
      );
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
          <Split size={15} /> Split task across the team
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-[12px] text-[var(--text-tertiary)]">
            {filled.length < 2 ? 'Add at least two pieces' : `${filled.length} pieces will be created`}
          </span>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={filled.length < 2 || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Split size={14} />}
            Split into {filled.length || 0}
          </button>
        </>
      }
    >
      <div className="mb-4 rounded-md border px-3 py-2.5" style={{ background: 'var(--bg-subtle)' }}>
        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Parent task</div>
        <div className="mt-0.5 text-[14px] font-medium">{task.title}</div>
        <p className="mt-1.5 text-[12.5px] text-[var(--text-secondary)]">
          Each piece becomes its own task assigned to one developer. The parent stays as the umbrella and tracks
          progress across all of them.
        </p>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-medium">Pieces</span>
        {pool.length > 0 && (
          <button onClick={distribute} className="btn btn-ghost text-[12px] text-[var(--text-secondary)]">
            <Wand2 size={12} /> Distribute evenly
          </button>
        )}
      </div>

      <div className="space-y-2">
        {pieces.map((piece, i) => (
          <div key={piece.key} className="flex items-center gap-2">
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
            <div className="w-[168px] shrink-0">
              <UserPicker
                users={pool}
                value={piece.assigneeId}
                onChange={(assigneeId) => update(piece.key, { assigneeId })}
                label="Assign dev"
              />
            </div>
            <button
              onClick={() => setPieces((prev) => (prev.length > 2 ? prev.filter((p) => p.key !== piece.key) : prev))}
              disabled={pieces.length <= 2}
              className="btn btn-ghost px-1.5 disabled:opacity-30"
              aria-label="Remove piece"
            >
              <Trash2 size={14} />
            </button>
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
