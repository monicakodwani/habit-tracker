# Database tests

These verify that Row Level Security actually does what the comments in the migration
claim — most importantly, that a private habit never leaves the database for anyone but
its owner, and that nobody can check off someone else's habit.

They run against a throwaway Postgres container, not your real project:

```bash
npm run test:rls
```

## How it works

Supabase's hosted Postgres has things stock Postgres does not: an `auth` schema, the
`anon` / `authenticated` roles, `auth.uid()`, and the `supabase_realtime` publication.
[`00_supabase_shim.sql`](00_supabase_shim.sql) recreates the minimum of that, so the
**real, unmodified migration** can be applied on top of it.

[`01_rls_test.sql`](01_rls_test.sql) then impersonates users the same way PostgREST
does — `set role authenticated` plus a `request.jwt.claims` setting carrying the user's
id — so each assertion exercises the same policy evaluation a real browser request
would. Any failed assertion aborts the run with a non-zero exit code.

The fixtures cover four accounts: three friends in one group, plus an unrelated
authenticated account in a different group used to prove cross-group isolation.

## What is covered

**Privacy**

- A friend cannot see a private habit, or reach it by explicit id.
- A friend cannot see check-ins belonging to a private habit.
- An unrelated authenticated account sees zero habits, check-ins, profiles or
  memberships from the group.
- An unauthenticated (`anon`) request is refused at the grant level, before policies.

**Write protection**

- A friend cannot rename, delete, or check off someone else's habit — the latter fails
  both via the RLS policy (forged `user_id`) and via the composite foreign key (their
  own `user_id` paired with a habit they do not own).
- A friend cannot delete someone else's check-in or edit their profile.
- Nobody can create a group or add themselves to one from the client.
- Nobody can create a habit owned by someone else or in a group they are not in.

**Owner capabilities**

- Owners can rename their habits, check in, undo a check-in, and edit their profile.

**Schema constraints**

- At most one check-in per habit per local day.
- `scheduled_days` must be sorted, distinct, and within 1–7.
- A habit carries exactly one recurrence shape.
- The `on_auth_user_created` trigger creates a profile for every new account.

## Note

The shim is test-only scaffolding. It is never applied to your Supabase project — the
only file that runs there is `supabase/migrations/*.sql`.
