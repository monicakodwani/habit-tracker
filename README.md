# Habits

**Live:** <https://monicakodwani.github.io/habit-tracker/>

A small, private habit-accountability app for three friends. Everyone keeps their own
habits, everyone can see how the others are doing on the ones they choose to share, and
everyone can bother each other about it.

The app records consistency. The friends provide accountability.

React + TypeScript + Vite on the front, Supabase (Postgres + Auth + Row Level Security
+ Edge Functions) on the back, deployed as static files to GitHub Pages. There is no
custom server.

---

## Contents

- [What it does](#what-it-does)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Upgrading an existing deployment](#upgrading-an-existing-deployment)
- [Web Push](#web-push)
- [Try it locally without a Supabase account](#try-it-locally-without-a-supabase-account)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [Environment variables and what is safe to expose](#environment-variables-and-what-is-safe-to-expose)
- [Tests](#tests)
- [Responsive layout](#responsive-layout)
- [Architecture](#architecture)
- [Semantics that are easy to get wrong](#semantics-that-are-easy-to-get-wrong)
- [Daily streak](#daily-streak)
- [Security model](#security-model)
- [Design decisions](#design-decisions)
- [If push stops arriving](#if-push-stops-arriving)
- [Installing on an iPhone](#installing-on-an-iphone)
- [Known limitations](#known-limitations)
- [Not built](#not-built)

---

## What it does

**Today** — your habits for today, one tap to complete or undo, and each friend's
shared habits underneath. Anyone asking for a push floats to the top of their card.

**Week** — your own week as a seven-column grid.

**Activity** — a small group feed: completions, nudges, requests for help, with
reactions.

**Me** — your profile, your habits, notification settings, sign out.

The four destinations are a bottom tab bar on phones and tablets, and a left sidebar
from 1024px up — never both.

**Habit detail** — streaks, a month calendar with five states, recent history.

### Kinds of habit

|  | Success is… | Recurrence |
| --- | --- | --- |
| **Do** | completing it | every day, certain days, or X times per week |
| **Avoid** | a scheduled day *ending* without a lapse | every day or certain days |

Each habit is **shared** with the group or **private** to you. Private means private —
its name never leaves the database for anyone but you, and it generates no social
activity of any kind.

### The social bits

- **Nudge** a friend about an unfinished shared habit — five presets or a short custom
  message. Rules are enforced in SQL, including a two-hour cooldown.
- **Ask for a push** ("⚠️ I might miss this today") with an optional note. Friends see
  it prominently and can nudge.
- **Excuse today** — grace for travel, illness, or a genuinely exceptional day. Doesn't
  count as done, doesn't break the streak, and drops out of the denominator.
- **React** to activity with one of ❤️ 🎉 👏 🫡 😂 🔥.
- **Push notifications** for nudges, requests for help, and (optionally) reactions.

There are no scores, rankings, XP, badges, leaderboards, or percentages comparing
people. There is no chat and there are no comments.

---

## Prerequisites

- **Node.js 20+** and npm
- A **Supabase** account (the free tier is plenty for three people)
- A **GitHub** repository, for deployment
- **Docker**, only if you want `npm run test:rls` or a local Supabase
- The **Supabase CLI** (`npx supabase`), only for deploying the Edge Function

---

## Setup

### 1. Create the Supabase project

Create a project at [supabase.com](https://supabase.com).

### 2. Run the migrations

In the dashboard, open **SQL Editor → New query** and run every file in
`supabase/migrations/` **in filename order**:

1. `20260816000000_init.sql` — profiles, groups, habits, check-ins, RLS.
2. `20260816213000_fix_own_profile_visibility.sql` — lets a new user read their own
   profile before joining a group.
3. `20260817000000_social.sql` — avoidance habits, day states, nudges, activity feed,
   reactions, notification preferences, push subscriptions, and the RPCs.

Together these are the complete database. Running them on a fresh project is all the
setup there is.

> Using the CLI instead? `supabase db push` picks them all up.

### 3. Turn off email confirmation

**Authentication → Sign In / Providers → Email → Confirm email**. Much simpler for
three people.

### 4. Configure the app

Copy the **Project URL** and **anon key** from **Project Settings → Data API**:

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> The URL is the **base** project URL — no `/rest/v1` on the end. That path is the REST
> endpoint; the client appends it itself.

### 5. Run it

```bash
npm install
npm run dev
```

### 6. Sign up, then create the group

Each person signs up in the app first. They will see *"You're not part of a group
yet"* — that is correct, because nobody can put themselves in a group.

Then edit the emails at the top of [`supabase/bootstrap.sql`](supabase/bootstrap.sql)
and run the whole file in the SQL editor. It is safe to re-run.

> **Why manual?** The client has no `INSERT` policy on `groups` or `group_members` at
> all. There is deliberately no way to create or join a group from a browser, so a
> stranger who signs up cannot reach your data no matter what they try.

### 7. Optional: seed some history

[`supabase/seed.sql`](supabase/seed.sql) gives everyone habits and about three weeks of
plausible history, including an avoidance habit, an excused day, an at-risk item, a
nudge and some reactions. Development only — don't run it on the project you actually
use.

---

## Upgrading an existing deployment

If you already have Phase 1 running with real data, you only need migration **3**.

It is purely additive and has been tested against a populated database:

- No column is dropped and no row is rewritten destructively.
- Every existing habit becomes `kind = 'do'` and `nudge_policy = 'anytime'`.
- Existing profiles, groups, memberships, habits and check-ins are untouched, and
  existing streaks are unchanged.
- New tables start empty; nothing needs recreating.

Run it in the SQL editor, then redeploy the frontend. Nothing else changes.

---

## Web Push

Real Web Push: a service worker, the Push API, VAPID, and a Supabase Edge Function that
does the sending. No third-party notification service.

### 1. Generate VAPID keys (once)

```bash
npm run vapid
```

This prints a **public** key and a **private** key.

- The **public** key goes in the frontend. It is compiled into the bundle and is meant
  to be visible — it is what browsers encrypt to.
- The **private** key goes **only** into a Supabase secret. Anyone holding it can push
  notifications to your users. Never commit it, never put it in a `VITE_` variable.

### 2. Configure

Add the public key to `.env` and to your GitHub repository secrets:

```
VITE_VAPID_PUBLIC_KEY=<public key>
```

Set the server-side secrets:

```bash
npx supabase secrets set \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:you@example.com
```

### 3. Deploy the function

```bash
npx supabase functions deploy send-push
```

### How it works

```
tap Nudge
   │
   ▼
send_nudge() RPC          ← validates everything, stores nudge + activity event
   │                        (this is the part that must not fail)
   ▼
send-push Edge Function   ← best-effort
   ├── authenticates the caller's JWT
   ├── verifies they are actually the actor of that row
   ├── checks the RECIPIENT's notification preferences
   ├── loads their subscriptions with the service-role key
   └── sends Web Push, deleting any endpoint that returns 404/410
```

The properties that matter:

- **The social action is already committed** before push is attempted. A failed push
  never undoes a nudge; the app just shows it as normal.
- **The function takes a row id, never a message.** All notification text is built
  server-side from the database, so it cannot be used as a relay to push arbitrary
  text at people.
- **It verifies the caller is the actor** of that specific nudge / at-risk marker /
  reaction. A valid login for an unrelated account gets a 403.
- **Preferences are honoured server-side**, including `show_habit_names` — these land
  on lock screens, so hiding a name in the UI after sending it would be pointless.
- **No secret ever reaches the browser.**

---

## Try it locally without a Supabase account

One command, if you have Docker:

```bash
npm run dev:local
```

Then `npm run dev`. Sign in as `monica@example.com`, `ura@example.com` or
`ojas@example.com`, password `password123`.

Monica has a **private** habit ("Therapy") and a private avoidance habit. Sign in as
Ura and you will not find either — not on Today, not in the feed, not by URL, not in
the network responses.

- **Supabase Studio** — <http://127.0.0.1:54323>
- **Inbox** — <http://127.0.0.1:54324>

```bash
npx supabase stop
```

[`scripts/dev-local.sh`](scripts/dev-local.sh) refuses to run against anything not on
localhost, so it cannot create demo accounts in your real project.

---

## Deploying to GitHub Pages

Repository secrets (**Settings → Secrets and variables → Actions**):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY` *(optional — without it the app works, just without push)*

**Settings → Pages → Source: GitHub Actions**, then push to `main`. The workflow
typechecks, lints, runs the unit tests, builds, and deploys — a failure at any step
stops the deployment.

### The subpath

GitHub Pages serves from `/<repo>/`, not `/`. Three things depend on that:

- **Assets.** The workflow sets `VITE_BASE_PATH=/${{ github.event.repository.name }}/`,
  derived from the repo name so renaming or forking needs no code change.
- **Routing.** `HashRouter`, so `…/habit-tracker/#/week` works on refresh and on deep
  links. Pages cannot rewrite unknown paths to `index.html`, so a normal router would
  404.
- **The service worker.** Registered as `${import.meta.env.BASE_URL}sw.js` with a
  matching scope, and every URL it builds internally is resolved against
  `self.registration.scope`. A hard-coded `/sw.js` would register at the wrong scope
  and silently never receive a push. There are tests for this.

---

## Environment variables and what is safe to expose

| Variable | Where it goes | Safe in the browser? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Bundle, GitHub Pages | **Yes** |
| `VITE_SUPABASE_ANON_KEY` | Bundle, GitHub Pages | **Yes** |
| `VITE_VAPID_PUBLIC_KEY` | Bundle, GitHub Pages | **Yes** |
| `VAPID_PRIVATE_KEY` | Supabase secret only | **Never** |
| `service_role` key | Supabase (managed) only | **Never** |
| Database password / JWT secret | Nowhere in this repo | **Never** |

Anything prefixed `VITE_` is compiled into the JavaScript that ships to GitHub Pages.
Assume anyone can read it, because they can.

That is fine for the first three. The anon key identifies the project; it does not
grant access — RLS decides what any request may read or write. The VAPID public key is
by design the half browsers encrypt to.

The **VAPID private key** and the **service-role key** are different: either one is
enough to bypass a boundary. They belong in Supabase secrets, which the Edge Function
reads server-side.

---

## Tests

```bash
npm test          # 194 unit tests: domain logic + service worker
npm run test:rls  # 146 database policy assertions (needs Docker)
npm run typecheck
npm run lint
npm run build
```

### Unit tests

Pure functions over `src/domain`, plus `public/sw.js` evaluated in a sandbox.

Covered: weekday-only habits across weekends, missed days, weekly targets crossing the
Monday boundary, completions at 11:30pm local, DST in both hemispheres, leap days, year
boundaries, archived and private habits, excused days (neutral in every direction),
avoidance streaks (today never counted early, creation-date bound, lapse resets), at-risk
lifecycle and expiry, and every nudge-eligibility rule including the cooldown.

### Database policy tests

`npm run test:rls` applies the **real, unmodified migrations** to a throwaway Postgres
and impersonates users exactly as PostgREST does. For every table it asserts what the
owner, a friend, an unrelated authenticated account, and `anon` can each read and write.

Specifically including: private habits (and their day states, lapses and check-ins)
being unreachable even by explicit id; nudge cooldown, policy and self-nudge rules
being unbypassable via direct RPC calls; activity events being unforgeable and
immutable from the client; a habit turning private deleting its social trail; and a
friend being unable to read anyone's push subscription.

---

## Responsive layout

One React application, one set of screens, no duplicated mobile/desktop trees. The
difference is entirely CSS breakpoints; nothing measures `window.innerWidth`.

| | phone (<768px) | tablet (768px+) | desktop (1024px+) |
| --- | --- | --- | --- |
| Navigation | bottom tab bar | bottom tab bar | left sidebar |
| Shell | single column | wider single column | sidebar + content, capped at 80rem |
| Today | You, then Your people | same, wider | two columns, 55/45 |
| Week | days beneath each habit | same | habit and its week on one row |
| Activity | single column | single column | centred reading column |
| Me | stacked | stacked | profile and notifications side by side |
| Habit detail | stacked | stacked | stats left, calendar right |
| Sheets | bottom sheet | bottom sheet | centred dialog (from 640px) |

Screens never set their own widths. They declare an intent — `default`, `settings`,
`reading` or `form` — and `src/components/Layout.tsx` decides what that means at each
size. That is what stops the app drifting into a pile of one-off `max-w-` overrides.

`AppShell` composes the sidebar and content region; `Columns` is the shared two-column
primitive; `Screen` handles gutters, safe areas and the width intent. `BottomNav` and
`Sidebar` both render from `NAV_ITEMS`, so a destination cannot exist in one and not
the other.

## Architecture

```
src/
  domain/        Pure logic. No React, no network. Where the tests live.
    dates.ts       Timezone-aware calendar maths (Luxon).
    dayState.ts    What one habit-day means: done/clean/still-going/lapsed/
                   excused/pending/missed/off.
    recurrence.ts  Is it due? How is the week going?
    streaks.ts     Scheduled streaks, avoidance streaks, weekly consistency.
    nudges.ts      Nudge eligibility — a MIRROR of the SQL rules, not the enforcement.
    status.ts      View models for Today and Week.
  services/      Every Supabase query. Nothing else talks to the database.
  hooks/         useAuth, useAppData (one load + all writes), useActivity (the feed).
  lib/           supabase client, Web Push plumbing.
  components/    Reusable UI: rows, sheets, buttons, toasts, forms.
  screens/       One file per screen. Thin.

public/sw.js     Service worker: push, notification clicks, static-asset caching.

supabase/
  migrations/    Versioned schema. Run in filename order.
  functions/     send-push Edge Function.
  bootstrap.sql  One-time: create the group, add the three people.
  seed.sql       Development data.
  tests/         RLS suites.
```

**Data flow.** `useAppData` loads everything once — profile, group, members, habits,
check-ins, day states, recent sent nudges — and holds it. Screens derive what they need
through `domain/`. Writes go through the same hook, so an optimistic update and its
rollback sit next to the state they touch. The feed is separate (`useActivity`) because
it is paginated and only one tab.

**Realtime** is a "something changed, refetch" signal for `habit_checkins`, `habits`,
`habit_days`, `activity_events` and `event_reactions`. The payload is never trusted or
merged; RLS decides what the refetch returns. `push_subscriptions` is deliberately
**not** in the publication.

**Server-side rules.** Anything that must not be bypassable from devtools is a
`SECURITY DEFINER` RPC with narrow inputs, a pinned empty `search_path`, and an
explicit authorisation check: `send_nudge`, `mark_at_risk`, `clear_at_risk`,
`set_excused`, `set_lapse`. Activity events are written only by those functions and by
a trigger on `habit_checkins` — `authenticated` has no INSERT grant on the table at all.

---

## Semantics that are easy to get wrong

These are the rules the tests exist to protect.

### Excused days are neutral

A Monday–Friday habit:

```
Mon ✓   Tue ✓   Wed ❄️ excused   Thu ✓   Fri ✓
```

The streak is **4**. Wednesday does not increase it and does not break it. It is also
removed from the consistency denominator, so being ill does not make the month look
worse. It never counts as completed.

Weekly-target habits do **not** get per-day excuses — their semantics are week-level,
and the database rejects the attempt.

### Avoidance days are only won once they end

A daily avoidance habit with 12 clean finished days and no lapse yet today shows:

```
🔥 12 days • still going today
```

Never 13. If today ends clean it becomes 13 tomorrow; if a slip is logged, the streak
restarts. Excused days are neutral here too.

Avoidance streaks are bounded by the habit's creation date — success is the *absence*
of a record, so without that bound a habit created yesterday would appear to have an
unbroken streak stretching back forever. Recorded evidence (a check-in, a lapse, an
excuse) always overrides that bound, so a backfilled or edited habit never loses
visible history.

### At-risk belongs to one local day

It is set for the owner's local date, computed **server-side** from their timezone. It
resolves when the habit is completed, excused, the weekly target is met, the owner
clears it, or a slip is logged — and it stops being current when that person's day
ends. Historical activity stays in the feed.

### Nudge rules

A nudge is allowed only when the sender is a group member, the habit belongs to the
recipient, is shared, active, relevant today, not already satisfied, not excused, the
owner's policy permits it right now, and the sender has not nudged that habit within
two hours. Avoidance habits can be encouraged while the day is going, but **not** after
a slip is logged — piling on is exactly what this app should not do.

All of it is enforced in `send_nudge()`. `src/domain/nudges.ts` mirrors it so the UI
does not show buttons the server would reject; if they ever disagree, the server wins.
Every policy refusal reports the same opaque reason, so a friend cannot read the
interface to learn someone's settings.

---

## Daily streak

A second, separate metric: consecutive local days on which you handled everything that
actually mattered that day. It sits alongside the per-habit streaks — "Read 🔥 12 days"
and "Daily streak 🔥 6 days" are different things, and neither replaces the other.

**Derived, never stored.** There is no counter column and no cron job. Every number is
recomputed from habits, check-ins and day states, so correcting last Tuesday — adding a
forgotten check-in, granting an excuse, undoing a slip — updates it immediately with no
possibility of a stored value drifting out of line with the history.

### What counts

| | Counts toward a day? |
| --- | --- |
| Scheduled `do` habit, on a day it is due | **Yes** |
| Scheduled `avoid` habit, on a day it is scheduled | **Yes** |
| Weekly-target habit | **No** — not due on any particular date |
| A day the habit was not scheduled | No |
| Days before the habit was created | No |

Private habits count for their owner. A combined streak that ignored them would not be
that person's real streak.

### How a day is judged

- **successful** — at least one habit applied, and every one was completed or excused
- **failed** — at least one applicable habit was missed, or an avoidance habit slipped
- **neutral** — nothing applied. A rest day neither earns credit nor breaks the run
- **in progress** — the current local day, which is never finalised early

An **excused** occurrence counts as *handled*. It earns the habit no completion credit,
but it must not cost you the day — that is the entire point of grace.

### The current day never counts early

The streak only ever reports days that are over. If yesterday's run was 6 and today is
going well, it shows `🔥 6-day daily streak · On track today` — not 7. Tomorrow it
becomes 7.

Two reasons: an avoidance habit is only won once the day *ends*, and a completion can
still be undone before midnight. Waiting means the number only moves forward, which is
what makes it worth trusting. A finished day still says `Everything done today ✓` — it
just doesn't inflate the count.

A slip or a miss today *is* definitive, so today can read as failed. The copy for that
is `Start fresh tomorrow`; a missed habit is already visible on its own row and the
combined metric has no business scolding anyone twice.

### Neutral days are transparent

Weekday-only habits mean the weekend has nothing scheduled. Friday success → Saturday
neutral → Sunday neutral → Monday success continues one unbroken run. Empty days never
manufacture credit either.

### Archived habits

An archived habit still counts for the days it was active, so retiring something does
not quietly turn past failures into successes.

**Limitation:** the schema records *that* a habit is archived, not *when*. `updated_at`
is used as the archive date, which is exact for a habit archived and then left alone,
and slightly too generous if it was edited afterwards. The alternatives are worse —
ignoring archived habits rewrites history, counting them forever means retiring a habit
silently breaks every day since. Adding archive-date tracking would need a migration
and was not judged worth it for three people.

### Where it appears

- **Today** — one compact line under the date
- **Me** — current and longest

Deliberately **not** on habit detail, which keeps showing that habit's own streak.

### Why friends don't see it

A friend's true combined streak depends on their *private* habits, which the viewer
cannot read. Computing one in the browser from visible shared habits would produce a
confidently wrong number, and computing it correctly would mean exposing private state.
So the daily streak is the owner's own. Exposing it socially would need a server-side
aggregate that returns only a number; that is a deliberate future choice, not an
oversight.

## Security model

The frontend is public static code. Anyone can read it, change it in devtools, or skip
it entirely. None of the security lives there.

**Every table has RLS enabled with explicit policies.** With no policy matching, a read
returns zero rows and a write is rejected. The default is deny.

- **Private habits are private.** A private habit's name, emoji, existence, check-ins,
  day states, lapses and at-risk markers are unreachable by anyone but its owner. It
  produces no activity events, cannot be nudged, and cannot appear in a push payload.
  Turning a shared habit private deletes its past events and nudges.
- **You cannot touch anyone else's data.** Habits, check-ins and day states are
  writable only by their owner. Marking a friend's habit complete fails twice over: the
  policy rejects a forged `user_id`, and a composite foreign key on
  `habits(id, owner_id)` rejects your own `user_id` paired with their habit — which
  holds even for a service-role client.
- **Social actions cannot be forged.** `nudges` and `activity_events` have no INSERT
  grant for `authenticated`; the only way in is through the validating RPCs, which take
  no actor argument and read it from `auth.uid()`.
- **Push subscriptions are owner-only.** A friend cannot read another person's endpoint
  or keys — holding them would be enough to push to that device directly. The table is
  not in the realtime publication.
- **Strangers get nothing.** An authenticated account outside the group sees zero
  habits, check-ins, day states, events, reactions, preferences and subscriptions. An
  unauthenticated request is refused at the grant level, before policies.

The `SECURITY DEFINER` helpers (`my_group_ids`, `shares_group_with`, `owner_today`,
`owner_local_time`, `scheduled_streak_at`) exist because a policy on `group_members`
that queries `group_members` would recurse. They take no free-form input, pin
`search_path` to `''`, and the internal ones are not granted to `authenticated` at all
— `owner_local_time` would otherwise leak a friend's wall-clock time.

All of the above is asserted by `npm run test:rls`.

---

## Design decisions

**Day state is one table, not three.** `habit_days` holds excused, lapsed and at-risk
because they are all "a fact about this habit on this local date", all owned by the
habit owner, and at most one row per habit-day is ever needed. Three tables would have
meant three joins and three near-identical policy sets. Completions stay in
`habit_checkins` — that table already existed in production and moving it would have
been a destructive rewrite for no benefit.

**Habit kind is separate from recurrence.** "How often" and "what winning means" are
different questions. Conflating them is how you end up asking someone to tick a box
every night to confirm they did not order takeout.

**Today is not re-sorted when you check something off.** Rows jumping under your finger
mid-tap is worse than seeing completed items in place. The one exception is a *friend's*
card, where at-risk items float to the top — those rows carry no tap targets that could
shift.

**Avoidance habits have no tick box.** A badge, and a "I slipped today" action in the
sheet. The core semantic is that a scheduled day succeeds by ending quietly.

**No feed item for lapses.** The spec allowed it; a shame feed is the obvious failure
mode of this whole feature. The status shows on Today, which is enough.

**Custom nudge text stays between two people.** The feed says "Monica nudged Ojas about
Read" and shows a preset label if one was used, never a custom message.

**Colour is never the only signal.** Every calendar cell, week cell and status has a
text or screen-reader label, and the detail calendar carries a legend.

**Email + password, not magic links.** Works identically under a subpath, needs no
redirect configuration, and does not depend on a link opening in the same browser —
which on iOS is a real source of friction.

---

## If push stops arriving

Push failure never affects anything else — a nudge is committed to the database before
delivery is attempted, so nudges, at-risk, the feed and reactions all keep working.

Function logs are in the dashboard under **Edge Functions → send-push → Logs** (there is
no `supabase functions logs` subcommand). Lines read `[send-push] <stage> <message>`, and
the stage names the layer that failed: `env`, `auth`, `parse`, `vapid`, `resolve`, `deliver`.

The usual causes, in order of likelihood:

| Symptom | Cause |
| --- | --- |
| Nothing arrives, no errors | The recipient never enabled notifications on that device, or has the relevant preference off. |
| `deliver` logs a 401/403 | VAPID mismatch — the key the server signs with is not the one the app was built with. |
| `vapid` stage errors | `supabase secrets set` was not run, or the function was not redeployed after it. |
| Worked, then stopped | The browser rotated its subscription. Turn notifications off and on again in Me. |

Because `supabase secrets list` shows only digests, a VAPID mismatch cannot be checked by
eye. The fix is to set both halves from the *same* `npm run vapid` output, redeploy the
function, and re-run the Pages workflow so the bundle carries the matching public key.

## Installing on an iPhone

1. Open <https://monicakodwani.github.io/habit-tracker/> in Safari.
2. Share → **Add to Home Screen**.
3. Open it from the Home Screen (not Safari).
4. **Me → Notifications → Enable**, and allow when iOS asks.

Step 3 matters: iOS only allows Web Push for an installed web app. Until then the app
says so rather than showing a button that would silently fail. Everything else works
normally in Safari.

---

## Known limitations

- **iOS requires Home Screen installation for push.** An Apple platform rule, not
  something the app can work around. Detected and explained in the UI.
- **Notification action buttons are not implemented.** A reliable push that opens the
  right screen was the priority; per-platform action buttons are inconsistent enough to
  be worse than nothing.
- **Streaks are computed from a 400-day window** of check-ins on Today and Week. The
  habit detail screen fetches that habit's full history, so a longer streak is exact
  there.
- **No offline writes.** The static shell is cached so the app opens without a
  connection, but actions need the network and roll back with an error if they fail.
- **The feed's streak decoration is computed in SQL** (`scheduled_streak_at`), which
  mirrors the TypeScript logic rather than sharing it. The two are covered by separate
  tests.

---

## Not built

Deliberately out of scope: chat, comments, DMs, public accounts, friend discovery,
followers, group management UI, badges, points, XP, subscriptions, AI anything, mood
tracking, photo evidence, Apple Health, calendars, location, analytics dashboards, and
admin tooling.

The fun comes from the three people, not the feature count.
