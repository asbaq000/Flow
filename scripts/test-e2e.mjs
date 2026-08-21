/**
 * End-to-end check of the hierarchy and permission rules.
 *
 * Start the app first (npm run dev), then: npm test
 * Override the target with BASE_URL=http://localhost:3100 npm test
 *
 * Self-contained: it creates the accounts it needs (all on @e2e.local) and
 * deletes every task it makes, so it runs against an empty database or an
 * existing one. Do NOT point it at production — it would leave its test
 * accounts behind.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PW = 'e2e-password-123';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ' -> ' + extra : ''}`); }
};

const cookieOf = (res) =>
  res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

async function login(email, password = PW) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  const { user } = await res.json();
  return { cookie: cookieOf(res), user };
}

async function signup(email, name, role, setupCode) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, name, role, setupCode }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`signup failed for ${email}: ${res.status} ${body}`);
  }
  const { user } = await res.json();
  return { cookie: cookieOf(res), user };
}

/** Signs in if the account exists, otherwise creates it. */
async function ensure(email, name, role, setupCode) {
  try {
    return await login(email);
  } catch {
    return await signup(email, name, role, setupCode);
  }
}

const call = async (sess, path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: sess.cookie, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};

console.log('\n=== Flow · hierarchy & permission checks ===\n');

/* ---------- bootstrap the cast ---------- */
// The CEO seat is claimed with the server's setup code, not by signing up
// first. CEO_SETUP_CODE must match what the app is running with.
const SETUP_CODE = process.env.CEO_SETUP_CODE ?? 'e2e-setup-code';
// Throwaway accounts get a per-run suffix so the suite can be run repeatedly
// against the same database without colliding on the unique email index.
const RUN = Math.random().toString(36).slice(2, 8);
let ceo = await ensure('ceo@e2e.local', 'E2E Chief', 'MANAGER', SETUP_CODE);

const manager  = await ensure('manager1@e2e.local', 'E2E Manager One', 'MANAGER');
const manager2 = await ensure('manager2@e2e.local', 'E2E Manager Two', 'MANAGER');
const lead     = await ensure('lead1@e2e.local',    'E2E Lead One',    'TEAM_LEAD');
const lead2    = await ensure('lead2@e2e.local',    'E2E Lead Two',    'TEAM_LEAD');
const dev      = await ensure('dev1@e2e.local',     'E2E Dev One',     'DEV');
const otherDev = await ensure('dev2@e2e.local',     'E2E Dev Two',     'DEV');

if (ceo.user.role !== 'CEO') {
  // Someone else already holds the CEO seat, so this run cannot self-promote.
  console.error(
    `\nThis suite needs ceo@e2e.local to be the CEO, but it is ${ceo.user.role}.` +
    `\nStart the server with CEO_SETUP_CODE=${SETUP_CODE} (see .env.example),` +
    `\nor run against an empty database.\n`
  );
  process.exit(1);
}

// Roles are honoured at signup, but re-running against an existing workspace
// could find them changed — put everyone back where the tests expect them.
for (const [who, role] of [[manager, 'MANAGER'], [manager2, 'MANAGER'], [lead, 'TEAM_LEAD'],
                           [lead2, 'TEAM_LEAD'], [dev, 'DEV'], [otherDev, 'DEV']]) {
  if (who.user.role !== role) {
    await call(ceo, `/api/users/${who.user.id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    who.user.role = role;
  }
}

console.log('Auth');
ok('manager signs in with correct role', manager.user.role === 'MANAGER', manager.user.role);
ok('lead signs in with correct role', lead.user.role === 'TEAM_LEAD', lead.user.role);
ok('wrong password is rejected', (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'manager1@e2e.local', password: 'wrong' }),
})).status === 401);
ok('unauthenticated request is rejected', (await fetch(`${BASE}/api/tasks`)).status === 401);

console.log('\nRouting — a Manager raises work');
const created = await call(manager, '/api/tasks', {
  method: 'POST',
  body: JSON.stringify({
    title: 'E2E — client needs SSO',
    description: JSON.stringify([{ id: 'b1', type: 'paragraph', text: 'Okta, SAML.' }]),
    priority: 'HIGH',
    assigneeId: dev.user.id, // the Manager tries to self-assign to a dev
    links: [{ url: 'example.com/brief', label: 'Brief' }],
  }),
});
ok('task created', created.status === 201, JSON.stringify(created.body).slice(0, 120));
const task = created.body.task;
// Routing load-balances across Team Leads, so assert the role, not a person.
ok('auto-routed to a Team Lead, not the requested dev',
   task.assignee?.role === 'TEAM_LEAD' && task.assignee_id !== dev.user.id,
   `assignee=${task.assignee?.name} (${task.assignee?.role})`);
ok('lands in TRIAGE', task.status === 'TRIAGE', task.status);
// The real invariant is that a number is never handed out twice — not that it
// clears some threshold, which only held while the old seed pre-filled 12 tasks.
{
  const allSeqs = (await call(ceo, '/api/tasks')).body.tasks.map((t) => t.seq);
  ok('task number is unique across the workspace',
     task.seq > 0 && allSeqs.filter((n) => n === task.seq).length === 1,
     `seq=${task.seq} of [${allSeqs.join(',')}]`);
}
ok('link normalised to https', task.links[0]?.url === 'https://example.com/brief', task.links[0]?.url);

console.log('\nEmployee limits');
ok('a Manager cannot reassign', (await call(manager, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ assigneeId: dev.user.id }) })).status === 403);
ok('a Manager cannot move status', (await call(manager, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) })).status === 403);
ok('a Manager cannot split', (await call(manager, `/api/tasks/${task.id}/split`, {
  method: 'POST', body: JSON.stringify({ pieces: [{ title: 'a', assigneeId: null }, { title: 'b', assigneeId: null }] }) })).status === 403);
ok('a Manager CAN edit their own brief', (await call(manager, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ title: 'E2E — client needs SSO (Okta)' }) })).status === 200);

console.log('\nVisibility');
const devList = await call(otherDev, '/api/tasks');
ok('uninvolved dev cannot see the new task in their list',
   !devList.body.tasks.some((t) => t.id === task.id));
ok('uninvolved dev is blocked from fetching it directly',
   (await call(otherDev, `/api/tasks/${task.id}`)).status === 403);
const leadList = await call(lead, '/api/tasks');
ok('lead sees the whole board', leadList.body.tasks.some((t) => t.id === task.id));

console.log('\nTeam Lead assigns');
const assigned = await call(lead, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ assigneeId: dev.user.id }) });
ok('lead can assign', assigned.status === 200);
ok('assigning pulls it out of triage into TODO', assigned.body.task.status === 'TODO', assigned.body.task.status);

console.log('\nDev executes');
ok('assigned dev can move status', (await call(dev, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ status: 'IN_PROGRESS' }) })).status === 200);
ok('assigned dev CANNOT mark it done themselves', (await call(dev, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) })).status === 403);
ok('assigned dev cannot reassign to someone else', (await call(dev, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ assigneeId: otherDev.user.id }) })).status === 403);
ok('now-assigned dev can see it', (await call(dev, `/api/tasks/${task.id}`)).status === 200);
ok('assigned dev CANNOT rewrite the brief', (await call(dev, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ description: '[]' }) })).status === 403);
ok('assigned dev CANNOT rename the task', (await call(dev, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ title: 'dev rename attempt' }) })).status === 403);
ok('a Manager still CAN edit after triage', (await call(manager, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ title: 'E2E — client needs SSO (Okta)' }) })).status === 200);

console.log('\nRouting is absolute, assignment is Devs-only');
const leadRaised = await call(lead, '/api/tasks', {
  method: 'POST', body: JSON.stringify({ title: 'E2E — raised by the lead' }) });
ok('even a Team Lead\'s own task starts in TRIAGE', leadRaised.body.task.status === 'TRIAGE',
   leadRaised.body.task.status);
ok('a lead-raised task is still held by a lead', leadRaised.body.task.assignee?.role === 'TEAM_LEAD',
   String(leadRaised.body.task.assignee?.role));
ok('assigning to a Manager is rejected', (await call(lead, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ assigneeId: manager.user.id }) })).status === 400);
ok('assigning to a Team Lead is rejected', (await call(lead, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ assigneeId: lead.user.id }) })).status === 400);
ok('assigning to a Developer is accepted', (await call(lead, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ assigneeId: dev.user.id }) })).status === 200);
await call(ceo, `/api/tasks/${leadRaised.body.task.id}`, { method: 'DELETE' });

console.log('\nSplitting');
const split = await call(lead, `/api/tasks/${task.id}/split`, {
  method: 'POST',
  body: JSON.stringify({ pieces: [
    { title: 'SAML handshake', assigneeId: dev.user.id },
    { title: 'Admin config screen', assigneeId: otherDev.user.id },
  ] }),
});
ok('lead can split into pieces', split.status === 201, JSON.stringify(split.body).slice(0, 120));
ok('two subtasks created', split.body.task?.subtasks?.length === 2, String(split.body.task?.subtasks?.length));
const seqs = (split.body.task?.subtasks ?? []).map((s) => s.seq);
ok('subtask numbers do not collide with each other or the parent',
   new Set(seqs).size === seqs.length && seqs.every((n) => n > 0 && n !== task.seq),
   `pieces=${seqs.join(',')} parent=${task.seq}`);
ok('each piece went to its own dev',
   split.body.task?.subtasks?.[0]?.assignee_id !== split.body.task?.subtasks?.[1]?.assignee_id);
ok('a single piece is rejected', (await call(lead, `/api/tasks/${task.id}/split`, {
  method: 'POST', body: JSON.stringify({ pieces: [{ title: 'only one', assigneeId: null }] }) })).status === 400);
ok('a piece aimed at a Manager is rejected', (await call(lead, `/api/tasks/${task.id}/split`, {
  method: 'POST', body: JSON.stringify({ pieces: [
    { title: 'ok piece', assigneeId: dev.user.id },
    { title: 'bad piece', assigneeId: manager.user.id },
  ] }) })).status === 400);
ok('the second dev can now see the parent', (await call(otherDev, `/api/tasks/${task.id}`)).status === 200);

console.log('\nComments, mentions, notifications');
const comment = await call(lead, `/api/tasks/${task.id}/comments`, {
  method: 'POST',
  body: JSON.stringify({ body: `@[Sofia Rossi](${dev.user.id}) please start with the handshake.` }),
});
ok('lead can comment', comment.status === 201);
const devNotifs = await call(dev, '/api/notifications');
ok('mention produced a notification for the dev',
   devNotifs.body.notifications.some((n) => n.type === 'mention' && n.task_id === task.id));
ok('assignment produced a notification too',
   devNotifs.body.notifications.some((n) => n.type === 'assigned' && n.task_id === task.id));
ok('empty comment is rejected', (await call(lead, `/api/tasks/${task.id}/comments`, {
  method: 'POST', body: JSON.stringify({ body: '   ' }) })).status === 400);
ok('outsider cannot comment', (await call(await login('manager2@e2e.local'), `/api/tasks/${task.id}/comments`, {
  method: 'POST', body: JSON.stringify({ body: 'sneaking in' }) })).status === 403);

console.log('\nLinks & input validation');
ok('javascript: URL is rejected', (await call(lead, `/api/tasks/${task.id}/links`, {
  method: 'POST', body: JSON.stringify({ url: 'javascript:alert(1)', label: 'x' }) })).status === 400);
ok('bare domain is accepted and normalised', (await call(lead, `/api/tasks/${task.id}/links`, {
  method: 'POST', body: JSON.stringify({ url: 'acme.io/spec', label: 'Spec' }) })).status === 201);
ok('signup rejects a short password', (await fetch(`${BASE}/api/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `short-${RUN}@e2e.local`, password: 'short', name: 'X Y', role: 'DEV' }) })).status === 400);
ok('signup rejects a duplicate email', (await fetch(`${BASE}/api/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'manager1@e2e.local', password: PW, name: 'Fake', role: 'DEV' }) })).status === 400);

console.log('\nAdmin & role management');
ok('a Team Lead cannot change roles', (await call(lead, `/api/users/${dev.user.id}`, {
  method: 'PATCH', body: JSON.stringify({ role: 'ADMIN' }) })).status === 403);
ok('the CEO can change a role', (await call(ceo, `/api/users/${dev.user.id}`, {
  method: 'PATCH', body: JSON.stringify({ role: 'TEAM_LEAD' }) })).status === 200);
await call(ceo, `/api/users/${dev.user.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'DEV' }) });
{
  // The guard only fires when this really is the last CEO, so check which
  // situation we are in rather than assuming a pristine database.
  const ceoCount = (await call(ceo, '/api/users')).body.users
    .filter((u) => u.role === 'CEO').length;
  const attempt = await call(ceo, `/api/users/${ceo.user.id}`, {
    method: 'PATCH', body: JSON.stringify({ role: 'DEV' }) });
  if (ceoCount === 1) {
    ok('the last CEO cannot demote themselves', attempt.status === 400, String(attempt.status));
  } else {
    ok('a CEO may step down while another remains', attempt.status === 200, String(attempt.status));
    // put the seat back so the rest of the suite still has an admin
    await call(ceo, `/api/users/${ceo.user.id}`, {
      method: 'PATCH', body: JSON.stringify({ role: 'CEO' }) });
  }
}

console.log('\nRole hierarchy');
ok('CEO is the top role', ceo.user.role === 'CEO', ceo.user.role);
ok('Manager signs in as MANAGER', manager2.user.role === 'MANAGER', manager2.user.role);
ok('a Manager does NOT see tasks they are not on',
   !(await call(manager2, '/api/tasks')).body.tasks.some((t) => t.id === task.id));
ok('a Manager cannot assign', (await call(manager2, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ assigneeId: dev.user.id }) })).status === 403);
ok('only four roles exist',
   (await call(ceo, '/api/users')).body.users.every((u) =>
     ['CEO', 'MANAGER', 'TEAM_LEAD', 'DEV'].includes(u.role)),
   [...new Set((await call(ceo, '/api/users')).body.users.map((u) => u.role))].join(','));
ok('nobody is left on the retired EMPLOYEE role',
   !(await call(ceo, '/api/users')).body.users.some((u) => u.role === 'EMPLOYEE'));
ok('signup cannot claim CEO', (await fetch(`${BASE}/api/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `sneaky-${RUN}@e2e.local`, password: PW, name: 'Sneaky Pete', role: 'CEO' }) })).status === 400);
ok('signup cannot claim the retired EMPLOYEE role', (await fetch(`${BASE}/api/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `old-${RUN}@e2e.local`, password: PW, name: 'Old Role', role: 'EMPLOYEE' }) })).status === 400);

console.log('\nProgress reporting');
ok('a Manager cannot report progress', (await call(manager, `/api/tasks/${task.id}/progress`, {
  method: 'POST', body: JSON.stringify({ percent: 50, doneSummary: 'nope' }) })).status === 403);
const upd = await call(dev, `/api/tasks/${task.id}/progress`, {
  method: 'POST',
  body: JSON.stringify({ percent: 45, doneSummary: 'SAML handshake works end to end.', remaining: 'Admin config screen.', hoursSpent: 6 }),
});
ok('the assigned dev can post an update', upd.status === 201, JSON.stringify(upd.body).slice(0, 120));
ok('percent lands on the task', upd.body.task?.progress === 45, String(upd.body.task?.progress));
ok('an empty update is rejected', (await call(dev, `/api/tasks/${task.id}/progress`, {
  method: 'POST', body: JSON.stringify({ percent: 50 }) })).status === 400);
ok('percent is clamped to 0-100', (await call(dev, `/api/tasks/${task.id}/progress`, {
  method: 'POST', body: JSON.stringify({ percent: 900, doneSummary: 'over the top' }) }))
  .body.task?.progress === 100);

console.log('\nSubmit -> review -> approve');
ok('submitting without a summary is rejected', (await call(dev, `/api/tasks/${task.id}/progress`, {
  method: 'POST', body: JSON.stringify({ submit: true, percent: 100 }) })).status === 400);
const submitted = await call(dev, `/api/tasks/${task.id}/progress`, {
  method: 'POST',
  body: JSON.stringify({ submit: true, percent: 100, doneSummary: 'Everything is built and tested.' }),
});
ok('the dev can submit for review', submitted.status === 201, JSON.stringify(submitted.body).slice(0, 140));
ok('status becomes SUBMITTED', submitted.body.task?.status === 'SUBMITTED', submitted.body.task?.status);
ok('the lead is notified a review is waiting',
   (await call(lead, '/api/notifications')).body.notifications.some(
     (n) => n.type === 'review_requested' && n.task_id === task.id));
ok('a dev cannot approve their own work', (await call(dev, `/api/tasks/${task.id}/review`, {
  method: 'POST', body: JSON.stringify({ decision: 'approve' }) })).status === 403);
ok('requesting changes needs a note', (await call(lead, `/api/tasks/${task.id}/review`, {
  method: 'POST', body: JSON.stringify({ decision: 'request_changes', note: '  ' }) })).status === 400);

const sentBack = await call(lead, `/api/tasks/${task.id}/review`, {
  method: 'POST',
  body: JSON.stringify({ decision: 'request_changes', note: 'Session fixation on the SAML callback — fix before this ships.' }),
});
ok('the lead can send it back', sentBack.status === 200);
ok('status becomes CHANGES_REQUESTED', sentBack.body.task?.status === 'CHANGES_REQUESTED', sentBack.body.task?.status);
ok('the dev is told what to change',
   (await call(dev, '/api/notifications')).body.notifications.some(
     (n) => n.type === 'changes_requested' && n.task_id === task.id));
ok('nothing to review once it is sent back', (await call(lead, `/api/tasks/${task.id}/review`, {
  method: 'POST', body: JSON.stringify({ decision: 'approve' }) })).status === 400);

await call(dev, `/api/tasks/${task.id}/progress`, {
  method: 'POST', body: JSON.stringify({ submit: true, percent: 100, doneSummary: 'Fixed the session fixation and re-tested.' }),
});
const approved = await call(lead, `/api/tasks/${task.id}/review`, {
  method: 'POST', body: JSON.stringify({ decision: 'approve', note: 'Verified. Good work.' }),
});
ok('the lead can approve', approved.status === 200);
ok('approval is what finally sets DONE', approved.body.task?.status === 'DONE', approved.body.task?.status);
ok('approval forces progress to 100', approved.body.task?.progress === 100, String(approved.body.task?.progress));
ok('the dev is told it was approved',
   (await call(dev, '/api/notifications')).body.notifications.some(
     (n) => n.type === 'approved' && n.task_id === task.id));
ok('the full trail is kept',
   (await call(lead, `/api/tasks/${task.id}/progress`)).body.updates.length >= 6,
   String((await call(lead, `/api/tasks/${task.id}/progress`)).body.updates.length));

console.log('\nLive event stream');
const sse = await fetch(`${BASE}/api/events`, { headers: { Cookie: lead.cookie } });
ok('the stream opens for a signed-in user', sse.status === 200, String(sse.status));
ok('it is served as an event stream',
   (sse.headers.get('content-type') ?? '').includes('text/event-stream'),
   sse.headers.get('content-type') ?? 'none');
{
  const reader = sse.body.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value ?? new Uint8Array());
  ok('it greets with a ready event', text.includes('event: ready'), text.slice(0, 60));
  await reader.cancel();
}
ok('the stream refuses anonymous listeners', (await fetch(`${BASE}/api/events`)).status === 401);

console.log('\nVoice notes');
const wav = Buffer.from(
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=', 'base64');

async function postVoice(sess, taskId, { commentId, bytes = wav, type = 'audio/wav' } = {}) {
  const form = new FormData();
  form.append('audio', new Blob([bytes], { type }), 'note.wav');
  form.append('durationMs', '1500');
  if (commentId) form.append('commentId', commentId);
  const res = await fetch(`${BASE}/api/tasks/${taskId}/voice`, {
    method: 'POST', headers: { Cookie: sess.cookie }, body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const briefVoice = await postVoice(manager, task.id);
ok('the requester can attach a voice note to the brief', briefVoice.status === 201,
   JSON.stringify(briefVoice.body).slice(0, 120));
ok('the note reports its duration', briefVoice.body.voiceNote?.duration_ms === 1500,
   String(briefVoice.body.voiceNote?.duration_ms));
ok('a dev CANNOT add a note to the brief', (await postVoice(dev, task.id)).status === 403);

const audioRes = await fetch(`${BASE}/api/voice/${briefVoice.body.voiceNote.id}`, {
  headers: { Cookie: lead.cookie } });
ok('audio streams back to someone with access', audioRes.status === 200 &&
   (audioRes.headers.get('content-type') ?? '').startsWith('audio/'),
   `${audioRes.status} ${audioRes.headers.get('content-type')}`);
ok('the bytes come back intact', (await audioRes.arrayBuffer()).byteLength === wav.byteLength);
ok('an outsider cannot stream the audio',
   (await fetch(`${BASE}/api/voice/${briefVoice.body.voiceNote.id}`,
     { headers: { Cookie: (await login('manager2@e2e.local')).cookie } })).status === 403);
ok('the brief carries its voice notes', (await call(lead, `/api/tasks/${task.id}`))
   .body.task.voice_notes.length >= 1);

const voiceComment = await call(dev, `/api/tasks/${task.id}/comments`, {
  method: 'POST', body: JSON.stringify({ body: 'Recording my update' }) });
const commentVoice = await postVoice(dev, task.id, { commentId: voiceComment.body.comment.id });
ok('a dev CAN attach a voice note to their own comment', commentVoice.status === 201,
   JSON.stringify(commentVoice.body).slice(0, 120));
ok('the comment carries its recording',
   (await call(dev, `/api/tasks/${task.id}`)).body.comments
     .find((c) => c.id === voiceComment.body.comment.id)?.voice_notes.length === 1);
ok('you cannot attach audio to someone else\'s comment',
   (await postVoice(lead, task.id, { commentId: voiceComment.body.comment.id })).status === 403);
ok('an empty upload is rejected', (await postVoice(manager, task.id, { bytes: Buffer.alloc(0) })).status === 400);
ok('a non-author cannot delete a recording',
   (await call(lead, `/api/voice/${commentVoice.body.voiceNote.id}`, { method: 'DELETE' })).status === 403);
ok('the author can delete their own recording',
   (await call(dev, `/api/voice/${commentVoice.body.voiceNote.id}`, { method: 'DELETE' })).status === 200);

console.log('\nVoice transcription (transcribing itself runs in the browser; this is the API side)');
{
  const brief2 = await postVoice(manager, task.id);
  const noteId = brief2.body.voiceNote.id;
  ok('a fresh recording starts untranscribed', brief2.body.voiceNote.transcript_status === 'none',
     brief2.body.voiceNote.transcript_status);
  ok('no transcript text yet', brief2.body.voiceNote.transcript === null);

  const claim1 = await call(lead, `/api/voice/${noteId}`, {
    method: 'PATCH', body: JSON.stringify({ action: 'claim' }) });
  ok('the first claim succeeds', claim1.status === 200 && claim1.body.claimed === true,
     JSON.stringify(claim1.body));

  const claim2 = await call(dev, `/api/voice/${noteId}`, {
    method: 'PATCH', body: JSON.stringify({ action: 'claim' }) });
  ok('a second, concurrent claim is refused — only one browser transcribes at a time',
     claim2.status === 200 && claim2.body.claimed === false);

  ok('an outsider cannot claim a note they cannot see',
     (await call(manager2, `/api/voice/${noteId}`, {
       method: 'PATCH', body: JSON.stringify({ action: 'claim' }) })).status === 403);

  const saved = await call(lead, `/api/voice/${noteId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'done', transcript: 'ap kese hain', lang: 'ur' }) });
  ok('the transcript can be saved', saved.status === 200 && saved.body.voiceNote?.transcript === 'ap kese hain',
     JSON.stringify(saved.body).slice(0, 150));
  ok('its language tag is stored', saved.body.voiceNote?.transcript_lang === 'ur');
  ok('status moves to done', saved.body.voiceNote?.transcript_status === 'done');

  ok('an empty transcript is rejected', (await call(lead, `/api/voice/${noteId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'done', transcript: '   ' }) })).status === 400);

  // Whisper answers silence with filler rather than nothing, and that filler
  // must never end up stored as if it were speech.
  ok('a transcript of only punctuation is rejected', (await call(lead, `/api/voice/${noteId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'done', transcript: ',,,,,,,,,, ,,, , ,,,' }) })).status === 400);
  ok('a transcript of only dots and dashes is rejected', (await call(lead, `/api/voice/${noteId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'done', transcript: '. - . - .' }) })).status === 400);
  ok('real speech is still accepted', (await call(lead, `/api/voice/${noteId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'done', transcript: 'ap kese hain' }) })).status === 200);

  ok('a poor transcript can be run again',
     (await call(dev, `/api/voice/${noteId}`, {
       method: 'PATCH', body: JSON.stringify({ action: 'claim' }) })).body.claimed === true,
     'a done note must be re-claimable, otherwise a bad transcript is permanent');
  ok('but not while one is already running',
     (await call(lead, `/api/voice/${noteId}`, {
       method: 'PATCH', body: JSON.stringify({ action: 'claim' }) })).body.claimed === false);

  // Mid-retry the note is 'pending' with the old text still on it.
  const failedRetry = await call(dev, `/api/voice/${noteId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'failed' }) });
  ok('a failed retry keeps the transcript it already had',
     failedRetry.body.voiceNote?.transcript === 'ap kese hain');
  ok('and stays readable rather than flipping to an error',
     failedRetry.body.voiceNote?.transcript_status === 'done',
     failedRetry.body.voiceNote?.transcript_status);

  const brief3 = await postVoice(manager, task.id);
  const failId = brief3.body.voiceNote.id;
  const failed = await call(lead, `/api/voice/${failId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'failed' }) });
  ok('a failed attempt is recorded', failed.status === 200 && failed.body.voiceNote?.transcript_status === 'failed');
  ok('a failed note can be re-claimed for another attempt',
     (await call(lead, `/api/voice/${failId}`, {
       method: 'PATCH', body: JSON.stringify({ action: 'claim' }) })).body.claimed === true);

  const fetched = await call(lead, `/api/tasks/${task.id}`);
  const noteInTask = fetched.body.task.voice_notes.find((v) => v.id === noteId);
  ok('the task payload carries the transcript', noteInTask?.transcript === 'ap kese hain',
     JSON.stringify(noteInTask).slice(0, 150));
}

console.log('\nDeveloper task sheet');
// The task was already approved above, so it is genuinely DONE by now.
const sheet = (await call(lead, `/api/users/${dev.user.id}/sheet`)).body.sheet;
ok('a lead can open a dev sheet', Boolean(sheet), 'no sheet returned');
ok('the finished task appears under completed',
   sheet.completed.some((e) => e.id === task.id), sheet.completed.map((e) => e.seq).join(','));
ok('entries carry full detail', (() => {
  const entry = sheet.completed.find((e) => e.id === task.id);
  return entry && entry.completed_at && entry.turnaround_ms !== null && entry.seq > 0;
})());
ok('stats count the completion', sheet.stats.completed_total >= 1 && sheet.stats.completed_7d >= 1,
   JSON.stringify(sheet.stats));
ok('a dev can open their own sheet', (await call(dev, `/api/users/${dev.user.id}/sheet`)).status === 200);
ok('a dev cannot open another dev\'s sheet',
   (await call(dev, `/api/users/${otherDev.user.id}/sheet`)).status === 403);
ok('a Manager cannot open a dev sheet',
   (await call(manager, `/api/users/${dev.user.id}/sheet`)).status === 403);

console.log('\nMentions are limited to people on the task');
const members = (await call(lead, `/api/tasks/${task.id}/members`)).body.members;
ok('the member list excludes uninvolved people',
   !members.some((m) => m.id === manager2.user.id),
   members.map((m) => m.name).join(', '));
ok('it includes the assigned developer', members.some((m) => m.id === dev.user.id));
ok('it includes the person who raised it', members.some((m) => m.id === manager.user.id));
ok('it includes the Team Lead', members.some((m) => m.id === lead.user.id));
ok('an outsider cannot read the member list',
   (await call(manager2, `/api/tasks/${task.id}/members`)).status === 403);

console.log('\nForgot password');
ok('an unknown email still answers 200 (no account enumeration)',
   (await fetch(`${BASE}/api/auth/forgot`, {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ email: 'nobody@nowhere.test' }) })).status === 200);
ok('a blank email is rejected', (await fetch(`${BASE}/api/auth/forgot`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: '' }) })).status === 400);
ok('a real account answers identically', (await fetch(`${BASE}/api/auth/forgot`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'dev2@e2e.local' }) })).status === 200);
ok('a bogus reset token is refused', (await fetch(`${BASE}/api/auth/reset`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'not-a-real-token', password: 'brandnewpass' }) })).status === 400);
ok('a short new password is refused', (await fetch(`${BASE}/api/auth/reset`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: 'whatever', password: 'short' }) })).status === 400);

console.log('\nThe CEO seat is claimed, not inherited');
{
  const plain = await signup(`firstcomer-${RUN}@e2e.local`, 'First Comer', 'MANAGER');
  ok('signing up without a code never yields CEO', plain.user.role === 'MANAGER', plain.user.role);
  ok('a wrong setup code is refused', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `wrongcode-${RUN}@e2e.local`, password: PW, name: 'Wrong Code',
                           role: 'DEV', setupCode: 'definitely-not-the-code' }) })).status === 403);
  ok('the account is not created when the code fails',
     (await call(ceo, '/api/users')).body.users.every((u) => u.email !== `wrongcode-${RUN}@e2e.local`));

  // tidy up
  await call(ceo, `/api/users/${plain.user.id}`, { method: 'DELETE' });
}

console.log('\nOffboarding someone who left');
{
  const leaver = await signup(`leaver-${RUN}@e2e.local`, 'Departing Dev', 'DEV');

  // Give them a task and some history worth preserving.
  const raised = await call(manager, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: 'E2E — work owned by a leaver' }) });
  const tid = raised.body.task.id;
  await call(lead, `/api/tasks/${tid}`, {
    method: 'PATCH', body: JSON.stringify({ assigneeId: leaver.user.id }) });
  await call(leaver, `/api/tasks/${tid}/comments`, {
    method: 'POST', body: JSON.stringify({ body: 'A comment that must outlive my account.' }) });
  await call(leaver, `/api/tasks/${tid}/progress`, {
    method: 'POST', body: JSON.stringify({ percent: 30, doneSummary: 'Started the groundwork.' }) });

  ok('a Manager cannot remove anyone',
     (await call(manager, `/api/users/${leaver.user.id}`, { method: 'DELETE' })).status === 403);
  ok('a Developer cannot remove anyone',
     (await call(dev, `/api/users/${leaver.user.id}`, { method: 'DELETE' })).status === 403);
  ok('nobody can remove themselves',
     (await call(lead, `/api/users/${lead.user.id}`, { method: 'DELETE' })).status === 403);
  ok('a Team Lead cannot remove another Team Lead',
     (await call(lead, `/api/users/${lead2.user.id}`, { method: 'DELETE' })).status === 403);
  ok('the CEO cannot be removed',
     (await call(lead, `/api/users/${ceo.user.id}`, { method: 'DELETE' })).status === 403);

  const gone = await call(lead, `/api/users/${leaver.user.id}`, { method: 'DELETE' });
  ok('a Team Lead CAN remove a Developer', gone.status === 200, JSON.stringify(gone.body).slice(0, 120));
  ok('their open work was handed back', gone.body.removed?.reassigned === 1,
     String(gone.body.removed?.reassigned));

  ok('they can no longer sign in', (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `leaver-${RUN}@e2e.local`, password: PW }) })).status === 401);
  ok('they are gone from the people list',
     (await call(ceo, '/api/users')).body.users.every((u) => u.email !== `leaver-${RUN}@e2e.local`));

  const after = await call(lead, `/api/tasks/${tid}`);
  ok('the task itself survives', after.status === 200);
  ok('it went back to triage', after.body.task?.status === 'TRIAGE', after.body.task?.status);
  ok('their comment survives', after.body.comments?.length === 1,
     String(after.body.comments?.length));
  ok('the orphaned comment reads as authorless', after.body.comments?.[0]?.author === null);
  ok('their progress report survives', after.body.task?.progress_updates?.length >= 1,
     String(after.body.task?.progress_updates?.length));

  await call(ceo, `/api/tasks/${tid}`, { method: 'DELETE' });
}

/* ---------- meetings ---------- */
console.log('\nScheduling meetings');
{
  const startsAt = Date.now() + 3600_000;
  const body = {
    title: `E2E — sprint planning ${RUN}`,
    agenda: 'Plan the week',
    startsAt,
    durationMin: 30,
    timeZone: 'Asia/Karachi',
    participantIds: [dev.user.id, otherDev.user.id],
  };

  ok('a Developer cannot schedule a meeting',
     (await call(dev, '/api/meetings', { method: 'POST', body: JSON.stringify(body) })).status === 403);
  ok('a Manager cannot schedule a meeting',
     (await call(manager, '/api/meetings', { method: 'POST', body: JSON.stringify(body) })).status === 403);

  const made = await call(lead, '/api/meetings', { method: 'POST', body: JSON.stringify(body) });
  ok('a Team Lead can schedule a meeting', made.status === 201, String(made.status));

  const meeting = made.body.meeting;
  ok('it keeps the time it was given', meeting?.starts_at === startsAt);
  ok('it keeps the organiser timezone', meeting?.time_zone === 'Asia/Karachi');
  ok('the organiser is in the room too',
     meeting?.participants?.some((p) => p.id === lead.user.id));
  ok('everyone invited is on it',
     [dev.user.id, otherDev.user.id].every((id) => meeting?.participants?.some((p) => p.id === id)));

  /*
   * Whether Google is configured is a property of the environment, not of the
   * app, so assert the invariant that holds either way: the meeting is always
   * saved, and its state always explains itself — a link when Google answered,
   * a reason when it did not. Never a meeting that is silently neither.
   */
  const booked = meeting?.status === 'scheduled';
  ok('the meeting is saved whatever Google does', Boolean(meeting?.id), meeting?.status);
  ok(booked ? 'Google issued a Meet link' : 'an unreachable Google records why, and keeps the meeting',
     booked ? Boolean(meeting.join_url) : Boolean(meeting.sync_error),
     booked ? `join_url=${meeting.join_url}` : `sync_error=${meeting.sync_error}`);
  ok('a booked meeting carries the calendar event it can be cancelled through',
     booked ? Boolean(meeting.calendar_event_id) : meeting.calendar_event_id === null);

  ok('a title is required',
     (await call(lead, '/api/meetings',
       { method: 'POST', body: JSON.stringify({ ...body, title: '  ' }) })).status === 400);
  ok('somebody has to be invited',
     (await call(lead, '/api/meetings',
       { method: 'POST', body: JSON.stringify({ ...body, participantIds: [] }) })).status === 400);
  ok('the length has to be one we offer',
     (await call(lead, '/api/meetings',
       { method: 'POST', body: JSON.stringify({ ...body, durationMin: 37 }) })).status === 400);

  ok('an invited developer sees it',
     (await call(dev, '/api/meetings')).body.meetings?.some((m) => m.id === meeting.id));
  ok('an uninvited manager does not',
     !(await call(manager2, '/api/meetings')).body.meetings?.some((m) => m.id === meeting.id));
  ok('an invited developer can open it',
     (await call(dev, `/api/meetings/${meeting.id}`)).status === 200);
  ok('an uninvited manager cannot',
     (await call(manager2, `/api/meetings/${meeting.id}`)).status === 403);

  ok('an invited developer cannot cancel it',
     (await call(dev, `/api/meetings/${meeting.id}`, { method: 'DELETE' })).status === 403);

  /* ---- minutes and attendance ---- */
  const minutesBody = JSON.stringify({ action: 'minutes', minutes: 'Agreed the Okta rollout order.' });
  ok('an invited developer cannot write the minutes',
     (await call(dev, `/api/meetings/${meeting.id}`, { method: 'PATCH', body: minutesBody })).status === 403);

  const written = await call(lead, `/api/meetings/${meeting.id}`, { method: 'PATCH', body: minutesBody });
  ok('the organiser can write the minutes', written.status === 200, String(written.status));
  ok('the minutes come back with the meeting',
     written.body.meeting?.minutes === 'Agreed the Okta rollout order.');
  ok('the minutes record who wrote them', written.body.meeting?.minutes_author_id === lead.user.id);
  ok('the minutes record when', Number(written.body.meeting?.minutes_updated_at) > 0);

  ok('everyone starts unmarked, which is not the same as absent',
     written.body.meeting?.participants?.every((p) => p.attended === null));

  const marked = await call(lead, `/api/meetings/${meeting.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'attendance', userId: dev.user.id, attended: true }),
  });
  ok('attendance can be marked', marked.status === 200, String(marked.status));
  ok('the person marked reads as having joined',
     marked.body.meeting?.participants?.find((p) => p.id === dev.user.id)?.attended === 1);
  ok('marking one person leaves the others unmarked',
     marked.body.meeting?.participants?.find((p) => p.id === otherDev.user.id)?.attended === null);

  const absent = await call(lead, `/api/meetings/${meeting.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'attendance', userId: otherDev.user.id, attended: false }),
  });
  ok('somebody can be marked as not having joined',
     absent.body.meeting?.participants?.find((p) => p.id === otherDev.user.id)?.attended === 0);

  const cleared = await call(lead, `/api/meetings/${meeting.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'attendance', userId: otherDev.user.id, attended: null }),
  });
  ok('a mark can be cleared back to unrecorded',
     cleared.body.meeting?.participants?.find((p) => p.id === otherDev.user.id)?.attended === null);

  ok('somebody not on the meeting cannot be marked',
     (await call(lead, `/api/meetings/${meeting.id}`, {
       method: 'PATCH',
       body: JSON.stringify({ action: 'attendance', userId: manager2.user.id, attended: true }),
     })).status === 404);

  ok('an invited developer cannot mark attendance',
     (await call(dev, `/api/meetings/${meeting.id}`, {
       method: 'PATCH',
       body: JSON.stringify({ action: 'attendance', userId: dev.user.id, attended: true }),
     })).status === 403);

  const cancelled = await call(lead, `/api/meetings/${meeting.id}`, { method: 'DELETE' });
  ok('the organiser can cancel it', cancelled.status === 200, String(cancelled.status));
  ok('it reads as cancelled afterwards', cancelled.body.meeting?.status === 'cancelled');
  ok('a cancelled meeting drops out of what is upcoming',
     !(await call(lead, '/api/meetings')).body.meetings?.some((m) => m.id === meeting.id));

  // History is the point of keeping cancelled and finished calls at all.
  const past = await call(lead, '/api/meetings?scope=past');
  const kept = past.body.meetings?.find((m) => m.id === meeting.id);
  ok('it is still there in the history', Boolean(kept));
  ok('the history keeps the minutes', kept?.minutes === 'Agreed the Okta rollout order.');
  ok('the history keeps who attended',
     kept?.participants?.find((p) => p.id === dev.user.id)?.attended === 1);
  ok('a cancelled meeting cannot be retried',
     (await call(lead, `/api/meetings/${meeting.id}`,
       { method: 'PATCH', body: JSON.stringify({ action: 'retry' }) })).status === 400);
}

console.log('\nCleanup');
ok('the CEO can delete the test task', (await call(ceo, `/api/tasks/${task.id}`, { method: 'DELETE' })).status === 200);
ok('subtasks cascade away with the parent', (await call(lead, `/api/tasks/${split.body.task.subtasks[0].id}`)).status === 404);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
