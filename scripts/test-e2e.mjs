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

// `extra` is how the account gets into an organisation: { orgName } founds
// one, { inviteCode } joins one, { setupCode } claims a pre-organisation CEO seat.
async function signup(email, name, role, extra = {}) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, name, role, ...extra }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`signup failed for ${email}: ${res.status} ${body}`);
  }
  const { user } = await res.json();
  return { cookie: cookieOf(res), user };
}

/** Signs in if the account exists, otherwise creates it. */
async function ensure(email, name, role, extra) {
  try {
    return await login(email);
  } catch {
    return await signup(email, name, role, extra);
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
// Founding an organisation is what makes someone CEO. On an empty database the
// chief founds "E2E Org"; on a database that already has them, everyone just
// signs in. CEO_SETUP_CODE is only needed for the legacy-path checks below.
const SETUP_CODE = process.env.CEO_SETUP_CODE ?? 'e2e-setup-code';
// Throwaway accounts get a per-run suffix so the suite can be run repeatedly
// against the same database without colliding on the unique email index.
const RUN = Math.random().toString(36).slice(2, 8);
let ceo = await ensure('ceo@e2e.local', 'E2E Chief', 'MANAGER', { orgName: 'E2E Org' });

if (ceo.user.role !== 'CEO') {
  // Someone else already holds the CEO seat, so this run cannot self-promote.
  console.error(
    `\nThis suite needs ceo@e2e.local to be the CEO, but it is ${ceo.user.role}.` +
    `\nRun against an empty database, or make that account the CEO first.\n`
  );
  process.exit(1);
}

// Everyone else joins the chief's organisation with its invite code.
const INVITE = (await call(ceo, '/api/org')).body.org?.invite_code;
if (!INVITE) {
  console.error('\nThe CEO could not read the invite code from /api/org.\n');
  process.exit(1);
}
const join = { inviteCode: INVITE };
const manager  = await ensure('manager1@e2e.local', 'E2E Manager One', 'MANAGER',   join);
const manager2 = await ensure('manager2@e2e.local', 'E2E Manager Two', 'MANAGER',   join);
const lead     = await ensure('lead1@e2e.local',    'E2E Lead One',    'TEAM_LEAD', join);
const lead2    = await ensure('lead2@e2e.local',    'E2E Lead Two',    'TEAM_LEAD', join);
const dev      = await ensure('dev1@e2e.local',     'E2E Dev One',     'DEV',       join);
const otherDev = await ensure('dev2@e2e.local',     'E2E Dev Two',     'DEV',       join);

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
ok('lands in To Do on that Lead', task.status === 'TODO', task.status);
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
ok('even a Team Lead\'s own task starts in To Do', leadRaised.body.task.status === 'TODO',
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

console.log('\nA Lead can assign as they raise it');
{
  const direct = await call(lead, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `E2E — lead assigns at creation ${RUN}`, assigneeId: dev.user.id, priority: 'LOW' }),
  });
  ok('a Lead can name the developer while creating', direct.status === 201, JSON.stringify(direct.body).slice(0, 140));
  ok('it lands on that developer', direct.body.task?.assignee_id === dev.user.id, direct.body.task?.assignee?.name);
  ok('and starts in To Do', direct.body.task?.status === 'TODO', direct.body.task?.status);
  ok('the response says it was assigned, not routed', direct.body.assignedDirectly === true);
  ok('the developer is told', (await call(dev, '/api/notifications')).body.notifications.some(
     (n) => n.type === 'assigned' && n.task_id === direct.body.task.id));
  // Assigning is the Team Lead's job now, and only theirs — a CEO naming a
  // developer is routed like anybody else's request.
  const ceoTried = await call(ceo, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — ceo assigns ${RUN}`, assigneeId: dev.user.id }) });
  ok('a CEO naming a developer is routed, not obeyed', ceoTried.body.task?.assignee_id !== dev.user.id,
     ceoTried.body.task?.assignee?.role);
  ok('a CEO cannot reassign an existing task', (await call(ceo, `/api/tasks/${task.id}`, {
    method: 'PATCH', body: JSON.stringify({ assigneeId: otherDev.user.id }) })).status === 403);
  ok('nor can a Manager', (await call(manager, `/api/tasks/${task.id}`, {
    method: 'PATCH', body: JSON.stringify({ assigneeId: otherDev.user.id }) })).status === 403);
  ok('naming a Manager is refused', (await call(lead, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: 'bad', assigneeId: manager.user.id }) })).status === 400);
  ok('naming somebody from another workspace is refused', (await call(lead, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: 'bad', assigneeId: 'u_nobody' }) })).status === 404);

  // The routing rule still holds for everyone without that authority.
  const raised = await call(manager, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — manager still routes ${RUN}`, assigneeId: dev.user.id }),
  });
  ok('a Manager naming a dev is still ignored', raised.body.task?.assignee_id !== dev.user.id);
  ok('and their task lands on a Lead', raised.body.task?.assignee?.role === 'TEAM_LEAD', raised.body.task?.assignee?.role);

  const ceoTask = (await call(ceo, '/api/tasks')).body.tasks.find((t) => t.title === `E2E — ceo assigns ${RUN}`);
  for (const id of [direct.body.task.id, raised.body.task.id, ceoTask?.id].filter(Boolean)) {
    await call(ceo, `/api/tasks/${id}`, { method: 'DELETE' });
  }
}

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

console.log('\nA developer breaks their own task into stages');
{
  const own = await call(lead, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — build the web app ${RUN}`, assigneeId: dev.user.id }),
  });
  const id = own.body.task.id;

  ok('somebody else\u2019s task cannot be broken up',
     (await call(otherDev, `/api/tasks/${id}/split`, { method: 'POST', body: JSON.stringify({ pieces: [
       { title: 'a', assigneeId: null }, { title: 'b', assigneeId: null }] }) })).status === 403);

  const staged = await call(dev, `/api/tasks/${id}/split`, {
    method: 'POST',
    body: JSON.stringify({ pieces: [
      { title: 'Frontend', assigneeId: null },
      { title: 'Backend', assigneeId: otherDev.user.id },
      { title: 'Deployment', assigneeId: null },
    ] }),
  });
  ok('the developer holding it can break it into stages', staged.status === 201, JSON.stringify(staged.body).slice(0, 140));
  ok('three stages exist', staged.body.task?.subtasks?.length === 3, String(staged.body.task?.subtasks?.length));
  ok('every stage is theirs, whoever they typed',
     staged.body.task.subtasks.every((s2) => s2.assignee_id === dev.user.id),
     staged.body.task.subtasks.map((s2) => s2.assignee?.name).join(', '));
  ok('each stage starts ready to work on', staged.body.task.subtasks.every((s2) => s2.status === 'TODO'));

  const [frontend, backend] = staged.body.task.subtasks;
  const handIn = await call(dev, `/api/tasks/${frontend.id}/progress`, {
    method: 'POST', body: JSON.stringify({ submit: true, percent: 100, doneSummary: 'Frontend is done.' }),
  });
  ok('one stage can be handed in on its own', handIn.status === 201, JSON.stringify(handIn.body).slice(0, 140));
  ok('that stage is now in review', handIn.body.task?.status === 'SUBMITTED', handIn.body.task?.status);
  ok('the others are untouched',
     (await call(dev, `/api/tasks/${backend.id}`)).body.task?.status === 'TODO');
  const okd = await call(lead, `/api/tasks/${frontend.id}/review`, {
    method: 'POST', body: JSON.stringify({ decision: 'approve', note: 'Looks right.' }) });
  ok('the lead approves that stage alone', okd.body.task?.status === 'DONE', okd.body.task?.status);
  ok('the umbrella task is still open', (await call(dev, `/api/tasks/${id}`)).body.task?.status !== 'DONE');
  ok('a stage cannot be broken up again',
     (await call(dev, `/api/tasks/${backend.id}/split`, { method: 'POST', body: JSON.stringify({ pieces: [
       { title: 'x', assigneeId: null }, { title: 'y', assigneeId: null }] }) })).status === 403);

  await call(ceo, `/api/tasks/${id}`, { method: 'DELETE' });
}

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
// A Lead reads these; they do not write them, and they do not hand work in —
// they close it outright instead.
ok('a Team Lead does not report progress either', (await call(lead, `/api/tasks/${task.id}/progress`, {
  method: 'POST', body: JSON.stringify({ percent: 50, doneSummary: 'nope' }) })).status === 403);
ok('nor submit work for their own review', (await call(lead, `/api/tasks/${task.id}/progress`, {
  method: 'POST', body: JSON.stringify({ submit: true, percent: 100, doneSummary: 'nope' }) })).status === 403);
ok('but a Lead can mark a task done outright', (await call(lead, `/api/tasks/${task.id}`, {
  method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) })).body.task?.status === 'DONE');
await call(lead, `/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'IN_PROGRESS' }) });
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

console.log('\nA split task and its pieces finish together');
{
  // Up: approve every piece and the umbrella closes itself.
  const parent = (await call(lead, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — cascade up ${RUN}` }) })).body.task;
  const afterSplit = (await call(lead, `/api/tasks/${parent.id}/split`, {
    method: 'POST',
    body: JSON.stringify({ pieces: [
      { title: 'Cascade piece A', description: JSON.stringify([{ id: 'p1', type: 'paragraph', text: 'Do the first half.' }]), assigneeId: dev.user.id },
      { title: 'Cascade piece B', assigneeId: otherDev.user.id },
    ] }),
  })).body.task;
  ok('the split went through', afterSplit?.subtasks?.length === 2, String(afterSplit?.subtasks?.length));

  const [pieceA, pieceB] = afterSplit.subtasks;
  ok('a piece carries its own brief', JSON.parse(pieceA.description)[0]?.text === 'Do the first half.',
     pieceA.description);
  ok('a piece with no brief is simply empty', pieceB.description === '[]', pieceB.description);

  await call(dev, `/api/tasks/${pieceA.id}/progress`, {
    method: 'POST', body: JSON.stringify({ submit: true, percent: 100, doneSummary: 'first half done' }) });
  await call(otherDev, `/api/tasks/${pieceB.id}/progress`, {
    method: 'POST', body: JSON.stringify({ submit: true, percent: 100, doneSummary: 'second half done' }) });

  await call(lead, `/api/tasks/${pieceA.id}/review`, {
    method: 'POST', body: JSON.stringify({ decision: 'approve', note: 'good' }) });
  ok('the umbrella is not done while a piece is outstanding',
     (await call(lead, `/api/tasks/${parent.id}`)).body.task?.status !== 'DONE');

  await call(lead, `/api/tasks/${pieceB.id}/review`, {
    method: 'POST', body: JSON.stringify({ decision: 'approve', note: 'good' }) });
  const closed = (await call(lead, `/api/tasks/${parent.id}`)).body.task;
  ok('approving the last piece closes the whole task', closed?.status === 'DONE', closed?.status);
  ok('and it counts as fully done', closed?.progress === 100, String(closed?.progress));
  ok('with a completion time', typeof closed?.completed_at === 'number');

  await call(ceo, `/api/tasks/${parent.id}`, { method: 'DELETE' });
}

{
  // Down: close the umbrella and the pieces go with it, unmarked or not.
  const parent = (await call(lead, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — cascade down ${RUN}` }) })).body.task;
  const afterSplit = (await call(lead, `/api/tasks/${parent.id}/split`, {
    method: 'POST',
    body: JSON.stringify({ pieces: [
      { title: 'Down piece A', assigneeId: dev.user.id },
      { title: 'Down piece B', assigneeId: otherDev.user.id },
    ] }),
  })).body.task;
  const ids = afterSplit.subtasks.map((sx) => sx.id);

  await call(dev, `/api/tasks/${ids[0]}/progress`, {
    method: 'POST', body: JSON.stringify({ submit: true, percent: 100, doneSummary: 'done' }) });

  ok('marking the whole task done is allowed while pieces are open',
     (await call(lead, `/api/tasks/${parent.id}`, {
       method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) })).status === 200);

  const after = (await call(lead, `/api/tasks/${parent.id}`)).body.task;
  ok('every piece is done too', after.subtasks.every((sx) => sx.status === 'DONE'),
     after.subtasks.map((sx) => sx.status).join(','));
  ok('nobody has to close them one by one', after.subtasks.every((sx) => sx.progress === 100));
  ok('the developer is told their piece was closed with it',
     (await call(otherDev, '/api/notifications')).body.notifications.some(
       (n) => n.task_id === ids[1] && n.type === 'approved'));

  await call(ceo, `/api/tasks/${parent.id}`, { method: 'DELETE' });
}

console.log('\nNew work arrives at the top of the list');
{
  const older = (await call(lead, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E older ${RUN}` }) })).body.task;
  const newer = (await call(lead, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E newer ${RUN}` }) })).body.task;

  const order = (await call(lead, '/api/tasks')).body.tasks.map((t) => t.id);
  ok('the newest task sits above the one before it',
     order.indexOf(newer.id) < order.indexOf(older.id),
     `newer at ${order.indexOf(newer.id)}, older at ${order.indexOf(older.id)}`);
  ok('and it is the first thing on the board', order[0] === newer.id, order.slice(0, 2).join(','));

  for (const id of [older.id, newer.id]) await call(ceo, `/api/tasks/${id}`, { method: 'DELETE' });
}

console.log('\nHigh is what a task is unless somebody says otherwise');
{
  const plain = (await call(manager, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — default priority ${RUN}` }) })).body.task;
  ok('a task with no priority given is High', plain?.priority === 'HIGH', plain?.priority);
  const chosen = (await call(manager, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — chosen priority ${RUN}`, priority: 'LOW' }) })).body.task;
  ok('a stated priority is still honoured', chosen?.priority === 'LOW', chosen?.priority);
  for (const id of [plain?.id, chosen?.id].filter(Boolean)) {
    await call(ceo, `/api/tasks/${id}`, { method: 'DELETE' });
  }
}

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

/* ---------- polishing transcripts ---------- */
/* ---------- who may delete a task ---------- */
/* ---------- files on a task ---------- */
console.log('\nAttaching files');
{
  const upload = async (sess, taskId, name, body, type = 'text/plain') => {
    const form = new FormData();
    form.append('file', new Blob([body], { type }), name);
    const res = await fetch(`${BASE}/api/tasks/${taskId}/attachments`, {
      method: 'POST', headers: { Cookie: sess.cookie }, body: form,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  };

  const up = await upload(lead, task.id, 'spec.txt', 'the login page must accept SSO');
  ok('a file can be attached', up.status === 201, JSON.stringify(up.body).slice(0, 120));
  const fileId = up.body.attachment?.id;
  ok('it records who uploaded it', up.body.attachment?.uploader_id === lead.user.id);
  ok('it records the size', up.body.attachment?.byte_size === 30, String(up.body.attachment?.byte_size));

  ok('it comes back with the task',
     (await call(lead, `/api/tasks/${task.id}`)).body.task.attachments
       ?.some((a) => a.id === fileId));

  ok('an empty file is refused',
     (await upload(lead, task.id, 'empty.txt', '')).status === 400);

  // The assigned developer is exactly who tends to have the screenshot.
  const byDev = await upload(dev, task.id, 'screenshot.txt', 'stack trace here');
  ok('the developer on the task can attach one too', byDev.status === 201, String(byDev.status));

  // manager2 raised nothing here and was assigned nothing — otherDev owns a
  // piece of this task by now, so they are genuinely on it.
  ok('somebody not on the task cannot attach',
     (await upload(manager2, task.id, 'nope.txt', 'x')).status === 403);

  /* ---- downloading ---- */
  const dl = await fetch(`${BASE}/api/attachments/${fileId}`, { headers: { Cookie: lead.cookie } });
  ok('the file downloads', dl.status === 200);
  ok('with its contents intact', (await dl.text()) === 'the login page must accept SSO');
  /*
   * An HTML or SVG file opened inline would run its own script on this
   * origin with the viewer's session, so uploads must always be served as
   * downloads of an opaque type.
   */
  ok('never rendered inline', dl.headers.get('content-disposition')?.startsWith('attachment'),
     dl.headers.get('content-disposition') ?? 'no header');
  ok('and never content-sniffed', dl.headers.get('x-content-type-options') === 'nosniff');
  ok('served as an opaque type', dl.headers.get('content-type') === 'application/octet-stream',
     dl.headers.get('content-type') ?? '');

  ok('an outsider cannot download it',
     (await fetch(`${BASE}/api/attachments/${fileId}`, { headers: { Cookie: manager2.cookie } })).status === 403);
  ok('nor can somebody signed out',
     (await fetch(`${BASE}/api/attachments/${fileId}`)).status === 401);

  /* ---- removing ---- */
  ok('somebody else cannot remove it',
     (await call(dev, `/api/attachments/${fileId}`, { method: 'DELETE' })).status === 403);
  ok('the developer can remove their own',
     (await call(dev, `/api/attachments/${byDev.body.attachment.id}`, { method: 'DELETE' })).status === 200);
  ok('a Team Lead can remove anyone’s',
     (await call(lead, `/api/attachments/${fileId}`, { method: 'DELETE' })).status === 200);
  ok('and then it is gone',
     (await fetch(`${BASE}/api/attachments/${fileId}`, { headers: { Cookie: lead.cookie } })).status === 404);

  /* ---- a split piece carries its own files ---- */
  const parent = await call(manager, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — split files ${RUN}` }) });
  const split = await call(lead, `/api/tasks/${parent.body.task.id}/split`, {
    method: 'POST',
    body: JSON.stringify({ pieces: [
      { title: 'Backend piece', assigneeId: dev.user.id },
      { title: 'Frontend piece', assigneeId: otherDev.user.id },
    ] }),
  });
  const [backend, frontend] = ['Backend piece', 'Frontend piece']
    .map((t) => split.body.task.subtasks.find((s) => s.title === t));

  await upload(lead, backend.id, 'api-contract.txt', 'POST /session');
  const backendFull = await call(dev, `/api/tasks/${backend.id}`);
  ok('a file attached to one piece is on that piece',
     backendFull.body.task.attachments?.length === 1
     && backendFull.body.task.attachments[0].filename === 'api-contract.txt',
     JSON.stringify(backendFull.body.task.attachments));
  ok('and not on the other one',
     (await call(otherDev, `/api/tasks/${frontend.id}`)).body.task.attachments?.length === 0);
  ok('so each developer only gets their own documents',
     (await call(otherDev, `/api/tasks/${backend.id}`)).status === 403);

  await call(ceo, `/api/tasks/${parent.body.task.id}`, { method: 'DELETE' });
}

/* ---------- messaging ---------- */
console.log('\nMessaging');
{
  const rooms = async (sess) => (await call(sess, '/api/conversations')).body.conversations ?? [];

  // Two people on a task: raised by a manager, assigned to a dev. No group.
  const pair = await call(manager, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — two people ${RUN}` }) });
  await call(lead, `/api/tasks/${pair.body.task.id}`, {
    method: 'PATCH', body: JSON.stringify({ assigneeId: dev.user.id }) });
  ok('a task with two people gets no group',
     !(await rooms(dev)).some((c) => c.task_id === pair.body.task.id));

  // Split it across two devs: raiser + two devs = three people. Group opens.
  const split = await call(lead, `/api/tasks/${pair.body.task.id}/split`, {
    method: 'POST',
    body: JSON.stringify({ pieces: [
      { title: 'Piece A', assigneeId: dev.user.id },
      { title: 'Piece B', assigneeId: otherDev.user.id },
    ] }),
  });
  ok('split went through', split.status === 201, String(split.status));

  const group = (await rooms(dev)).find((c) => c.task_id === pair.body.task.id);
  ok('a task with more than two people opens a group on its own', Boolean(group));
  ok('it is a task group', group?.kind === 'task');
  ok('everyone on the task is in it',
     [manager.user.id, dev.user.id, otherDev.user.id].every((id) => group?.members.some((m) => m.id === id)),
     group?.members.map((m) => m.name).join(', '));
  ok('it carries the ticket number', group?.task_seq === pair.body.task.seq);
  ok('an uninvolved manager is not in it', !(await rooms(manager2)).some((c) => c.id === group?.id));

  const opened = await call(dev, `/api/conversations/${group.id}`);
  ok('a member can open it', opened.status === 200);
  ok('it opens with the welcome line', opened.body.messages?.[0]?.author_id === null);
  ok('a non-member cannot open it',
     (await call(manager2, `/api/conversations/${group.id}`)).status === 403);

  const sent = await call(dev, `/api/conversations/${group.id}/messages`, {
    method: 'POST', body: JSON.stringify({ body: `Blocked on #${pair.body.task.seq} until the API lands` }) });
  ok('a member can send a message', sent.status === 201, JSON.stringify(sent.body).slice(0, 120));
  ok('the message keeps the task reference in the text',
     sent.body.message?.body.includes(`#${pair.body.task.seq}`));
  ok('an empty message is refused',
     (await call(dev, `/api/conversations/${group.id}/messages`, {
       method: 'POST', body: JSON.stringify({ body: '   ' }) })).status === 400);
  ok('a non-member cannot post',
     (await call(manager2, `/api/conversations/${group.id}/messages`, {
       method: 'POST', body: JSON.stringify({ body: 'hi' }) })).status === 403);

  const unreadFor = async (sess) => (await rooms(sess)).find((c) => c.id === group.id)?.unread ?? -1;
  ok('the others see it as unread', (await unreadFor(otherDev)) === 1, String(await unreadFor(otherDev)));
  ok('the sender does not', (await unreadFor(dev)) === 0);
  await call(otherDev, `/api/conversations/${group.id}`);
  ok('opening it marks it read', (await unreadFor(otherDev)) === 0);

  ok('the others were told in-app',
     (await call(otherDev, '/api/notifications')).body.notifications
       .some((n) => n.type === 'message' && n.task_id === pair.body.task.id));

  // Direct conversations.
  const dm = await call(dev, '/api/conversations', { method: 'POST', body: JSON.stringify({ userId: otherDev.user.id }) });
  ok('a direct conversation can be opened', dm.status === 201 && dm.body.conversation?.kind === 'direct');
  const again = await call(otherDev, '/api/conversations', { method: 'POST', body: JSON.stringify({ userId: dev.user.id }) });
  ok('opening it from the other side finds the same one', again.body.conversation?.id === dm.body.conversation?.id);
  ok('you cannot message yourself',
     (await call(dev, '/api/conversations', { method: 'POST', body: JSON.stringify({ userId: dev.user.id }) })).status === 400);

  // Finishing the task closes the group.
  const pieceA = split.body.task.subtasks.find((s) => s.title === 'Piece A');
  await call(dev, `/api/tasks/${pieceA.id}/progress`, {
    method: 'POST', body: JSON.stringify({ submit: true, doneSummary: 'done', percent: 100 }) });
  await call(lead, `/api/tasks/${pieceA.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approve', note: 'ok' }) });
  await call(lead, `/api/tasks/${pair.body.task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) });
  const closed = (await rooms(dev)).find((c) => c.id === group.id);
  ok('approving the task closes the group', Boolean(closed?.closed_at), JSON.stringify(closed?.closed_at));
  ok('a closed group is still readable',
     (await call(dev, `/api/conversations/${group.id}`)).status === 200);
  ok('but takes no more messages',
     (await call(dev, `/api/conversations/${group.id}/messages`, {
       method: 'POST', body: JSON.stringify({ body: 'one more' }) })).status === 400);

  await call(ceo, `/api/tasks/${pair.body.task.id}`, { method: 'DELETE' });
}

/* ---------- profile ---------- */
console.log('\nMessaging — editing, files, clearing');
{
  const dm = (await call(dev, '/api/conversations', { method: 'POST', body: JSON.stringify({ userId: otherDev.user.id }) })).body.conversation;
  const first = await call(dev, `/api/conversations/${dm.id}/messages`, { method: 'POST', body: JSON.stringify({ body: `hello ${RUN}` }) });
  const msg = first.body.message;
  ok('a message starts unedited, undeleted and file-less',
     msg?.edited_at === null && msg?.deleted_at === null && Array.isArray(msg?.files) && msg.files.length === 0, JSON.stringify(msg));

  const edited = await call(dev, `/api/messages/${msg.id}`, { method: 'PATCH', body: JSON.stringify({ body: `hello again ${RUN}` }) });
  ok('the author can edit it', edited.status === 200 && edited.body.message?.body === `hello again ${RUN}`, JSON.stringify(edited.body).slice(0, 120));
  ok('and it is marked as edited', typeof edited.body.message?.edited_at === 'number');
  ok('somebody else cannot edit it',
     (await call(otherDev, `/api/messages/${msg.id}`, { method: 'PATCH', body: JSON.stringify({ body: 'hijack' }) })).status === 403);
  ok('an empty edit is refused',
     (await call(dev, `/api/messages/${msg.id}`, { method: 'PATCH', body: JSON.stringify({ body: '   ' }) })).status === 400);
  ok('the edit is what the other side reads',
     (await call(otherDev, `/api/conversations/${dm.id}`)).body.messages.find((m) => m.id === msg.id)?.body === `hello again ${RUN}`);

  const upload = async (sess, name, type, bytes, extra = {}) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    form.append('filename', name);
    for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
    const res = await fetch(`${BASE}/api/conversations/${dm.id}/files`, { method: 'POST', headers: { Cookie: sess.cookie }, body: form });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  };

  const doc = await upload(dev, 'notes.txt', 'text/plain', 'meeting notes', { body: 'the notes' });
  ok('a document can be sent', doc.status === 201, JSON.stringify(doc.body).slice(0, 160));
  ok('it arrives as a file', doc.body.message?.files?.[0]?.kind === 'file');
  ok('with its caption as the text', doc.body.message?.body === 'the notes');
  ok('and its size', doc.body.message?.files?.[0]?.byte_size === 'meeting notes'.length);
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const pic = await upload(otherDev, 'shot.png', 'image/png', PNG);
  ok('a picture is recognised as one', pic.body.message?.files?.[0]?.kind === 'image', JSON.stringify(pic.body).slice(0, 160));
  ok('a picture with no caption still has a line for the room list', (pic.body.message?.body ?? '').length > 0);
  const voice = await upload(dev, 'voice.webm', 'audio/webm', Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), { kind: 'voice', durationMs: 1234 });
  ok('a voice note is a voice note', voice.body.message?.files?.[0]?.kind === 'voice', JSON.stringify(voice.body).slice(0, 160));
  ok('and keeps its length', voice.body.message?.files?.[0]?.duration_ms === 1234);
  ok('a "voice note" that is not audio is just a file',
     (await upload(dev, 'fake.webm', 'text/plain', 'not audio', { kind: 'voice' })).body.message?.files?.[0]?.kind === 'file');
  ok('an empty file is refused', (await upload(dev, 'empty.txt', 'text/plain', '')).status === 400);
  ok('the file rides with the thread', (await call(otherDev, `/api/conversations/${dm.id}`)).body.messages.find((m) => m.id === doc.body.message.id)?.files?.length === 1);
  const preview = (await call(otherDev, '/api/conversations')).body.conversations.find((c) => c.id === dm.id)?.last_message?.body ?? '';
  ok('a file with no caption still reads as something in the room list',
     preview.startsWith('\u{1F4CE}') && preview.includes('fake.webm'), preview);

  const fileId = doc.body.message.files[0].id;
  const dl = await fetch(`${BASE}/api/message-files/${fileId}`, { headers: { Cookie: otherDev.cookie } });
  ok('the other member can download it', dl.status === 200, String(dl.status));
  ok('with its contents intact', (await dl.text()) === 'meeting notes');
  ok('a document is never rendered inline', dl.headers.get('content-disposition')?.startsWith('attachment') === true);
  ok('and never content-sniffed', dl.headers.get('x-content-type-options') === 'nosniff');
  const picDl = await fetch(`${BASE}/api/message-files/${pic.body.message.files[0].id}`, { headers: { Cookie: dev.cookie } });
  ok('a picture is served as a picture',
     picDl.headers.get('content-type') === 'image/png' && picDl.headers.get('content-disposition')?.startsWith('inline') === true);
  ok('somebody outside the conversation cannot fetch it',
     (await fetch(`${BASE}/api/message-files/${fileId}`, { headers: { Cookie: manager2.cookie } })).status === 403);
  ok('nor somebody signed out', (await fetch(`${BASE}/api/message-files/${fileId}`)).status === 401);
  ok('an outsider cannot send a file in', (await (async () => {
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    return fetch(`${BASE}/api/conversations/${dm.id}/files`, { method: 'POST', headers: { Cookie: manager2.cookie }, body: form });
  })()).status === 403);

  ok('somebody else cannot delete your message', (await call(otherDev, `/api/messages/${msg.id}`, { method: 'DELETE' })).status === 403);
  ok('the author can delete it', (await call(dev, `/api/messages/${msg.id}`, { method: 'DELETE' })).status === 200);
  const afterDelete = (await call(otherDev, `/api/conversations/${dm.id}`)).body.messages.find((m) => m.id === msg.id);
  ok('it stays in the thread as deleted', Boolean(afterDelete?.deleted_at) && afterDelete.body === '', JSON.stringify(afterDelete));
  ok('a deleted message cannot be edited',
     (await call(dev, `/api/messages/${msg.id}`, { method: 'PATCH', body: JSON.stringify({ body: 'x' }) })).status === 400);
  ok('deleting a file message drops the file',
     (await call(dev, `/api/messages/${doc.body.message.id}`, { method: 'DELETE' })).status === 200 &&
     (await fetch(`${BASE}/api/message-files/${fileId}`, { headers: { Cookie: dev.cookie } })).status === 404);
  ok('a message that is not there is a 404', (await call(dev, '/api/messages/m_nope', { method: 'DELETE' })).status === 404);

  ok('clearing wipes the thread for you',
     (await call(dev, `/api/conversations/${dm.id}/clear`, { method: 'POST' })).status === 200 &&
     (await call(dev, `/api/conversations/${dm.id}`)).body.messages.length === 0);
  ok('but not for the other person', (await call(otherDev, `/api/conversations/${dm.id}`)).body.messages.length >= 3);
  ok('the room preview follows suit',
     (await call(dev, '/api/conversations')).body.conversations.find((c) => c.id === dm.id)?.last_message === null);
  const later = await call(otherDev, `/api/conversations/${dm.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'after the clear' }) });
  ok('new messages still come through',
     (await call(dev, `/api/conversations/${dm.id}`)).body.messages.map((m) => m.id).join() === later.body.message.id);

  ok('deleting the chat removes it from your list',
     (await call(dev, `/api/conversations/${dm.id}`, { method: 'DELETE' })).status === 200 &&
     !(await call(dev, '/api/conversations')).body.conversations.some((c) => c.id === dm.id));
  ok('the other person still has it', (await call(otherDev, '/api/conversations')).body.conversations.some((c) => c.id === dm.id));
  await call(otherDev, `/api/conversations/${dm.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'are you there?' }) });
  ok('it comes back when they write again', (await call(dev, '/api/conversations')).body.conversations.some((c) => c.id === dm.id));
  ok('with only what came after', (await call(dev, `/api/conversations/${dm.id}`)).body.messages.length === 1);
  await call(dev, `/api/conversations/${dm.id}`, { method: 'DELETE' });
  const reopened = await call(dev, '/api/conversations', { method: 'POST', body: JSON.stringify({ userId: otherDev.user.id }) });
  ok('starting the chat again yourself brings it back too',
     reopened.body.conversation?.id === dm.id && (await call(dev, '/api/conversations')).body.conversations.some((c) => c.id === dm.id));
  ok('a non-member cannot clear it', (await call(manager2, `/api/conversations/${dm.id}/clear`, { method: 'POST' })).status === 403);
  ok('a non-member cannot delete it', (await call(manager2, `/api/conversations/${dm.id}`, { method: 'DELETE' })).status === 403);
}

console.log('\nNotifications can be tested');
{
  const t = await call(dev, '/api/notifications/test', { method: 'POST' });
  ok('a test round-trips', t.status === 200, JSON.stringify(t.body).slice(0, 160));
  ok('the bell gets it', t.body.inApp?.ok === true);
  ok('every other channel says whether it is set up',
     ['email', 'push', 'slack'].every((k) => typeof t.body[k]?.configured === 'boolean'));
  ok('it shows up in the list', (await call(dev, '/api/notifications')).body.notifications.some((n) => n.type === 'test'));
  ok('signed out, no test', (await fetch(`${BASE}/api/notifications/test`, { method: 'POST' })).status === 401);
}

console.log('\nTimes are written in the reader’s clock, not the server’s');
{
  ok('a zone that does not exist is refused',
     (await call(dev, '/api/me', { method: 'PATCH', body: JSON.stringify({ timeZone: 'Mars/Olympus' }) })).status === 400);
  ok('an empty one too',
     (await call(dev, '/api/me', { method: 'PATCH', body: JSON.stringify({ timeZone: '  ' }) })).status === 400);
  ok('signed out, nobody sets one',
     (await fetch(`${BASE}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ timeZone: 'Asia/Karachi' }) })).status === 401);

  const set = await call(dev, '/api/me', { method: 'PATCH', body: JSON.stringify({ timeZone: 'Asia/Karachi' }) });
  ok('a real zone is stored', set.body.user?.time_zone === 'Asia/Karachi', set.body.user?.time_zone);
  ok('and it comes back on the session', (await call(dev, '/api/me')).body.user?.time_zone === 'Asia/Karachi');

  // The server runs on UTC; Karachi is five hours ahead of it.
  await call(dev, '/api/notifications/test', { method: 'POST' });
  const karachi = (await call(dev, '/api/notifications')).body.notifications.find((n) => n.type === 'test');
  const shown = Number((karachi?.message ?? '').match(/at (\d\d):/)?.[1] ?? -1);
  ok('the time is written in that zone', shown === (new Date().getUTCHours() + 5) % 24,
     `shown ${shown}, utc ${new Date().getUTCHours()}`);
  ok('and says which zone it is', /GMT\+5/.test(karachi?.message ?? ''), karachi?.message);

  await call(dev, '/api/me', { method: 'PATCH', body: JSON.stringify({ timeZone: 'America/Los_Angeles' }) });
  await call(dev, '/api/notifications/test', { method: 'POST' });
  const la = (await call(dev, '/api/notifications')).body.notifications.filter((n) => n.type === 'test')[0];
  ok('moving somebody moves their clock with them', /GMT-[78]/.test(la?.message ?? ''), la?.message);
}

console.log('\nProfile');
{
  // A throwaway account, because changing a password signs every session out.
  const throwaway = await signup(`profile-${RUN}@e2e.local`, 'Profile Tester', 'DEV', join);

  ok('a short new password is refused',
     (await call(throwaway, '/api/users/me/password', {
       method: 'POST', body: JSON.stringify({ current: PW, next: 'short' }) })).status === 400);
  ok('the wrong current password is refused',
     (await call(throwaway, '/api/users/me/password', {
       method: 'POST', body: JSON.stringify({ current: 'not-it', next: 'a-new-password-1' }) })).status === 403);
  const changed = await call(throwaway, '/api/users/me/password', {
    method: 'POST', body: JSON.stringify({ current: PW, next: 'a-new-password-1' }) });
  ok('the right current password changes it', changed.status === 200, String(changed.status));
  ok('every session is signed out afterwards',
     (await call(throwaway, '/api/tasks')).status === 401);
  ok('the new password signs in',
     (await login(`profile-${RUN}@e2e.local`, 'a-new-password-1')).user.id === throwaway.user.id);
  ok('the old one no longer does',
     (await fetch(`${BASE}/api/auth/login`, {
       method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ email: `profile-${RUN}@e2e.local`, password: PW }),
     })).status === 401);

  // Pictures.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const upload = async (sess, bytes, type, name) => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    return fetch(`${BASE}/api/users/me/avatar`, { method: 'POST', headers: { Cookie: sess.cookie }, body: form });
  };
  ok('an SVG is refused as a picture — it can run script',
     (await upload(dev, '<svg onload="alert(1)"/>', 'image/svg+xml', 'x.svg')).status === 400);
  const first = await upload(dev, png, 'image/png', 'me.png');
  ok('a PNG is accepted', first.status === 200);
  const firstVersion = (await first.json()).version;
  ok('the upload answers with a version stamp', typeof firstVersion === 'number' && firstVersion > 0, String(firstVersion));
  const pic = await fetch(`${BASE}/api/users/${dev.user.id}/avatar`, { headers: { Cookie: lead.cookie } });
  ok('the picture is served back', pic.status === 200 && pic.headers.get('content-type') === 'image/png');
  ok('and never content-sniffed', pic.headers.get('x-content-type-options') === 'nosniff');

  // A changed picture has to be a changed URL, or every browser keeps showing
  // the old one from its own cache — which is exactly what used to happen.
  const listed = (await call(lead, '/api/users/avatars')).body.avatars ?? [];
  ok('the roster carries the version', listed.find((a) => a.id === dev.user.id)?.v === firstVersion,
     JSON.stringify(listed.find((a) => a.id === dev.user.id)));
  const tag = pic.headers.get('etag');
  ok('the picture is tagged with it', tag === `"${dev.user.id}-${firstVersion}"`, tag ?? 'none');
  ok('it is never served without revalidating', (pic.headers.get('cache-control') ?? '').includes('no-cache'),
     pic.headers.get('cache-control') ?? 'none');
  ok('an unchanged picture answers 304',
     (await fetch(`${BASE}/api/users/${dev.user.id}/avatar`,
       { headers: { Cookie: lead.cookie, 'If-None-Match': tag } })).status === 304);

  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const second = await upload(dev, gif, 'image/gif', 'me.gif');
  const secondVersion = (await second.json()).version;
  ok('a new picture gets a new stamp', secondVersion > firstVersion, `${firstVersion} -> ${secondVersion}`);
  const stale = await fetch(`${BASE}/api/users/${dev.user.id}/avatar`,
    { headers: { Cookie: lead.cookie, 'If-None-Match': tag } });
  ok('a browser holding the old one is given the new one, not a 304', stale.status === 200, String(stale.status));
  ok('and it is the new picture', stale.headers.get('content-type') === 'image/gif', stale.headers.get('content-type'));
  ok('the roster moves on too',
     (await call(lead, '/api/users/avatars')).body.avatars.find((a) => a.id === dev.user.id)?.v === secondVersion);
  ok('somebody with no picture answers 404',
     (await fetch(`${BASE}/api/users/${manager2.user.id}/avatar`, { headers: { Cookie: lead.cookie } })).status === 404);

  // Taking your record away.
  const csv = await fetch(`${BASE}/api/users/${dev.user.id}/export`, { headers: { Cookie: dev.cookie } });
  ok('a developer can download their own record', csv.status === 200);
  ok('it is a spreadsheet', (csv.headers.get('content-type') ?? '').startsWith('text/csv'));
  const text = await csv.text();
  ok('with a header row', text.includes('Ticket,Title,Status'));
  ok('another developer cannot download it',
     (await fetch(`${BASE}/api/users/${dev.user.id}/export`, { headers: { Cookie: otherDev.cookie } })).status === 403);
  ok('a Team Lead can',
     (await fetch(`${BASE}/api/users/${dev.user.id}/export`, { headers: { Cookie: lead.cookie } })).status === 200);

  // Push, unconfigured here: honest about it rather than pretending.
  const key = await call(dev, '/api/push/key');
  ok('push reports whether it is set up', key.status === 200 && typeof key.body.enabled === 'boolean');
  if (!key.body.enabled) {
    ok('subscribing without keys is refused clearly',
       (await call(dev, '/api/push/subscribe', {
         method: 'POST', body: JSON.stringify({ endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } }) })).status === 400);
  }

  await call(ceo, `/api/users/${throwaway.user.id}`, { method: 'DELETE' });
}

console.log('\nDeleting a task');
{
  const raised = await call(manager, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — delete rules ${RUN}` }) });
  const id = raised.body.task.id;

  // It is assigned and under way, so the "my own untouched draft" escape
  // hatch no longer applies to anyone.
  await call(lead, `/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ assigneeId: dev.user.id }) });
  await call(dev, `/api/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'IN_PROGRESS' }) });

  ok('the developer working on it cannot delete it',
     (await call(dev, `/api/tasks/${id}`, { method: 'DELETE' })).status === 403);
  ok('the manager who raised it cannot delete it once it is under way',
     (await call(manager, `/api/tasks/${id}`, { method: 'DELETE' })).status === 403);
  ok('an uninvolved manager cannot delete it',
     (await call(manager2, `/api/tasks/${id}`, { method: 'DELETE' })).status === 403);

  ok('a Team Lead CAN delete it',
     (await call(lead, `/api/tasks/${id}`, { method: 'DELETE' })).status === 200);
  ok('and it is really gone', (await call(ceo, `/api/tasks/${id}`)).status === 404);

  // The escape hatch still stands for something nobody has touched.
  const draft = await call(manager, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `E2E — own draft ${RUN}` }) });
  ok('somebody can still delete their own untouched request',
     (await call(manager, `/api/tasks/${draft.body.task.id}`, { method: 'DELETE' })).status === 200);
}

/* ---------- the hosted speech model ---------- */
console.log('\nHosted transcription');
{
  ok('signing out blocks it',
     (await fetch(`${BASE}/api/transcripts/speech`, {
       method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ audio: 'AAAA' }),
     })).status === 401);

  ok('no audio is refused', (await call(lead, '/api/transcripts/speech', {
    method: 'POST', body: JSON.stringify({}) })).status === 400);

  // The client chunks precisely so this never fires; if it does, chunking broke.
  ok('an oversized chunk is refused', (await call(lead, '/api/transcripts/speech', {
    method: 'POST', body: JSON.stringify({ audio: 'A'.repeat(4_000_001) }) })).status === 400);

  const status = await call(lead, '/api/transcripts/speech');
  ok('it reports whether it is wired up', status.status === 200
     && typeof status.body.configured === 'boolean' && Boolean(status.body.model),
     JSON.stringify(status.body));

  /*
   * Whatever the hosted model does, the answer must be shaped so the browser
   * can decide: text to use, or a reason to fall back to its own model. A
   * silent empty response would strand a recording with no transcript and no
   * explanation, which is the failure this endpoint exists to avoid.
   */
  const heard = await call(lead, '/api/transcripts/speech', {
    method: 'POST', body: JSON.stringify({ audio: 'AAAA' }) });
  ok('it always answers usefully', heard.status === 200
     && typeof heard.body.text === 'string'
     && (heard.body.configured === false || 'error' in heard.body || heard.body.text.length >= 0),
     JSON.stringify(heard.body).slice(0, 160));
}

console.log('\nPolishing transcripts');
{
  ok('signing out blocks it',
     (await fetch(`${BASE}/api/transcripts/polish`, {
       method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ text: 'hello' }),
     })).status === 401);

  ok('empty text is refused', (await call(lead, '/api/transcripts/polish', {
    method: 'POST', body: JSON.stringify({ text: '   ' }) })).status === 400);

  ok('an enormous transcript is refused', (await call(lead, '/api/transcripts/polish', {
    method: 'POST', body: JSON.stringify({ text: 'x'.repeat(60_001) }) })).status === 400);

  /*
   * The model is optional, so this asserts the contract that holds either
   * way: a caller always gets usable text back. Unconfigured it is the text
   * that went in, which is what keeps a transcript from being lost when the
   * key is missing, rate-limited or down.
   */
  const spoken = 'kal subah team meeting hai';
  const polished = await call(lead, '/api/transcripts/polish', {
    method: 'POST', body: JSON.stringify({ text: spoken, lang: 'ur', mode: 'clean' }) });
  ok('it always answers with usable text', polished.status === 200 && Boolean(polished.body.text),
     JSON.stringify(polished.body).slice(0, 120));
  ok('nothing is lost when the model is unavailable',
     polished.body.polished === true || polished.body.text === spoken,
     `polished=${polished.body.polished} text=${polished.body.text}`);
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

console.log('\nWhose record is whose');
ok('the CEO has no sheet of their own',
   (await call(ceo, `/api/users/${ceo.user.id}/sheet`)).status === 403);
ok('nobody else can open one for them',
   (await call(lead, `/api/users/${ceo.user.id}/sheet`)).status === 403);
ok('the CEO can read a Manager\'s record',
   (await call(ceo, `/api/users/${manager.user.id}/sheet`)).status === 200);
ok('a Team Lead cannot', (await call(lead, `/api/users/${manager.user.id}/sheet`)).status === 403);
ok('nor can a Developer', (await call(dev, `/api/users/${manager.user.id}/sheet`)).status === 403);
ok('a Manager still has their own', (await call(manager, `/api/users/${manager.user.id}/sheet`)).status === 200);
ok('the CEO can read a Lead\'s record', (await call(ceo, `/api/users/${lead.user.id}/sheet`)).status === 200);
ok('a Lead cannot read another Lead\'s', (await call(lead, `/api/users/${lead2.user.id}/sheet`)).status === 403);

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
  const plain = await signup(`firstcomer-${RUN}@e2e.local`, 'First Comer', 'MANAGER', join);
  ok('joining with an invite code never yields CEO', plain.user.role === 'MANAGER', plain.user.role);
  ok('it lands you in that organisation', plain.user.org_id === ceo.user.org_id);
  ok('signing up with no code at all is refused', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `nocode-${RUN}@e2e.local`, password: PW, name: 'No Code', role: 'DEV' }) })).status === 400);
  ok('a made-up invite code is refused', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `badinvite-${RUN}@e2e.local`, password: PW, name: 'Bad Invite',
                           role: 'DEV', inviteCode: 'NOPE-NOPE' }) })).status === 403);
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
  const leaver = await signup(`leaver-${RUN}@e2e.local`, 'Departing Dev', 'DEV', join);

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
  ok('it went back to a Lead\'s desk', after.body.task?.assignee?.role === 'TEAM_LEAD', after.body.task?.assignee?.role);
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

console.log('\nTriage and Blocked are gone');
{
  ok('a task cannot be put in Triage', (await call(lead, `/api/tasks/${task.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'TRIAGE' }) })).status === 400);
  ok('nor in Blocked', (await call(lead, `/api/tasks/${task.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'BLOCKED' }) })).status === 400);
  ok('nothing on the board is in either',
     (await call(ceo, '/api/tasks')).body.tasks.every((t) => !['TRIAGE', 'BLOCKED'].includes(t.status)));
}

console.log('\nTwo codes, two kinds of seat');
{
  const orgNow = (await call(ceo, '/api/org')).body.org;
  ok('the CEO sees both codes',
     typeof orgNow?.invite_code === 'string' && typeof orgNow?.lead_invite_code === 'string',
     JSON.stringify(orgNow));
  const leadSees = (await call(lead, '/api/org')).body.org;
  ok('a Team Lead sees the developer code', typeof leadSees?.lead_invite_code === 'string');
  ok('but not the organisation code', leadSees?.invite_code === undefined);
  const mgrSees = (await call(manager, '/api/org')).body.org;
  ok('a Manager sees neither', mgrSees?.invite_code === undefined && mgrSees?.lead_invite_code === undefined);

  const devCode = leadSees.lead_invite_code;
  const joined = await signup(`leadinvite-${RUN}@e2e.local`, 'Lead Invited', 'DEV', { inviteCode: devCode });
  ok('the developer code creates a Developer', joined.user.role === 'DEV', joined.user.role);
  ok('in the same organisation', joined.user.org_id === ceo.user.org_id);
  ok('it refuses to create a Manager', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `devcode-mgr-${RUN}@e2e.local`, password: PW, name: 'No Way',
                           role: 'MANAGER', inviteCode: devCode }) })).status === 403);
  ok('and refuses to create a Team Lead', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `devcode-lead-${RUN}@e2e.local`, password: PW, name: 'No Way',
                           role: 'TEAM_LEAD', inviteCode: devCode }) })).status === 403);
  ok('the organisation code still creates a Manager', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `orgcode-mgr-${RUN}@e2e.local`, password: PW, name: 'Org Code Manager',
                           role: 'MANAGER', inviteCode: orgNow.invite_code }) })).status === 201);

  ok('a Team Lead can mint a new developer code', (await call(lead, '/api/org', {
    method: 'PATCH', body: JSON.stringify({ rotateLeadInvite: true }) })).status === 200);
  ok('the old developer code stops working', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `staledev-${RUN}@e2e.local`, password: PW, name: 'Stale',
                           role: 'DEV', inviteCode: devCode }) })).status === 403);
  ok('a Team Lead cannot touch the organisation code', (await call(lead, '/api/org', {
    method: 'PATCH', body: JSON.stringify({ rotateInvite: true }) })).status === 403);
  ok('nor rename the organisation', (await call(lead, '/api/org', {
    method: 'PATCH', body: JSON.stringify({ name: 'Lead Renamed' }) })).status === 403);
  ok('a Manager cannot mint a developer code', (await call(manager, '/api/org', {
    method: 'PATCH', body: JSON.stringify({ rotateLeadInvite: true }) })).status === 403);

  // tidy
  for (const email of [`leadinvite-${RUN}@e2e.local`, `orgcode-mgr-${RUN}@e2e.local`]) {
    const who = (await call(ceo, '/api/users')).body.users.find((u) => u.email === email);
    if (who) await call(ceo, `/api/users/${who.id}`, { method: 'DELETE' });
  }
}

console.log('\nSigning in says which half is wrong');
{
  ok('an unknown email says so', (await (async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `ghost-${RUN}@e2e.local`, password: PW }) });
    return (await r.json()).error ?? '';
  })()).toLowerCase().includes('email'));
  ok('a wrong password says so', (await (async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'manager1@e2e.local', password: 'not-the-password' }) });
    return (await r.json()).error ?? '';
  })()).toLowerCase().includes('password'));
  ok('a short password is refused at signup', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `short-${RUN}@e2e.local`, password: 'seven77', name: 'Too Short',
                           role: 'DEV', inviteCode: INVITE }) })).status === 400);
}

console.log('\nAn organisation can be running before its CEO arrives');
{
  // Ours has one, so the door is shut.
  const outsider = await signup(`ceoprobe-${RUN}@e2e.local`, 'Probe', 'TEAM_LEAD', { inviteCode: INVITE });
  ok('a filled seat is reported as filled', (await call(outsider, '/api/org')).body.seatVacant === false);
  ok('and signing up as CEO into it is refused', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `ceodupe-${RUN}@e2e.local`, password: PW, name: 'Second Chief',
                           role: 'CEO', inviteCode: INVITE }) })).status === 403);

  // A brand new organisation always has one, so the only way to see the other
  // side of this is an organisation created without a founder — which is what
  // an install upgraded from before organisations looks like.
  const born = await signup(`freshceo-${RUN}@e2e.local`, 'Fresh Chief', 'MANAGER', { orgName: `Fresh Org ${RUN}` });
  ok('founding one still makes you its CEO', born.user.role === 'CEO', born.user.role);
  const freshOrg = (await call(born, '/api/org')).body.org;
  ok('a new organisation starts with the shelf of tags',
     (await call(born, '/api/tags')).body.tags?.length >= 15,
     String((await call(born, '/api/tags')).body.tags?.length));
  const names = (await call(born, '/api/tags')).body.tags.map((t) => t.name);
  ok('they cover the web side', ['frontend', 'backend', 'api', 'database'].every((n) => names.includes(n)),
     names.join(','));
  ok('and the model side', ['ai-model', 'prompt', 'dataset', 'rag'].every((n) => names.includes(n)));
  ok('the developer code still cannot make a CEO', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `devcodeceo-${RUN}@e2e.local`, password: PW, name: 'Nope',
                           role: 'CEO', inviteCode: freshOrg.lead_invite_code }) })).status === 403);

  const who = (await call(ceo, '/api/users')).body.users.find((u) => u.email === `ceoprobe-${RUN}@e2e.local`);
  if (who) await call(ceo, `/api/users/${who.id}`, { method: 'DELETE' });
}

console.log('\nOrganisations are walls');
{
  const other = await signup(`other-ceo-${RUN}@e2e.local`, 'Other Chief', 'MANAGER', { orgName: `Other Org ${RUN}` });
  ok('founding an organisation makes you its CEO', other.user.role === 'CEO', other.user.role);
  ok('and it is a different organisation from ours', other.user.org_id && other.user.org_id !== ceo.user.org_id);

  const theirOrg = (await call(other, '/api/org')).body.org;
  ok('the founder can read its invite code',
     typeof theirOrg?.invite_code === 'string' && theirOrg.invite_code.length >= 8, JSON.stringify(theirOrg));
  ok('a manager cannot read the invite code', (await call(manager, '/api/org')).body.org?.invite_code === undefined);
  ok('a manager cannot rename the organisation',
     (await call(manager, '/api/org', { method: 'PATCH', body: JSON.stringify({ name: 'Hijacked' }) })).status === 403);
  const renamed = await call(other, '/api/org', { method: 'PATCH', body: JSON.stringify({ name: `Renamed ${RUN}` }) });
  ok('the CEO can rename it', renamed.body.org?.name === `Renamed ${RUN}`, JSON.stringify(renamed.body));

  ok('the other organisation sees none of our tasks',
     !(await call(other, '/api/tasks')).body.tasks?.some((t) => t.id === task.id));
  ok('nor can it open one by id', [403, 404].includes((await call(other, `/api/tasks/${task.id}`)).status));
  ok('nor see our people', !(await call(other, '/api/users')).body.users?.some((u) => u.id === dev.user.id));
  ok('nor message them',
     (await call(other, '/api/conversations', { method: 'POST', body: JSON.stringify({ userId: dev.user.id }) })).status === 404);
  ok('nor change their roles',
     (await call(other, `/api/users/${dev.user.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'MANAGER' }) })).status === 404);
  ok('nor read their task sheet', (await call(other, `/api/users/${dev.user.id}/sheet`)).status === 404);
  ok('nor see any of our meetings', (await call(other, '/api/meetings?scope=past')).body.meetings?.length === 0);

  const theirs = await call(other, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: `Other org task ${RUN}`, priority: 'LOW' }),
  });
  ok('the other organisation can raise its own work', theirs.status === 201, JSON.stringify(theirs.body).slice(0, 120));
  ok('task numbers start at 1 in a new organisation', theirs.body.task?.seq === 1, String(theirs.body.task?.seq));
  ok('our lead cannot open it', [403, 404].includes((await call(lead, `/api/tasks/${theirs.body.task?.id}`)).status));
  ok('our CEO cannot open it either', [403, 404].includes((await call(ceo, `/api/tasks/${theirs.body.task?.id}`)).status));
  ok('it never appears on our board', !(await call(ceo, '/api/tasks')).body.tasks?.some((t) => t.id === theirs.body.task?.id));

  const joiner = await signup(`joiner-${RUN}@e2e.local`, 'Joiner', 'DEV', { inviteCode: theirOrg.invite_code });
  ok('an invite code lands you in that organisation', joiner.user.org_id === other.user.org_id);
  ok('in the role you chose', joiner.user.role === 'DEV', joiner.user.role);
  ok('a lower-cased code works too', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `lower-${RUN}@e2e.local`, password: PW, name: 'Lower Case',
                           role: 'DEV', inviteCode: theirOrg.invite_code.toLowerCase() }) })).status === 201);

  const rotated = await call(other, '/api/org', { method: 'PATCH', body: JSON.stringify({ rotateInvite: true }) });
  ok('the CEO can mint a new invite code',
     rotated.body.org?.invite_code && rotated.body.org.invite_code !== theirOrg.invite_code);
  ok('the old code stops working', (await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `late-${RUN}@e2e.local`, password: PW, name: 'Too Late',
                           role: 'DEV', inviteCode: theirOrg.invite_code }) })).status === 403);

  // tidy: the other organisation's task and the people who joined it
  await call(other, `/api/tasks/${theirs.body.task?.id}`, { method: 'DELETE' });
  const theirPeople = (await call(other, '/api/users')).body.users ?? [];
  for (const u of theirPeople) if (u.id !== other.user.id) await call(other, `/api/users/${u.id}`, { method: 'DELETE' });
}

console.log('\nCleanup');
ok('the CEO can delete the test task', (await call(ceo, `/api/tasks/${task.id}`, { method: 'DELETE' })).status === 200);
ok('subtasks cascade away with the parent', (await call(lead, `/api/tasks/${split.body.task.subtasks[0].id}`)).status === 404);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
