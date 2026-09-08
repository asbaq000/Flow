# Flow — a Notion-style task manager with a real chain of command

A block-editor task manager built around one rule: **work flows down the hierarchy and nothing gets lost.**

Runs entirely on your machine. No cloud account, no API keys, no monthly bill.

---

## Start it

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:3000>.

The workspace starts **empty**. The first person chooses **Start an organisation** on the signup form, names it, and becomes its **CEO**. Everyone else picks **Join with a code**, enters the invite code the CEO hands out (it is on the CEO's profile page, alongside a button to mint a fresh one), and chooses **Manager**, **Team Lead** or **Developer**. The CEO can adjust roles from the People page afterwards.

One install can hold **many organisations**. Each is a wall: its people, tasks, tags, meetings and messages are invisible to every other organisation, and task numbers count from TSK-1 inside each one.

If you are upgrading an install from before organisations existed, everything already in it is adopted into one organisation called “My organization” on the first request — rename it from the CEO's profile page. The old `CEO_SETUP_CODE` route still works for that upgraded organisation only.

Other commands:

```bash
npm run build
```

```bash
npm test
```

`npm test` runs the end-to-end suite against a running server (start it with `CEO_SETUP_CODE=e2e-setup-code`, or set `CEO_SETUP_CODE` to match — only the legacy-path checks need it). It creates its own accounts on `@e2e.local` and deletes every task it makes — **run it locally, never against production**, or you will be left with test accounts to clean up.

---

## The hierarchy

This is the part that isn't Notion. Roles aren't labels — they're enforced on the server, on every request.

```
                     CEO                     full oversight, manages roles
                      │
Manager ──raises──▶ Team Lead ──assigns──▶ Developer
                      ▲   (Devs only)          │
                      └──── submits for ───────┘
                              review
```

Four roles, and only four. Every task starts on a Team Lead's desk — there is no path that skips triage. And nothing reaches **Done** without a Lead approving it.

**1. A Manager raises a task.** Nobody picks an assignee — not even a Team Lead raising their own. Every task routes automatically to the Team Lead with the lightest open load and lands in **Triage**. If no Team Lead exists yet, it routes to the CEO so work is never orphaned.

**2. The Team Lead triages it.** They assign it **only to a Developer** — which pulls it out of Triage into To Do — or they **split** it into several pieces, each its own task assigned to its own Developer. Handing work to a Manager or another Lead is rejected by the server. The parent becomes an umbrella that tracks progress across all of them.

**3. The Developer executes.** They report progress, move their task as far as *Submitted*, and comment (including by voice). They cannot hand work to someone else, cannot rewrite the brief, and cannot declare their own work finished.

**4. A Lead reviews it.** Approve, and it is done. Or send it back with notes, and step 3 repeats.

### Who sees what

Team Leads and the CEO see the whole board. Everyone else sees only tasks that touch them — raised by them, assigned to them, or assigned to them as part of a split. This is filtered server-side, not hidden in the UI.

### Permission rules

| Action | Manager | Developer | Team Lead | CEO |
|---|:--:|:--:|:--:|:--:|
| Create a task | ✅ auto-routed | ✅ auto-routed | ✅ auto-routed | ✅ auto-routed |
| Assign / reassign | ❌ | ❌ | ✅ **Devs only** | ✅ **Devs only** |
| Split across people | ❌ | ❌ | ✅ **Devs only** | ✅ |
| Move status | ❌ | ✅ up to *Submitted* | ✅ any | ✅ any |
| **Mark Done** | ❌ | ❌ | ✅ via approval | ✅ |
| Report progress | ❌ | ✅ own tasks | ✅ | ✅ |
| Submit for review | ❌ | ✅ own tasks | ✅ | ✅ |
| Approve / request changes | ❌ | ❌ | ✅ | ✅ |
| Edit title & description | ✅ own tasks | ❌ | ✅ any | ✅ |
| Voice note on the brief | ✅ own tasks | ❌ | ✅ any | ✅ |
| Comment, @mention, voice reply | ✅ visible | ✅ visible | ✅ | ✅ |
| Archive | ✅ own, in Triage | ❌ | ✅ | ✅ |
| Delete | ✅ own, in Triage | ❌ | ❌ | ✅ |
| View anyone's task sheet | own only | own only | ✅ | ✅ |
| Change roles | ❌ | ❌ | ❌ | ✅ |
| Remove someone's account | ❌ | ❌ | ✅ Managers & Devs | ✅ except the CEO |

Editing the brief is deliberately narrow: **the person who raised it and the Leads above them**. A Developer who happens to have raised a task still cannot edit its description — the rule is by role, not authorship.

`CEO` cannot be self-selected at signup; the CEO grants it on the People page.

The rules live in one file — [`src/lib/permissions.ts`](src/lib/permissions.ts) — and are applied by the API routes. The UI reads the same functions, so what you see matches what the server will actually allow.

---

## The task format

Every task has the three-part shape you asked for:

1. **Task** — the title.
2. **Description** — a full block editor, not a plain textarea. Read-only until you press the **pencil**; a **delete** (or archive) button sits beside it.
3. **Links** — an optional tab for client material. Empty until you need it.

Plus voice notes, status, priority, assignee, due date, tags, subtasks, comments, and an activity log.

### The block editor

Type `/` for the command menu. Markdown shortcuts work as you type:

| Type this | Get |
|---|---|
| `# ` `## ` `### ` | Headings |
| `- ` or `* ` | Bulleted list |
| `1. ` | Numbered list |
| `[] ` | To-do checkbox |
| `> ` | Quote |
| ` ``` ` | Code block |
| `---` | Divider |

Also: toggle lists, callouts with emoji, images by URL, drag handles to reorder, duplicate/delete, and "turn into" to convert a block's type. `Ctrl+B` / `Ctrl+I` / `Ctrl+U` / `Ctrl+E` for bold, italic, underline, inline code.

The description autosaves 700ms after you stop typing.

### Views

**Board** (drag between columns, group by status / assignee / priority) · **Table** (sortable, inline edits, expandable subtasks) · **List** (grouped and collapsible) · **Calendar** (drag a task onto a day to set its due date).

All four share the same filter set: status, priority, assignee, tag, plus text search.

### Voice notes

Press **Record** to leave audio instead of typing — on the task brief, on a comment, or attached to a task while you are still creating it. Recordings show an inline player with a scrubber, the author, and the duration; the author (or the CEO) can delete them.

Audio is stored as a BLOB **inside the SQLite file**, so a backup is still one file and there is no storage service to pay for. Recordings are capped at 5 minutes / 8 MB, and only `http`-safe audio MIME types are accepted. Playback requires access to the parent task, exactly like every other field on it.

Recording needs microphone permission and a `MediaRecorder`-capable browser (Chrome, Edge, Firefox, Safari 14.1+). Over a network, browsers only grant the microphone on **HTTPS or localhost** — see *Putting it on a network* below.

### Comments and notifications

Threaded comments with `@mention` autocomplete — restricted to **people actually on the task** (whoever raised it, whoever it is assigned to, anyone holding a split piece, and the Leads/CEO overseeing it). Mentioning someone who cannot open the task would just send them a notification to a 403, so the list comes from the same visibility rule the task itself uses. Plus a mic button to reply by voice — a recording on its own is a valid comment. Mentioning someone notifies them; so does being assigned, or having your task moved. Comments can be resolved and hidden. The bell shows an unread count.

### Messages

A conversation list on the left, the open one on the right. **Task groups open on their own** the moment a task has more than two people on it — whoever raised it, whoever holds it, everyone holding a piece of a split — and lock when the task is approved: the record stays, the typing stops. Anyone can also start a direct conversation with anyone else in the organisation.

In the composer, `@` opens a picker of the people in that room and `#` opens one of your tasks by number or title; either one is inserted for you, and the `#TSK-12` in a sent message is a link that opens the task. Links become links.

Alongside words you can send a **photo**, a **document** or a **voice note** — the mic is in the composer, the paperclip takes anything up to 5 MB per file, and pictures and voice notes play in the thread while documents come down as a download. Your own message can be **edited** (it shows as edited) or **deleted** (it stays in the thread as "deleted", and its file goes with it); a Team Lead or the CEO can delete anyone's in a room they are in.

**Clear chat** and **delete chat** are both yours alone: they empty the thread from your side without touching anybody else's copy, and a deleted chat comes back the moment somebody writes in it again.

### Developer task sheets

Every person has a **task sheet**: a full record of what they have shipped. Open your own from the sidebar, or anyone's from the People page (Leads, Managers and the CEO only — everyone else sees just their own).

It shows headline stats — total completed, last 7 and 30 days, median turnaround from raised-to-done, and on-time rate — then a detailed table of every task: reference, title, status, tags, whether it came from a split, when it was completed, how long it took, whether it beat its due date, and who assigned it. A second tab lists what is still in flight, with how long each has been open and what is overdue.

**Export CSV** hands you the whole sheet for a review or a timesheet.

### How a Developer reports progress

Open any task you are assigned and you get a **Progress** panel with three fields, because those are the three things anyone actually wants to know:

| Field | Answers |
|---|---|
| Slider (0–100%) | *How much is done?* |
| What did you finish | *What exactly got built?* |
| What is still left | *What remains?* |
| Blockers · Hours | *What is in the way, and what did it cost?* (optional) |

Two buttons:

- **Post update** — a checkpoint. Sets the task's percentage, appends to the history, notifies nobody. Use it daily.
- **Submit for review** — hands the task to a Team Lead. Status becomes **In Review**, and every Lead gets a notification.

A Developer **cannot mark anything Done.** The status dropdown physically does not offer it, and the API rejects it with *"Submit this for review instead"*. That is the whole point of the gate.

### The review loop

```
Dev works ──▶ Submit for review ──▶ Lead reviews ──┬─▶ Approve ──▶ DONE
     ▲                                             │
     └──────── Changes Requested ◀─────────────────┘
```

When a Lead (or Manager, or the CEO) opens a submitted task they get a review box with a feedback field and two choices:

- **Approve & mark done** — the only route to `DONE`. Forces progress to 100% and notifies the developer.
- **Request changes** — *requires* a note explaining what is wrong. Status becomes **Changes Requested**, the developer is notified with your note, and they pick it straight back up.

Every step is kept: each progress report, each submission, each verdict, with author, percentage and timestamp. Nothing about who did what, or who signed it off, is lost.

### Live updates

The workspace is **live** — there is no refresh button and no waiting. A comment, a progress report, a status change, an approval, or a new task appears for everyone who can see it within about a second.

It runs on Server-Sent Events over a single long-lived connection (`/api/events`), not polling. The header shows a dot: green **Live**, amber **Connecting**, grey **Offline**. If the stream drops — sleep, a proxy timeout, a restart — it reconnects on its own with a backoff, and a 20-second fallback refresh covers the gap in the meantime.

Events carry **no task content** — only "task X changed". Every client then re-fetches through the normal permission-checked endpoints, so listening to the stream can never reveal anything you are not allowed to see.

While a live update lands, the panel deliberately leaves the **title and description alone** — overwriting those from the server while someone is mid-sentence would destroy their typing.

### Shortcuts

`N` new task · `Ctrl+K` or `/` search · `Esc` close · `Ctrl+Enter` submit a form or comment

**Dark mode is the default.** Light mode is one click away in the account menu, bottom-left, and your choice is remembered.

---

## Signing in

Email and password, with a **Forgot password?** link on the sign-in form. It emails a single-use link that expires after an hour; using it changes the password and signs that account out everywhere else. The response is identical whether or not the email exists, so the form cannot be used to discover who has an account.

With no SMTP configured the reset link is printed to the server console instead, so local development still works.

## Managing accounts

The **People** page is where the org chart lives. Alongside each person you get their open-task count, their task sheet, and — where you have the authority — their role and a **Remove** button.

### Removing someone who has left

| Who | Can remove |
|---|---|
| **CEO** | Managers, Team Leads, Developers |
| **Team Lead** | Managers and Developers |
| Manager / Developer | nobody |

Nobody can remove themselves, and the CEO account cannot be removed at all.

Removal asks you to type `remove` to confirm, then:

- **Their open tasks go back to triage**, reassigned to a Team Lead, so nothing is orphaned by the departure.
- **Everything they wrote is kept** — tasks they raised, comments, voice notes and progress reports all survive, credited to *“Removed user”*. Foreign keys are `ON DELETE SET NULL` rather than `CASCADE` precisely so offboarding never erases the record of what someone did.
- Their login and all sessions are destroyed immediately.

## Notifications

Something happening to your work reaches you on four channels, and the point of having four is that **only one of them needs you to be looking at Flow**:

| Channel | Reaches you when | Needs |
|---|---|---|
| **In-app bell** | Flow is open | nothing |
| **Email** | always — you never have to have signed in | SMTP (below) |
| **Browser push** | Flow is closed, even the tab | `VAPID_*` keys, and each person turning push on once per device |
| **Slack** | the team channel, for anything that moved a task | `SLACK_WEBHOOK_URL` |

So: **somebody who has never opened the app still gets the email.** That is the channel that needs nothing from them. Push is the one that reaches a closed tab, but a browser only accepts push after that person has turned it on from **Settings → How to reach you** on that device — there is no way to push to somebody who has not agreed to it, in any app. Slack posts the task lifecycle (raised, assigned, submitted, approved, sent back) and mentions to one channel, deliberately not every chat message.

**Not sure it is working?** Settings → **Send me a test on every channel** sends you one on each and reports back per channel — sent, not configured, or no device has push on yet. No waiting for a colleague to assign you something to find out.

Email goes out whenever a task is **assigned** to someone — on creation, on reassignment, or as one piece of a split — and when they are mentioned, when work is submitted for review, when progress is posted, and when a task is approved.

Set it up by copying `.env.example` to `.env.local` and filling in the Gmail block:

1. Turn on 2-Step Verification on your Google account.
2. Go to <https://myaccount.google.com/apppasswords> and create an **App Password**.
3. Paste the 16-character password into `SMTP_PASS`. Your normal Gmail password will not work.

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-16-char-app-password
MAIL_FROM=Flow <you@gmail.com>
APP_URL=https://your-app.vercel.app
```

Every channel is optional and fails soft: if SMTP is missing, the push service is down or the Slack webhook is dead, the send is skipped and logged. Nobody ever loses a task assignment because an email bounced.

For push, generate a key pair once with `npm run push:keys` and paste the two values into `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (plus `VAPID_SUBJECT`, a `mailto:` address). For Slack, create an incoming webhook — free, one URL, no app review — and set `SLACK_WEBHOOK_URL`.

## On a phone

The whole thing works in a mobile browser — no app to install. The sidebar becomes a drawer, task panels go full-screen, tap targets are finger-sized, and inputs use 16px text so iOS does not zoom on focus. Hover-only controls are pinned visible on touch devices, since a finger cannot hover.

Add it to your home screen and it behaves like an app. **Voice recording needs HTTPS** — which you get free on Vercel.

## Deploying to Vercel + Supabase

The app talks to PostgreSQL. Locally that is **PGlite**, an embedded Postgres that lives in `data/pg` — no account, no server, no cost. In production it is Supabase. Same SQL, same code.

**1. Create the database.** Sign up at [supabase.com](https://supabase.com), create a project, then go to **Project Settings → Database → Connection string → URI**. Copy the **Connection pooling** URI (port `6543`) — Vercel's serverless functions open and close connections constantly, and the pooler is what keeps that from exhausting your database.

**2. Push the code to GitHub**, then import the repo at [vercel.com/new](https://vercel.com/new).

**3. Add environment variables** in Vercel → Settings → Environment Variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Supabase pooling URI |
| `APP_URL` | `https://your-app.vercel.app` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | your 16-character App Password |
| `MAIL_FROM` | `Flow <you@gmail.com>` |

**4. Deploy.** The schema creates itself on first request — every statement is `CREATE TABLE IF NOT EXISTS`, so there is no migration step to run and no way to double-apply it.

**5. Start your organisation.** Visit your URL, choose **Sign up** → **Start an organisation**, and name it. That account becomes the CEO. Everyone else joins with the invite code from your profile page, as Manager, Team Lead or Developer.

### What to watch on the free tier

- **Voice notes live in the database** as `BYTEA`. Supabase's free tier gives you 500 MB, and a 5-minute recording is roughly 2–4 MB. That is a few hundred recordings. If you outgrow it, move the `data` column to Supabase Storage — the rest of the schema does not change.
- **Live updates use one long-lived SSE connection per open tab.** Vercel's free tier caps a function at 60 seconds, so the stream reconnects about once a minute. That is invisible in use — the client reconnects automatically and the 20-second fallback refresh covers the gap — but it does mean each tab costs a steady trickle of function invocations.
- **Supabase pauses a free project after a week of inactivity.** The first request after that wakes it and is slow. Nothing is lost.

## How it's built

| | |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript |
| Database | PostgreSQL — Supabase in production, embedded PGlite (`data/pg`) locally |
| Styling | Tailwind CSS v4, themed with CSS variables |
| Auth | Email + password, `scrypt` hashing, httpOnly session cookies |
| Drag & drop | `@dnd-kit` |

No external services. Nothing leaves your machine.

```
db/schema.pg.sql         the whole schema, idempotent, applied on first request
scripts/test-e2e.mjs     113 end-to-end checks
src/lib/
  pg.ts                  one Db interface over Supabase or PGlite
  email.ts               outbound mail, disabled unless SMTP is configured
  auth.ts                hashing, sessions, task routing
  permissions.ts         the hierarchy rules
  store.ts               all queries
  types.ts               shared types, statuses, priorities
  events.ts              in-process pub/sub behind the live stream
  useLiveEvents.ts       client hook: subscribe, reconnect, back off
  sanitize.ts            HTML whitelist for pasted block content
  url.ts                 link validation
src/app/api/             REST endpoints
src/components/          UI, incl. BlockEditor, VoiceNotes, ProgressPanel,
                         TaskSheetPanel and the four views
```

### Notes on the security-relevant bits

- Passwords are hashed with `scrypt` and a per-user salt; comparison is constant-time.
- Sessions are opaque 32-byte random tokens stored server-side, in httpOnly `SameSite=Lax` cookies, expiring after 30 days.
- Login returns the same error for a bad email and a bad password, so the form can't be used to discover who has an account.
- Block content is sanitized against a tag/attribute whitelist before it is stored or re-rendered.
- Task links are restricted to `http`/`https` on **both** the create and add-link paths, so `javascript:` URLs can't be stored.
- Every permission check runs server-side. The UI hiding a button is a convenience, not the control.
- The workspace refuses to demote its last remaining CEO.
- The CEO seat comes from founding an organisation, never from registering first. Joining one needs its invite code, which the CEO can replace at any moment; the legacy setup code is compared in constant time.
- Every read and write is scoped to the signed-in person's organisation. A task, person, meeting or conversation id from another organisation answers as if it did not exist.
- Account removal is authority-checked server-side: a Team Lead cannot remove another Lead, nobody can remove the CEO, and nobody can remove themselves.
- Password reset tokens are single-use, expire after an hour, and invalidate every existing session when redeemed.
- The forgot-password endpoint answers identically for known and unknown emails.
- Marking a task Done is enforced server-side as a review action; a Developer cannot reach `DONE` through any endpoint.
- The event stream requires a session and filters targeted events to their recipient.
- Assignment targets are validated server-side against the Developer role, so a crafted request cannot route work sideways.
- Voice uploads are size-capped and MIME-checked, and audio is only served to users who can already see the parent task.

---

## Backing up

Locally the entire workspace is one folder:

```bash
cp -r data/pg ~/flow-backup-pg
```

To reset local development to a completely empty workspace, delete it:

```bash
rm -rf data/pg
```

On Supabase, use **Project Settings → Database → Backups**, or `pg_dump` against your connection string.

## Putting it on a network

`npm run build && npm run start` serves it on port 3000. Anyone on your LAN can reach it at `http://<your-ip>:3000` and sign in with their own account.

If you expose it beyond your own network, put it behind HTTPS — the session cookie only sets its `Secure` flag when `NODE_ENV=production`, and passwords are sent in the request body.

HTTPS matters for a second reason: browsers refuse microphone access on plain `http://` for anything except `localhost`. Without it, **voice recording will silently be unavailable to everyone but you**.

---

## Honest scope

This is a task manager with Notion's editing feel and a hierarchy Notion doesn't have. It is not a full Notion clone — there are no nested pages or wikis, no relational databases with linked properties, no real-time collaborative cursors, no permissions per page, no AI, no third-party integrations. Multi-user sync is a 15-second poll, not websockets, which is fine for a team but would feel slow at large scale.

Live updates use one SSE connection per open tab, and the event bus is in-memory. That is fine for a team on a single instance. Across several Vercel instances a viewer only receives events raised by the instance they happen to be connected to — the 20-second fallback refresh papers over it, but a real deployment at scale would want Postgres `LISTEN/NOTIFY` or a hosted broker.

Voice notes are recorded in the browser and stored as-is — there is no transcription, no waveform scrubbing beyond a simple progress bar, and no compression pass beyond what the browser's encoder does.

What's here is built properly and verified end-to-end: **130 automated checks** (`npm test`) cover the routing rule, every permission boundary, the five-role hierarchy, Dev-only assignment, splitting, progress reporting, the full submit → review → approve loop, the live event stream, voice note upload/streaming/deletion, task sheets, mention scoping, password reset, CEO setup-code claiming, offboarding (including that a removed person's comments and progress reports survive), notifications, and input validation. They run against real PostgreSQL.
