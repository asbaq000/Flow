'use client';

import { useEffect, useState } from 'react';
import { Check, ClipboardList, Loader2, ShieldCheck, UserMinus } from 'lucide-react';
import type { Role, User } from '@/lib/types';
import { ROLES } from '@/lib/types';
import { api } from '@/lib/client';
import { canManageUsers, canRemoveUser, canViewTaskSheet } from '@/lib/permissions';
import { Avatar, Modal, Popover, roleShort } from '../ui';

type Person = User & { open_tasks: number };

export default function PeopleView({
  me,
  onChanged,
  onOpenSheet,
}: {
  me: User;
  onChanged: () => void;
  onOpenSheet: (userId: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { users } = await api.users.list();
      setPeople(users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load people');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      const { removed } = await api.users.remove(removing.id);
      setRemoving(null);
      setConfirmText('');
      setNotice(
        removed.reassigned > 0
          ? `${removed.name} was removed. ${removed.reassigned} open ${removed.reassigned === 1 ? 'task was' : 'tasks were'} sent back to triage.`
          : `${removed.name} was removed from the workspace.`
      );
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that account');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (id: string, role: Role) => {
    setSaving(id);
    setError('');
    try {
      await api.users.update(id, { role });
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update role');
    } finally {
      setSaving(null);
    }
  };

  if (!people) {
    return (
      <div className="grid h-full place-items-center text-[var(--text-tertiary)]">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const byRole = ROLES.map((r) => ({ ...r, members: people.filter((p) => p.role === r.id) })).filter(
    (g) => g.members.length > 0
  );

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h2 className="text-[20px] font-bold tracking-tight">People</h2>
        <p className="mt-1 text-[13.5px] text-[var(--text-secondary)]">
          {canManageUsers(me)
            ? 'You are the CEO — you can move anyone up or down the chain.'
            : 'Everyone in this workspace and where they sit in the chain.'}
          {' '}Open a task sheet to see exactly what someone has shipped.
        </p>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {notice && (
          <div
            className="mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]"
            style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
          >
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice('')} className="text-[var(--text-tertiary)] hover:text-[var(--text)]">
              Dismiss
            </button>
          </div>
        )}

        {byRole.map((group) => (
          <section key={group.id} className="mt-6">
            <header className="mb-2 flex items-baseline gap-2">
              <h3 className="text-[13px] font-semibold">{group.label}</h3>
              <span className="text-[11.5px] text-[var(--text-tertiary)]">{group.members.length}</span>
            </header>
            <p className="mb-2 text-[12.5px] text-[var(--text-secondary)]">{group.blurb}</p>

            <div className="overflow-hidden rounded-md border">
              {group.members.map((person, i) => (
                <div
                  key={person.id}
                  className={`flex items-center gap-3 px-3 py-2.5 ${i === group.members.length - 1 ? '' : 'border-b'}`}
                >
                  <Avatar user={person} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13.5px] font-medium">{person.name}</span>
                      {person.id === me.id && (
                        <span className="rounded bg-[var(--accent-soft)] px-1 text-[10px] font-semibold text-[var(--accent)]">
                          You
                        </span>
                      )}
                      {person.role === 'CEO' && <ShieldCheck size={13} className="text-[var(--text-tertiary)]" />}
                    </div>
                    <div className="truncate text-[12px] text-[var(--text-secondary)]">{person.email}</div>
                  </div>

                  <div className="text-right">
                    <div className="text-[13px] font-semibold">{person.open_tasks}</div>
                    <div className="text-[10.5px] text-[var(--text-tertiary)]">open</div>
                  </div>

                  {canViewTaskSheet(me, person) && (
                    <button
                      onClick={() => onOpenSheet(person.id)}
                      className="btn btn-outline py-1 text-[12.5px]"
                      title={`Open ${person.name}'s task sheet`}
                    >
                      <ClipboardList size={13} />
                      <span className="hidden sm:inline">Task sheet</span>
                    </button>
                  )}

                  {canRemoveUser(me, person) && (
                    <button
                      onClick={() => {
                        setRemoving(person);
                        setConfirmText('');
                        setError('');
                      }}
                      className="btn btn-outline btn-danger py-1 text-[12.5px]"
                      title={`Remove ${person.name} from the workspace`}
                    >
                      <UserMinus size={13} />
                      <span className="hidden sm:inline">Remove</span>
                    </button>
                  )}

                  {canManageUsers(me) ? (
                    <Popover
                      width={200}
                      align="end"
                      trigger={({ toggle }) => (
                        <button onClick={toggle} className="btn btn-outline py-1 text-[12.5px]" disabled={saving === person.id}>
                          {saving === person.id ? <Loader2 size={12} className="animate-spin" /> : roleShort(person.role)}
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                            Change role
                          </div>
                          {ROLES.map((r) => (
                            <button
                              key={r.id}
                              className="menu-item"
                              onClick={() => {
                                changeRole(person.id, r.id);
                                close();
                              }}
                            >
                              <span className="flex-1">{r.label}</span>
                              {person.role === r.id && <Check size={13} />}
                            </button>
                          ))}
                        </>
                      )}
                    </Popover>
                  ) : (
                    <span className="rounded border px-2 py-1 text-[12px] text-[var(--text-secondary)]">
                      {roleShort(person.role)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Modal
        open={!!removing}
        onClose={() => {
          setRemoving(null);
          setConfirmText('');
        }}
        width={520}
        title={
          <span className="flex items-center gap-2">
            <UserMinus size={15} /> Remove {removing?.name} from the workspace
          </span>
        }
        footer={
          <>
            <button
              onClick={() => {
                setRemoving(null);
                setConfirmText('');
              }}
              className="btn btn-ghost"
            >
              Cancel
            </button>
            <button
              onClick={remove}
              className="btn btn-primary"
              style={{ background: '#e03e3e' }}
              disabled={busy || confirmText.trim().toLowerCase() !== 'remove'}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
              Remove account
            </button>
          </>
        }
      >
        {removing && (
          <div className="text-[13.5px]">
            <p className="text-[var(--text-secondary)]">
              Use this when someone has left. It signs them out everywhere, deletes their login,
              and frees their name for a future account.
            </p>

            <div className="my-3 rounded-md border p-3" style={{ background: 'var(--bg-subtle)' }}>
              <p className="mb-1.5 font-medium">What happens to their work</p>
              <ul className="space-y-1 text-[13px] text-[var(--text-secondary)]">
                <li>
                  <strong className="text-[var(--text)]">{removing.open_tasks}</strong>{' '}
                  open {removing.open_tasks === 1 ? 'task goes' : 'tasks go'} back to a Team Lead for triage.
                </li>
                <li>
                  Everything they wrote — tasks raised, comments, voice notes and progress reports —
                  is <strong className="text-[var(--text)]">kept</strong>, credited to “Removed user”.
                </li>
                <li>Completed work stays on the record.</li>
              </ul>
            </div>

            <p className="mb-1.5 text-[var(--text-secondary)]">
              This cannot be undone. Type <strong className="text-[var(--text)]">remove</strong> to confirm.
            </p>
            <input
              autoFocus
              className="input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="remove"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && confirmText.trim().toLowerCase() === 'remove') remove();
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
