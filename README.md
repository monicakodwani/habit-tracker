# Habits

**Live:** <https://monicakodwani.github.io/habit-tracker/>

A small, private habit-accountability app for three friends. Everyone keeps their own
habits, and everyone can see how the others are doing on the ones they choose to share.

React + TypeScript + Vite on the front, Supabase (Postgres + Auth + Row Level
Security) on the back, deployed as static files to GitHub Pages. There is no custom
server.

---

## Contents

- [What it does](#what-it-does)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [1. Create the Supabase project](#1-create-the-supabase-project)
  - [2. Run the migration](#2-run-the-migration)
  - [3. Configure the app](#3-configure-the-app)
  - [4. Run it locally](#4-run-it-locally)
  - [5. Add the three accounts and create the group](#5-add-the-three-accounts-and-create-the-group)
  - [6. Optional: seed some history](#6-optional-seed-some-history)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [Environment variables and what is safe to expose](#environment-variables-and-what-is-safe-to-expose)
- [Tests](#tests)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Design decisions](#design-decisions)
- [Local Supabase (optional)](#local-supabase-optional)
- [Not built yet](#not-built-yet)

---

## What it does

**Today** — your habits due today, with one tap to complete or undo, your progress
line, and each friend's shared habits underneath (read-only).

**Week** — your own week as a seven-column grid, plus counts for weekly-target habits.

**Me** — your profile, your habits (edit, archive, restore, delete), and sign out.

**Habit detail** — current and longest streak, a month calendar, and recent check-ins.

Two kinds of habit:

- **Scheduled days** — every day, weekdays, `Tue & Sat`, Sundays… any set of weekdays.
- **X times per week** — completed on any days; the counter resets each Monday.

Each habit is **shared** with the group or **private** to you. Private means private:
its name never leaves the database for anyone but you.

---

## Prerequisites

- **Node.js 20+** and npm
- A **Supabase** account (the free tier is plenty for three people)
- A **GitHub** repository, for deployment
- **Docker**, only if you want to run `npm run test:rls` or a local Supabase

---

## Setup

### 1. Create the Supabase project

Create a new project at [supabase.com](https://supabase.com). Pick a region near
whoever will use it most, and save the database password somewhere safe — you will not
need it for this app, but you will want it eventually.

### 2. Run the migration

In the Supabase dashboard, open **SQL Editor → New query** and run the files in
`supabase/migrations/` **in filename order**, one at a time:

1. [`20260816000000_init.sql`](supabase/migrations/20260816000000_init.sql) — the whole
   schema: tables, constraints, indexes, triggers, RLS policies, grants, realtime.
2. [`20260816213000_fix_own_profile_visibility.sql`](supabase/migrations/20260816213000_fix_own_profile_visibility.sql)
   — lets a user read their own profile before they belong to a group. Without it,
   every brand new account fails on first sign-in.

Together these are the complete database, not fragments. Running them on a fresh
project is all the database setup there is.

> Using the Supabase CLI instead? `supabase db push` picks the migration up
> automatically.

### 3. Configure the app

In the dashboard, go to **Project Settings → Data API** and copy the **Project URL**
and the **anon / public** key.

```bash
cp .env.example .env
```

Fill in:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both are safe in the browser — see
[Environment variables](#environment-variables-and-what-is-safe-to-expose).

### 4. Run it locally

```bash
npm install
npm run dev
```

Open the URL it prints. You should see the sign-in screen.

### 5. Add the three accounts and create the group

**First**, each person signs up in the app (**Create one** on the sign-in screen). By
default Supabase requires email confirmation; for three friends it is simpler to turn
it off under **Authentication → Sign In / Providers → Email → Confirm email**.

Signing up creates the account and, via a database trigger, the matching profile row.
At this point everyone is signed in but sees *"You're not part of a group yet"* — which
is correct, because nobody can put themselves in a group.

**Then**, open [`supabase/bootstrap.sql`](supabase/bootstrap.sql), edit the two values
at the top:

```sql
group_name  constant text   := 'Us';
emails      constant text[] := array[
  'monica@example.com',
  'ura@example.com',
  'ojas@example.com'
];
```

…and run the whole file in the SQL editor. It creates the group, adds the three
accounts, and prints the resulting membership so you can check it. It is safe to re-run
— for example after a fourth person signs up.

Refresh the app and you are in.

> **Why is this a manual step?** The client has no `INSERT` policy on `groups` or
> `group_members` at all. There is deliberately no way to create or join a group from
> the browser, which means a stranger who signs up cannot reach your data no matter
> what they try. Membership is an admin action, run from an already-authenticated SQL
> editor.

### 6. Optional: seed some history

[`supabase/seed.sql`](supabase/seed.sql) gives everyone in the group a handful of
habits and about three weeks of plausible check-ins, so the screens have something to
show while you are working on them. Run it in the SQL editor after `bootstrap.sql`.

It is re-runnable (it skips habits that already exist), and the last line of the file
shows how to remove everything it created.

The sample people and habits are illustrative only — nothing in the app knows anything
about them.

---

## Deploying to GitHub Pages

**1. Add the repository secrets.** In your repo: **Settings → Secrets and variables →
Actions → New repository secret**. Add both:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

(Same values as your `.env`. They are used as build inputs, not because they are
sensitive — see below.)

**2. Turn on Pages.** **Settings → Pages → Build and deployment → Source: GitHub
Actions**.

**3. Push to `main`.** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
typechecks, runs the unit tests, builds, and deploys. A failing typecheck or test stops
the deployment, so a broken build never reaches anyone's phone. You can also re-run it
by hand from the **Actions** tab.

Your app appears at `https://<username>.github.io/<repo>/`.

**Add it to a Home Screen.** In iOS Safari, tap Share → *Add to Home Screen*. It
launches standalone, with its own icon and no browser chrome.

### How the subpath is handled

GitHub Pages serves from `/<repo>/`, not `/`. Two things make that work:

- **Asset paths.** The workflow sets `VITE_BASE_PATH=/${{ github.event.repository.name }}/`,
  which Vite uses as its `base`. It is derived from the repo name, so renaming or
  forking the repository needs no code change. Local builds default to `/`.
- **Routing.** The app uses `HashRouter`, so URLs look like
  `https://user.github.io/habits/#/week`. GitHub Pages cannot rewrite unknown paths to
  `index.html`, so with a normal router a refresh on `/week` would 404. The usual
  workaround is a `404.html` that reconstructs the URL in JavaScript, which adds a
  redirect flash and one more thing to maintain. Hash routing simply cannot break, and
  refreshing or deep-linking any screen works.

---

## Environment variables and what is safe to expose

| Variable | Where it goes | Safe in the browser? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Bundle, GitHub Pages | **Yes** |
| `VITE_SUPABASE_ANON_KEY` | Bundle, GitHub Pages | **Yes** |
| `service_role` key | **Nowhere in this repo** | **Never** |
| Database password | **Nowhere in this repo** | **Never** |
| JWT secret | **Nowhere in this repo** | **Never** |

Anything prefixed `VITE_` is compiled into the JavaScript that ships to GitHub Pages.
Assume anyone can read it, because they can.

That is fine for the URL and anon key. The anon key identifies the project; it does not
grant access. What a request may actually read or write is decided by the RLS policies,
evaluated per request against the caller's JWT. An anon key with no valid session gets
nothing — the tests confirm it is refused before policies are even consulted.

The **service-role key is different**: it bypasses RLS entirely. It must never appear
in `.env`, in any `VITE_` variable, in `src/`, or in a GitHub Actions build step for
this app. Nothing here needs it. Admin SQL runs in the Supabase dashboard's SQL editor,
which is already authenticated.

---

## Tests

```bash
npm test          # unit tests for the domain logic
npm run test:rls  # database policy tests (needs Docker)
npm run typecheck # tsc, no emit
```

### Unit tests

109 tests over `src/domain` — the recurrence, streak, week-boundary and timezone logic.
No component or network mocking; these are pure functions, which is the point of
keeping the logic out of the components.

Covered edge cases include: a weekday-only habit across a weekend, a missed scheduled
day, a weekly target spanning the Monday boundary, a completion at 11:30pm local time,
DST spring-forward and fall-back in both hemispheres, leap days, year boundaries,
archived habits, and private habits.

### Database policy tests

`npm run test:rls` spins up a throwaway Postgres container, applies a small shim that
fakes Supabase's `auth` schema and roles, runs the **real, unmodified migration** on
top, and then asserts against it while impersonating users exactly the way PostgREST
does. Roughly 50 assertions, covering:

- a friend cannot see a private habit, or reach it by explicit id
- a friend cannot see check-ins belonging to a private habit
- an unrelated authenticated account sees nothing at all from the group
- an unauthenticated request is refused at the grant level
- nobody can check off, edit or delete someone else's habit
- nobody can create a group or add themselves to one
- owners *can* do all of those things to their own

See [`supabase/tests/README.md`](supabase/tests/README.md).

---

## Architecture

```
src/
  domain/        Pure business logic. No React, no network. All the tests live here.
    dates.ts       Timezone-aware calendar maths (Luxon).
    recurrence.ts  Is it due? How is the week going?
    streaks.ts     Scheduled streaks, weekly consistency, history summaries.
    status.ts      View models for Today and Week.
  services/      Every Supabase query in the app. Nothing else talks to the database.
  hooks/         useAuth (session) and useAppData (the single data load + writes).
  components/    Reusable UI: rows, buttons, layout, form, toast.
  screens/       One file per screen. Thin — they arrange domain output.
  types/         Shared model types.

supabase/
  migrations/    The versioned schema. One file, complete.
  bootstrap.sql  One-time: create the group, add the three people.
  seed.sql       Optional development data.
  tests/         RLS test suite (see above).
```

**Data flow.** `useAppData` loads everything once — profile, group, members, habits,
check-ins — and holds it. Screens read from it and derive what they need through
`domain/`. Writes go through the same hook, so an optimistic update and its rollback
sit next to the state they touch.

**Two queries for check-ins**, not one: your own habits get a long window (streaks are
computed from it), while friends' habits get just the current week, which is all their
cards show. It keeps the payload small on a phone.

**Realtime** subscribes to `habits` and `habit_checkins` purely as a *something
changed* signal — the payload is never trusted or merged, it just triggers a debounced
refetch. RLS then decides what comes back, exactly as on first load.

---

## Security model

The frontend is public static code. Anyone can read it, change it in devtools, or skip
it entirely and call the API directly. So none of the security lives there.

**Everything is enforced by Row Level Security**, in
[`supabase/migrations/20260816000000_init.sql`](supabase/migrations/20260816000000_init.sql).
Every table has RLS enabled and explicit policies; with no policy matching, a read
returns zero rows and a write is rejected. The default is deny.

The guarantees:

- **Private habits are private.** A habit is readable only by its owner, or if it is
  `shared` and lives in a group you belong to. Another person's private habit — its
  name, its emoji, its existence — never reaches your browser. The UI does not filter
  private habits out; it never receives them.
- **You cannot touch anyone else's data.** Habits and check-ins are writable only by
  their owner. Marking a friend's habit complete fails twice over: the RLS policy
  rejects a forged `user_id`, and a composite foreign key on `habits(id, owner_id)`
  rejects your own `user_id` paired with their habit. That second one holds even for a
  service-role client that bypasses policies entirely.
- **Strangers get nothing.** An authenticated account outside your group sees zero
  habits, check-ins, profiles and memberships. An unauthenticated request is refused
  before any policy runs, because `anon` has had its table privileges revoked.
- **Groups are closed.** The client has no way to create a group or join one.

Two small helper functions (`my_group_ids`, `shares_group_with`) are `SECURITY
DEFINER`. That is deliberate: a policy on `group_members` that queries `group_members`
would recurse infinitely, and running that one lookup as the definer breaks the cycle.
They take no free-form input, compare only against `auth.uid()`, run with an empty
`search_path`, and are not executable by `anon`.

All of the above is asserted by `npm run test:rls`.

---

## Design decisions

**Dates are local calendar days, never UTC days.** Each person's profile carries an
IANA timezone, and every "is it due", "what is today", "which week", and streak
question is answered in the *habit owner's* zone. A habit checked off at 11:30pm in New
York belongs to that day. Timestamps are still stored normally for auditing, but the
logical `completion_date` is modelled explicitly as a `date`. Luxon does the arithmetic
— no hand-rolled offset maths.

**Weekdays are ISO-8601 everywhere**: 1 = Monday … 7 = Sunday, in the database, the
domain logic and the UI. It matches Luxon's `DateTime.weekday`, so nothing ever
converts. Weeks run Monday–Sunday, isolated in one constant so it can become a setting
later.

**`scheduled_days` is a `smallint[]`, not a join table.** The spec offered a normalised
`habit_schedule_days`, but for a set of at most seven small integers that is a join and
a second write on every edit, in exchange for nothing. A check constraint enforces that
the array is sorted, distinct, and within 1–7, so it cannot drift.

**Today is not re-sorted when you check something off.** Rows jumping out from under
your finger mid-tap is worse than seeing completed items in place, so the order is
stable (oldest habit first).

**A weekly habit that has hit its target reads as done** on the remaining days of the
week, rather than sitting unchecked and looking like a reproach.

**A scheduled day that is *today and not yet done* is pending, not missed.** Without
that rule every streak in the app would read zero each morning.

**Three tabs, not four.** The Activity feed is a later phase, and an empty "coming
later" tab would be permanent clutter in an app this small.

**Archive, don't delete.** Archiving keeps all history and just removes the habit from
Today and Week. Permanent deletion exists but sits behind a two-step confirmation that
names how many check-ins will go with it.

**Email + password, not magic links.** It works identically under a GitHub Pages
subpath, needs no redirect-URL configuration, and does not depend on a link opening in
the same browser it was requested from — which on iOS is a real source of friction.

---

## Try it locally without a Supabase account

If you have Docker, one command gives you the whole thing — a local Supabase stack,
three demo accounts, a group, and a few weeks of history — without touching any real
project:

```bash
npm run dev:local
```

Then:

```bash
npm run dev
```

Sign in as any of `monica@example.com`, `ura@example.com` or `ojas@example.com`,
password `password123`.

Monica has a **private** habit called *Therapy*. Sign in as Ura and you will not find
it anywhere — not on Today, not by URL, and not in the network responses. That is the
privacy boundary, enforced by database policy rather than by the UI.

Also available while it runs:

- **Supabase Studio** — <http://127.0.0.1:54323> (browse the tables, watch check-ins land)
- **Inbox** — <http://127.0.0.1:54324> (any auth emails)

When you are done:

```bash
npx supabase stop
```

[`scripts/dev-local.sh`](scripts/dev-local.sh) refuses to run against anything that is
not on localhost, so it cannot create demo accounts in your real project.

Seeding on `supabase start` is turned off in `supabase/config.toml` on purpose: both
`bootstrap.sql` and `seed.sql` look accounts up by email, so they cannot run before
anyone has signed up.

> Rebuilding the local database while a browser tab still holds a session from the
> previous one leaves that tab with a token for a user that no longer exists. The app
> detects this and says so, with a Sign out button — that is expected, not a bug.

---

## Not built yet

Deliberately out of scope for now, though the schema leaves room for them: nudges, push
notifications, "at risk" status, grace/excused days, reactions, an activity feed, and
avoidance habits (which need different success semantics and should be designed
separately).

None of these are faked or stubbed anywhere in the code.
