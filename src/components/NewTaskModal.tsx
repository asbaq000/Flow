'use client';

import { useEffect, useState } from 'react';
import { Info, Link2, Loader2, Mic, Plus, X } from 'lucide-react';
import type { Block, Priority, Tag, TaskFull, User } from '@/lib/types';
import { emptyDoc } from '@/lib/types';
import { api, serializeDoc } from '@/lib/client';
import { Modal, PriorityPicker, TagChip } from './ui';
import { VoiceRecorder } from './VoiceNotes';
import { autoTranscribe, useTranscriber } from '@/lib/useTranscriber';
import BlockEditor from './BlockEditor';
import { fromDateInput } from './views/shared';

export default function NewTaskModal({
  open, me, users, tags, onClose, onCreated,
}: {
  open: boolean;
  me: User;
  users: User[];
  tags: Tag[];
  onClose: () => void;
  onCreated: (task: TaskFull, routedTo: { id: string; name: string } | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<Block[]>(emptyDoc());
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [due, setDue] = useState('');
  // Recorded before the task exists, so they are uploaded right after creation.
  const [pending, setPending] = useState<{ blob: Blob; durationMs: number; url: string }[]>([]);
  const [links, setLinks] = useState<{ url: string; label: string }[]>([]);
  const [showLinks, setShowLinks] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { transcribe } = useTranscriber();

  // Routing is not a choice: it always goes to a Team Lead for triage.
  const routingLead =
    users.find((u) => u.role === 'TEAM_LEAD' && u.id !== me.id) ??
    users.find((u) => u.role === 'TEAM_LEAD') ??
    null;

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDoc(emptyDoc());
    setPriority('MEDIUM');
    setDue('');
    setPending((prev) => {
      prev.forEach((r) => URL.revokeObjectURL(r.url));
      return [];
    });
    setLinks([]);
    setShowLinks(false);
    setTagIds([]);
    setError('');
  }, [open]);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const { task, routedTo } = await api.tasks.create({
        title: title.trim(),
        description: serializeDoc(doc),
        priority,
        dueDate: fromDateInput(due),
        links: links.filter((l) => l.url.trim()),
        tagIds,
      });

      // Voice notes need a task id, so they follow immediately after creation.
      for (const rec of pending) {
        const { voiceNote } = await api.voice.upload(task.id, rec.blob, rec.durationMs);
        void autoTranscribe(voiceNote.id, rec.blob, transcribe);
      }

      onCreated(task, routedTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={620}
      title="New task"
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-[var(--text-tertiary)]">
            <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">Enter</kbd> to create
          </span>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={submit} className="btn btn-primary" disabled={!title.trim() || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create task
          </button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        {/* routing notice — the rule made visible */}
        <div
          className="mb-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[12.5px]"
          style={{ background: 'var(--bg-subtle)' }}
        >
          <Info size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <p className="text-[var(--text-secondary)]">
            {routingLead ? (
              <>
                This goes to <strong className="text-[var(--text)]">{routingLead.name}</strong> for triage. Only a Team
                Lead assigns work onward, and only to a developer.
              </>
            ) : (
              <>No Team Lead exists yet, so this routes to the workspace Admin for triage.</>
            )}
          </p>
        </div>

        {/* title */}
        <label className="mb-1.5 block text-[12.5px] font-medium">Task</label>
        <input
          autoFocus
          className="input mb-4 text-[16px] font-medium"
          placeholder="What needs to happen?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* description */}
        <label className="mb-1.5 block text-[12.5px] font-medium">Description</label>
        <div
          className="scroll-thin mb-4 max-h-[240px] min-h-[110px] overflow-y-auto rounded-md border px-2.5 py-2"
          style={{ background: 'var(--bg-input)' }}
        >
          <BlockEditor
            value={doc}
            onChange={setDoc}
            placeholder="Describe it in detail. Type '/' for headings, checklists, code…"
          />
        </div>

        {/* properties */}
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <Field label="Priority">
            <PriorityPicker value={priority} onChange={setPriority} />
          </Field>

          <Field label="Due date">
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="rounded border px-2 py-1 text-[13px] outline-none"
              style={{ background: 'var(--bg-input)' }}
            />
          </Field>
        </div>

        {/* tags */}
        {tags.length > 0 && (
          <div className="mb-4">
            <span className="mb-1.5 block text-[12.5px] font-medium">Tags</span>
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

        {/* voice notes */}
        <div className="mb-4">
          <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
            <Mic size={13} /> Voice notes
            <span className="font-normal text-[var(--text-tertiary)]">optional</span>
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

        {/* optional links */}
        {showLinks || links.length > 0 ? (
          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
              <Link2 size={13} /> Links from the client
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
            <Link2 size={13} /> Add links from the client
          </button>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[12.5px] font-medium">{label}</span>
      {children}
    </div>
  );
}
