'use client';

import { useRef, useState } from 'react';
import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import type { Attachment, User } from '@/lib/types';
import { MAX_ATTACHMENT_BYTES } from '@/lib/types';
import { api } from '@/lib/client';
import { canRemoveAttachment } from '@/lib/permissions';
import { timeAgo } from './views/shared';

/** Bytes as something a person reads, not a number they decode. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Attachments({
  taskId, files, me, canAdd, onChanged,
}: {
  taskId: string;
  files: Attachment[];
  me: User;
  canAdd: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (list: FileList | null) => {
    if (!list?.length || busy) return;
    setBusy(true);
    setError('');
    try {
      // One at a time: the cap is per file, and a failure part-way should
      // leave the ones that already worked in place.
      for (const file of Array.from(list)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(
            `"${file.name}" is ${fileSize(file.size)} — files have to stay under ` +
            `${fileSize(MAX_ATTACHMENT_BYTES)}.`
          );
        }
        await api.attachments.upload(taskId, file);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That upload did not work');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (file: Attachment) => {
    if (busy || !confirm(`Remove "${file.filename}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.attachments.remove(file.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {files.length > 0 && (
        <ul className="mb-2 space-y-1">
          {files.map((f) => (
            <li
              key={f.id}
              className="group flex items-center gap-2 rounded-md border px-2.5 py-1.5"
              style={{ background: 'var(--bg-subtle)' }}
            >
              <FileText size={13} className="shrink-0 text-[var(--text-tertiary)]" />
              <a
                href={api.attachments.downloadUrl(f.id)}
                download={f.filename}
                className="min-w-0 flex-1 truncate text-[13px] hover:underline"
                title={f.filename}
              >
                {f.filename}
              </a>
              <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
                {fileSize(f.byte_size)}
                {f.uploader ? ` · ${f.uploader.name}` : ''} · {timeAgo(f.created_at)}
              </span>
              <a
                href={api.attachments.downloadUrl(f.id)}
                download={f.filename}
                className="shrink-0 rounded p-1 text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100"
                title="Download"
              >
                <Download size={12} />
              </a>
              {canRemoveAttachment(me, f) && (
                <button
                  onClick={() => remove(f)}
                  disabled={busy}
                  className="shrink-0 rounded p-1 text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            upload(e.dataTransfer.files);
          }}
          className="rounded-md border border-dashed px-3 py-2.5 text-center transition-colors"
          style={{ borderColor: dragging ? 'var(--accent)' : undefined,
                   background: dragging ? 'var(--accent-soft)' : undefined }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text)]"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {busy ? 'Uploading…' : 'Add a file'}
          </button>
          <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            or drop one here · up to {fileSize(MAX_ATTACHMENT_BYTES)} each
          </p>
        </div>
      )}

      {!canAdd && files.length === 0 && (
        <p className="flex items-center gap-1.5 text-[13px] text-[var(--text-tertiary)]">
          <Paperclip size={12} /> No files attached.
        </p>
      )}

      {error && <p className="mt-1.5 text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
