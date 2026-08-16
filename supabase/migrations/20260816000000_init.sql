-- ============================================================================
-- Habit accountability app — initial schema (Phase 1)
--
-- Design notes worth knowing before you read the policies:
--
--   * The React client is public static code on GitHub Pages and ships with the
--     Supabase ANON key. Every security guarantee in this app therefore has to be
--     enforced here, in Row Level Security, not in the UI.
--
--   * Weekday convention is ISO-8601 everywhere: 1 = Monday ... 7 = Sunday.
--     This matches Luxon's `DateTime.weekday`, which the frontend uses directly.
--
--   * Weeks run Monday -> Sunday.
--
--   * "Today" is a *local calendar day in the habit owner's timezone*, never a UTC
--     day. That is why `habit_checkins.completion_date` is a plain `date` computed
--     by the client in the owner's timezone, and is kept separate from `created_at`
--     (which is a real timestamptz, for auditing only).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

create type public.recurrence_type as enum (
  'scheduled_days', -- due on specific weekdays (every day, weekdays, Tue+Sat, ...)
  'weekly_target'   -- due N times in a Mon-Sun week, on any days
);

create type public.habit_visibility as enum (
  'shared',  -- other members of the habit's group can see it and its check-ins
  'private'  -- only the owner can see it, enforced by RLS, not by UI filtering
);

-- ----------------------------------------------------------------------------
-- Validation helper
--
-- Defined before the tables because `habits` uses it inside a CHECK constraint.
-- CHECK constraints may only call IMMUTABLE functions.
-- ----------------------------------------------------------------------------

-- Validates the scheduled_days array: 1..7 entries, no NULLs, each a valid ISO
-- weekday, strictly ascending (which also rules out duplicates).
create or replace function public.is_valid_weekday_set(days smallint[])
returns boolean
language sql
immutable
parallel safe
as $$
  select days is not null
     and cardinality(days) between 1 and 7
     and array_position(days, null::smallint) is null  -- no NULL entries
     and days[1] >= 1
     and days[cardinality(days)] <= 7
     -- strictly ascending: every element is greater than the one before it
     and not exists (
       select 1
       from generate_subscripts(days, 1) as i
       where i > 1 and days[i] <= days[i - 1]
     );
$$;

comment on function public.is_valid_weekday_set is
  'True when the array is a sorted, distinct, non-empty set of ISO weekdays (1=Mon..7=Sun).';

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- One row per authenticated user. `id` mirrors auth.users.id.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text        not null check (
                              length(btrim(display_name)) between 1 and 40
                            ),
  avatar_emoji  text        not null default '🌱' check (
                              length(avatar_emoji) between 1 and 8
                            ),
  -- IANA timezone name, e.g. 'America/New_York'. Drives every "what day is it"
  -- decision for this user's habits. Validated in the client against Intl data;
  -- the DB only guarantees it is non-empty and plausibly shaped.
  timezone      text        not null default 'America/New_York' check (
                              timezone ~ '^[A-Za-z0-9+_/-]{3,64}$'
                            ),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Public-ish user profile. Readable by other members of the same group only.';

-- A private accountability group. Phase 1 uses exactly one, but nothing is
-- hard-coded to a single group so more can be added later.
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid        not null references public.groups (id)   on delete cascade,
  user_id   uuid        not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Look up "who else is in this group" without scanning.
create index group_members_user_id_idx on public.group_members (user_id);

create table public.habits (
  id         uuid not null default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  group_id   uuid not null references public.groups (id)   on delete cascade,

  name       text not null check (length(btrim(name)) between 1 and 60),
  emoji      text not null default '✅' check (length(emoji) between 1 and 8),

  recurrence_type public.recurrence_type   not null,
  -- Set only for 'scheduled_days'. ISO weekdays, e.g. '{1,2,3,4,5}' = Mon-Fri.
  scheduled_days  smallint[]               null,
  -- Set only for 'weekly_target'. Number of completions wanted per Mon-Sun week.
  weekly_target   smallint                 null,

  -- Archiving is a soft delete: inactive habits stop appearing on Today but keep
  -- their check-in history.
  active     boolean not null default true,
  visibility public.habit_visibility not null default 'shared',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (id),

  -- Lets habit_checkins carry a composite foreign key on (habit_id, user_id), which
  -- makes "you cannot check off someone else's habit" a structural guarantee rather
  -- than something a policy has to remember to check. See habit_checkins below.
  unique (id, owner_id),

  -- Exactly one recurrence shape is populated, and it is populated correctly.
  constraint habits_recurrence_shape check (
    case recurrence_type
      when 'scheduled_days' then
        scheduled_days is not null
        and weekly_target is null
        and public.is_valid_weekday_set(scheduled_days)
      when 'weekly_target' then
        weekly_target is not null
        and weekly_target between 1 and 7
        and scheduled_days is null
    end
  )
);

create index habits_owner_id_idx on public.habits (owner_id);
-- The Today screen's friend query is "shared + active habits in my group".
create index habits_group_shared_idx on public.habits (group_id)
  where visibility = 'shared' and active;

comment on column public.habits.scheduled_days is
  'ISO weekdays (1=Mon .. 7=Sun), sorted ascending and distinct. Only for recurrence_type = scheduled_days.';

-- One row per (habit, local calendar day) that the owner completed.
create table public.habit_checkins (
  id              uuid primary key default gen_random_uuid(),
  habit_id        uuid not null,
  user_id         uuid not null,
  -- The owner's *local* calendar date, decided client-side in their timezone.
  completion_date date not null,
  created_at      timestamptz not null default now(),

  -- Composite FK: user_id must be the habit's owner_id. It is impossible to insert a
  -- check-in attributed to anyone other than the habit's owner, even with a service key.
  constraint habit_checkins_habit_owner_fkey
    foreign key (habit_id, user_id)
    references public.habits (id, owner_id)
    on delete cascade,

  -- At most one completion per habit per local day.
  constraint habit_checkins_one_per_day unique (habit_id, completion_date)
);

-- Streak/history queries walk a habit's check-ins newest-first.
create index habit_checkins_habit_date_idx
  on public.habit_checkins (habit_id, completion_date desc);
-- The Today/Week screens load "everything for these users in this date range".
create index habit_checkins_user_date_idx
  on public.habit_checkins (user_id, completion_date desc);

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- RLS helpers.
--
-- These are SECURITY DEFINER on purpose. A policy on `group_members` that itself
-- queries `group_members` would recurse infinitely; running the membership lookup
-- as the definer skips RLS for that one lookup and breaks the cycle.
--
-- They are deliberately narrow: they take no free-form input, only compare against
-- auth.uid(), and return nothing but the caller's own memberships. `set search_path
-- = ''` prevents search-path hijacking, so every reference is schema-qualified.
-- ---------------------------------------------------------------------------

-- The set of group ids the *calling* user belongs to.
create or replace function public.my_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gm.group_id
  from public.group_members gm
  where gm.user_id = (select auth.uid());
$$;

-- True when `target_user` is in at least one group with the calling user.
-- Note this is also true when target_user = auth.uid(), so "I can see myself" is covered.
create or replace function public.shares_group_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members them on them.group_id = me.group_id
    where me.user_id = (select auth.uid())
      and them.user_id = target_user
  );
$$;

-- Keeps updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger habits_touch_updated_at
  before update on public.habits
  for each row execute function public.touch_updated_at();

-- Every new auth user gets a profile automatically, so the app never has to deal
-- with a signed-in user that has no profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_emoji, timezone)
  values (
    new.id,
    -- Prefer a display name supplied at sign-up, else the local part of the email.
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1),
      'Friend'
    ),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'avatar_emoji'), ''), '🌱'),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'timezone'), ''), 'America/New_York')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- Enabled on every table. With no policy matching, a query returns zero rows and a
-- write is rejected — so the default posture is "deny", and each policy below opens
-- exactly one door.
-- ----------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.habits         enable row level security;
alter table public.habit_checkins enable row level security;

-- --- profiles ---------------------------------------------------------------

-- Read the profiles of people you share a group with (this includes yourself).
-- A signed-in stranger shares no group with us, so they see nothing.
create policy profiles_select_group_members
  on public.profiles for select
  to authenticated
  using (public.shares_group_with(id));

-- You may only ever create or edit your own profile. The auth trigger normally
-- creates it; this insert policy exists so the app can self-heal if it is missing.
create policy profiles_insert_self
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Deliberately no DELETE policy: profiles disappear when the auth user is deleted.

-- --- groups -----------------------------------------------------------------

-- Read only groups you belong to.
create policy groups_select_own
  on public.groups for select
  to authenticated
  using (id in (select public.my_group_ids()));

-- Deliberately no INSERT/UPDATE/DELETE policies. Group creation is an admin action
-- performed in the Supabase SQL editor (see supabase/bootstrap.sql). Phase 1 has no
-- group-management UI, so the client is given no way to touch these rows at all.

-- --- group_members ----------------------------------------------------------

-- See the membership rows of your own groups — this is how the app discovers who
-- your two friends are.
create policy group_members_select_own_groups
  on public.group_members for select
  to authenticated
  using (group_id in (select public.my_group_ids()));

-- Deliberately no write policies: nobody can add themselves to a group from the
-- client. Membership is granted by an admin in the SQL editor.

-- --- habits -----------------------------------------------------------------

-- Two ways to see a habit:
--   1. you own it (any visibility, active or archived), or
--   2. it is SHARED and lives in a group you belong to.
-- A private habit therefore never leaves the database for anyone but its owner —
-- not its name, not its emoji, not its existence. This is the guarantee that must
-- not be weakened; the UI never filters private habits out, it simply never receives them.
create policy habits_select_own_or_shared_in_group
  on public.habits for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      visibility = 'shared'
      and group_id in (select public.my_group_ids())
    )
  );

-- You may only create habits you own, and only inside a group you belong to.
create policy habits_insert_own
  on public.habits for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and group_id in (select public.my_group_ids())
  );

-- Editing, archiving and un-archiving are all UPDATEs, and all restricted to the
-- owner. The WITH CHECK clause additionally prevents an owner from moving a habit
-- into a group they are not a member of.
create policy habits_update_own
  on public.habits for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and group_id in (select public.my_group_ids())
  );

-- Permanent deletion is offered in the UI only behind an explicit confirmation.
-- Check-ins cascade with the habit.
create policy habits_delete_own
  on public.habits for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- --- habit_checkins ---------------------------------------------------------

-- You can read your own check-ins, plus the check-ins of SHARED habits belonging to
-- people in your group. The EXISTS clause is what keeps a private habit's check-ins
-- invisible: without a matching shared habit row there is no route to the check-in.
create policy checkins_select_own_or_shared_in_group
  on public.habit_checkins for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.habits h
      where h.id = habit_checkins.habit_id
        and h.visibility = 'shared'
        and h.group_id in (select public.my_group_ids())
    )
  );

-- Only your own check-ins, and only on habits you own. `user_id = auth.uid()` plus
-- the composite FK to habits(id, owner_id) means marking a friend's habit complete
-- fails twice over: the policy rejects a foreign user_id, and the FK rejects your own
-- user_id paired with their habit_id.
create policy checkins_insert_own
  on public.habit_checkins for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy checkins_update_own
  on public.habit_checkins for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Undoing a completion is a DELETE, so it must be allowed — for your rows only.
create policy checkins_delete_own
  on public.habit_checkins for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Grants
--
-- RLS already denies by default, but revoking the `anon` role's table privileges
-- adds a second, coarser lock: a request with no valid JWT is refused before any
-- policy is even consulted.
-- ----------------------------------------------------------------------------

revoke all on public.profiles       from anon;
revoke all on public.groups         from anon;
revoke all on public.group_members  from anon;
revoke all on public.habits         from anon;
revoke all on public.habit_checkins from anon;

grant select, insert, update on public.profiles       to authenticated;
grant select                 on public.groups         to authenticated;
grant select                 on public.group_members  to authenticated;
grant select, insert, update, delete on public.habits         to authenticated;
grant select, insert, update, delete on public.habit_checkins to authenticated;

-- The RLS helpers must not be callable by unauthenticated clients.
revoke all on function public.my_group_ids()          from public, anon;
revoke all on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.my_group_ids()          to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime
--
-- The client subscribes to these tables purely as a "something changed, refetch"
-- signal; it never trusts the payload. Realtime applies the SELECT policies above
-- per-subscriber, so a private habit's inserts are not delivered to friends.
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table public.habit_checkins;
alter publication supabase_realtime add table public.habits;
