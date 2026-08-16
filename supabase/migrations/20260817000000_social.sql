-- ============================================================================
-- Phase 2 — the social layer.
--
-- Adds: avoidance habits, per-habit nudge policy, per-day habit state (at risk /
-- excused / lapsed), nudges, an activity feed with reactions, notification
-- preferences and push subscriptions.
--
-- THIS MIGRATION UPGRADES AN EXISTING, DEPLOYED DATABASE.
-- Every ALTER is additive with a safe default. No existing row is rewritten
-- destructively, no column is dropped, and every existing habit becomes kind 'do'.
--
-- Conventions carried over from the initial migration:
--   * ISO weekdays, 1 = Monday .. 7 = Sunday
--   * weeks run Monday -> Sunday
--   * a "day" is always a LOCAL calendar day in the HABIT OWNER'S timezone,
--     never a UTC day. Server-side code derives it as
--     (now() at time zone owner.timezone)::date so the client cannot lie about it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

-- Success semantics, kept separate from recurrence on purpose: "how often" and
-- "what counts as winning" are different questions and conflating them is how you
-- end up asking people to tick a box every night to confirm they did not order
-- takeout.
create type public.habit_kind as enum (
  'do',    -- success = you did it
  'avoid'  -- success = the day ended and you did not do it
);

-- Who may nudge this habit, and when. Enforced in SQL, never in the client.
create type public.nudge_policy as enum (
  'anytime',
  'after_time',    -- only after habits.nudge_after_time, in the owner's timezone
  'at_risk_only',  -- only when the owner has actively asked for a push
  'never'
);

create type public.activity_type as enum (
  'habit_completed',
  'at_risk',
  'nudge'
);

-- ----------------------------------------------------------------------------
-- habits: new columns
-- ----------------------------------------------------------------------------

alter table public.habits
  add column kind public.habit_kind not null default 'do',
  -- Shared habits default to being nudgeable, which is the whole point of the app.
  add column nudge_policy public.nudge_policy not null default 'anytime',
  -- Local wall-clock time, interpreted in the owner's timezone. Only meaningful
  -- when nudge_policy = 'after_time'.
  add column nudge_after_time time null;

comment on column public.habits.kind is
  'do = success is completing it; avoid = success is a scheduled day ending with no lapse.';
comment on column public.habits.nudge_after_time is
  'Local wall-clock time in the OWNER''S timezone. Only used when nudge_policy = after_time.';

-- Avoidance habits are scheduled-days only. "Avoid takeout 3 times a week" has no
-- coherent meaning, so the schema refuses to store it.
alter table public.habits
  add constraint habits_avoid_is_scheduled check (
    kind = 'do' or recurrence_type = 'scheduled_days'
  );

-- after_time requires a time; every other policy must not carry one.
alter table public.habits
  add constraint habits_nudge_time_shape check (
    (nudge_policy = 'after_time') = (nudge_after_time is not null)
  );

-- Existing rows already got kind='do' and nudge_policy='anytime' from the column
-- defaults. Stated explicitly so the intent survives in the migration history.
update public.habits set kind = 'do' where kind is null;

-- ----------------------------------------------------------------------------
-- habit_days — one row per habit per local day, for everything that is NOT a
-- completion.
--
-- Three concepts share this table because they are all "a fact about this habit on
-- this local date", they are all owned by the habit owner, they are all read by the
-- same queries, and at most one row per habit-day is ever needed. Three separate
-- tables would have meant three joins and three sets of near-identical policies.
--
-- Completions deliberately stay in habit_checkins: that table already exists in
-- production, already has its own constraints, and moving it would be a destructive
-- rewrite for no benefit.
-- ----------------------------------------------------------------------------

create table public.habit_days (
  id       uuid primary key default gen_random_uuid(),
  habit_id uuid not null,
  user_id  uuid not null,
  day_date date not null,

  -- Grace: this occurrence does not count as done, and does not break the streak.
  excused boolean not null default false,

  -- Avoidance only: the thing happened today.
  lapsed boolean not null default false,

  -- "I might miss this — please bother me." NULL means not at risk.
  at_risk_at   timestamptz null,
  at_risk_note text null check (at_risk_note is null or length(at_risk_note) <= 140),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Same composite-FK trick as habit_checkins: user_id is structurally forced to be
  -- the habit's owner, so no policy has to remember to check it.
  constraint habit_days_habit_owner_fkey
    foreign key (habit_id, user_id) references public.habits (id, owner_id)
    on delete cascade,

  constraint habit_days_one_per_day unique (habit_id, day_date),

  -- A day cannot be both formally excused and a lapse.
  constraint habit_days_excused_xor_lapsed check (not (excused and lapsed))
);

create index habit_days_habit_date_idx on public.habit_days (habit_id, day_date desc);
create index habit_days_user_date_idx  on public.habit_days (user_id, day_date desc);
-- The Today screen asks "who is at risk right now", so index only those rows.
create index habit_days_at_risk_idx on public.habit_days (day_date, habit_id)
  where at_risk_at is not null;

create trigger habit_days_touch_updated_at
  before update on public.habit_days
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- nudges
-- ----------------------------------------------------------------------------

create table public.nudges (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id)   on delete cascade,
  habit_id     uuid not null references public.habits (id)   on delete cascade,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  -- The recipient's local day the nudge was about.
  day_date     date not null,
  -- Preset key (see PRESETS in the frontend) or null for a free-text nudge.
  preset       text null check (preset is null or length(preset) <= 40),
  message      text not null check (length(btrim(message)) between 1 and 200),
  created_at   timestamptz not null default now(),

  constraint nudges_no_self check (sender_id <> recipient_id)
);

-- Cooldown lookups: "has this sender nudged this habit recently".
create index nudges_cooldown_idx on public.nudges (sender_id, habit_id, created_at desc);
create index nudges_recipient_idx on public.nudges (recipient_id, created_at desc);

-- ----------------------------------------------------------------------------
-- activity_events
--
-- Immutable social events. Rows are only ever created by SECURITY DEFINER code
-- (triggers and RPCs) — `authenticated` has no INSERT grant at all, so an actor or
-- group can never be forged from the client.
--
-- habit_name / habit_emoji are snapshotted into metadata so rendering the feed needs
-- no join against habits, and so a deleted habit does not leave a nonsensical row.
-- Snapshotting is not a privacy leak because events are ONLY created for SHARED
-- habits, and a trigger deletes them if a habit later becomes private.
-- ----------------------------------------------------------------------------

create table public.activity_events (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups (id)   on delete cascade,
  actor_id       uuid not null references public.profiles (id) on delete cascade,
  -- Set for nudges: who it was aimed at.
  target_user_id uuid null references public.profiles (id) on delete cascade,
  habit_id       uuid null references public.habits (id) on delete cascade,
  type           public.activity_type not null,
  day_date       date not null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- The feed is "this group, newest first, paginated".
create index activity_events_group_created_idx
  on public.activity_events (group_id, created_at desc);
create index activity_events_habit_idx on public.activity_events (habit_id);

-- ----------------------------------------------------------------------------
-- event_reactions — one reaction per person per event.
-- ----------------------------------------------------------------------------

create table public.event_reactions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.activity_events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (emoji in ('❤️', '🎉', '👏', '🫡', '😂', '🔥')),
  created_at timestamptz not null default now(),

  constraint event_reactions_one_per_user unique (event_id, user_id)
);

create index event_reactions_event_idx on public.event_reactions (event_id);

-- ----------------------------------------------------------------------------
-- notification_prefs — one row per user, created on demand.
-- ----------------------------------------------------------------------------

create table public.notification_prefs (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  -- The two that are the point of the app default on.
  nudges     boolean not null default true,
  at_risk    boolean not null default true,
  -- Reactions are the noisiest and the least urgent, so they default off.
  reactions  boolean not null default false,
  -- When false, push payloads say "a habit" instead of naming it. Notifications
  -- land on lock screens; some people would rather not broadcast "Therapy".
  show_habit_names boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger notification_prefs_touch_updated_at
  before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- push_subscriptions
--
-- Raw Web Push endpoints and crypto material. This is the most sensitive table in
-- the database: anyone holding an endpoint plus keys can push to that device. It is
-- readable ONLY by its owner, and is deliberately NOT added to the realtime
-- publication.
-- ----------------------------------------------------------------------------

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Unique across the whole table: the same browser re-subscribing must update its
  -- row rather than accumulate duplicates.
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create trigger push_subscriptions_touch_updated_at
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Helper functions
-- ============================================================================

-- The habit owner's current local calendar date. Every "is this today" decision on
-- the server goes through here, so the client can never assert its own day.
create or replace function public.owner_today(p_habit_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(p.timezone, 'UTC'))::date
  from public.habits h
  join public.profiles p on p.id = h.owner_id
  where h.id = p_habit_id;
$$;

-- The habit owner's current local wall-clock time, for the 'after_time' policy.
create or replace function public.owner_local_time(p_habit_id uuid)
returns time
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(p.timezone, 'UTC'))::time
  from public.habits h
  join public.profiles p on p.id = h.owner_id
  where h.id = p_habit_id;
$$;

-- Monday of the week containing p_date. Weeks run Monday–Sunday, matching the
-- frontend's WEEK_STARTS_ON.
create or replace function public.week_start(p_date date)
returns date
language sql
immutable
as $$
  select p_date - ((extract(isodow from p_date)::int - 1) * interval '1 day');
$$;

/*
 * Scheduled-occurrence streak ending at p_date, mirroring src/domain/streaks.ts.
 *
 * Walks backwards over scheduled weekdays only:
 *   - completed  -> extends the run
 *   - excused    -> neutral, skipped entirely
 *   - anything else -> the run ends
 *
 * p_date itself is included only if completed; a pending today neither extends nor
 * breaks the run, which is the same rule the client uses.
 *
 * Used solely to decorate feed events ("🔥 10-day streak"). Returns null when the
 * habit has no daily streak semantics.
 */
create or replace function public.scheduled_streak_at(p_habit_id uuid, p_date date)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h        public.habits%rowtype;
  cursor_d date;
  run      int := 0;
  guard    int := 0;
  done     boolean;
  excused  boolean;
begin
  select * into h from public.habits where id = p_habit_id;
  if not found or h.recurrence_type <> 'scheduled_days' or h.kind <> 'do' then
    return null;
  end if;

  cursor_d := p_date;
  -- Bounded so a pathological schedule can never spin: 800 days is far beyond any
  -- streak this app will show.
  while guard < 800 loop
    guard := guard + 1;

    if extract(isodow from cursor_d)::smallint = any (h.scheduled_days) then
      select exists (
        select 1 from public.habit_checkins c
        where c.habit_id = p_habit_id and c.completion_date = cursor_d
      ) into done;

      if done then
        run := run + 1;
      else
        select coalesce(bool_or(d.excused), false) into excused
        from public.habit_days d
        where d.habit_id = p_habit_id and d.day_date = cursor_d;

        if excused then
          null;                       -- neutral: neither extends nor breaks
        elsif cursor_d = p_date then
          null;                       -- today is still pending, not missed
        else
          exit;                       -- a real miss ends the run
        end if;
      end if;
    end if;

    cursor_d := cursor_d - 1;
  end loop;

  return run;
end;
$$;

-- ============================================================================
-- Activity events are written only by trusted server-side code.
-- ============================================================================

/*
 * Records a completion in the feed.
 *
 * Fires on habit_checkins insert, and ONLY for shared habits — a private habit must
 * never produce a social event. Undoing a completion removes the event, so the feed
 * never claims something that has since been retracted.
 */
create or replace function public.on_checkin_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h      public.habits%rowtype;
  streak int;
begin
  if tg_op = 'DELETE' then
    delete from public.activity_events
    where type = 'habit_completed'
      and habit_id = old.habit_id
      and day_date = old.completion_date;
    return old;
  end if;

  select * into h from public.habits where id = new.habit_id;
  if not found or h.visibility <> 'shared' then
    return new;   -- private habits are invisible to the feed, full stop
  end if;

  streak := public.scheduled_streak_at(new.habit_id, new.completion_date);

  insert into public.activity_events (
    group_id, actor_id, habit_id, type, day_date, metadata
  )
  values (
    h.group_id, h.owner_id, h.id, 'habit_completed', new.completion_date,
    jsonb_strip_nulls(jsonb_build_object(
      'habit_name',  h.name,
      'habit_emoji', h.emoji,
      'streak',      streak
    ))
  );

  -- Completing it answers the call for help.
  update public.habit_days
  set at_risk_at = null, at_risk_note = null
  where habit_id = new.habit_id and day_date = new.completion_date
    and at_risk_at is not null;

  return new;
end;
$$;

create trigger habit_checkins_activity_ins
  after insert on public.habit_checkins
  for each row execute function public.on_checkin_activity();

create trigger habit_checkins_activity_del
  after delete on public.habit_checkins
  for each row execute function public.on_checkin_activity();

/*
 * Privacy backstop: if a habit is switched from shared to private, its social trail
 * goes with it. Without this, "Monica completed Reading" would survive in the feed
 * after Monica decided Reading was nobody else's business.
 */
create or replace function public.on_habit_visibility_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.visibility = 'private' and old.visibility = 'shared' then
    delete from public.activity_events where habit_id = new.id;
    delete from public.nudges where habit_id = new.id;
  end if;
  return new;
end;
$$;

create trigger habits_visibility_privacy
  after update of visibility on public.habits
  for each row execute function public.on_habit_visibility_change();

-- ============================================================================
-- RPCs — the social actions with rules that must not be bypassable.
--
-- All are SECURITY DEFINER because they must read the owner's timezone and other
-- members' rows to validate. Each one:
--   * takes only narrow, typed inputs (never an actor id — that comes from auth.uid())
--   * pins search_path to ''
--   * authorises explicitly before doing anything
--   * is granted to `authenticated` only
-- ============================================================================

/*
 * Sends a nudge, enforcing every rule server-side.
 *
 * Rejects unless ALL hold:
 *   - the caller is signed in and is not the habit's owner
 *   - caller and owner share the habit's group
 *   - the habit is shared and active
 *   - the habit is relevant today and not already satisfied
 *   - today is not excused
 *   - the habit's nudge policy permits it right now
 *   - the caller has not nudged this habit within the cooldown
 *
 * Errors are deliberately generic ('Not allowed right now') so the function cannot be
 * used to probe another person's settings or habit state.
 */
create or replace function public.send_nudge(
  p_habit_id uuid,
  p_message  text,
  p_preset   text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller     uuid := (select auth.uid());
  h          public.habits%rowtype;
  today      date;
  msg        text := btrim(coalesce(p_message, ''));
  week_done  int;
  is_excused boolean;
  is_lapsed  boolean;
  at_risk    boolean;
  new_id     uuid;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if length(msg) = 0 or length(msg) > 200 then
    raise exception 'Message must be 1-200 characters' using errcode = '22023';
  end if;

  select * into h from public.habits where id = p_habit_id;
  if not found then
    raise exception 'Not allowed right now' using errcode = '42501';
  end if;

  -- Owner, sharing, activity. Checked before anything else so a private habit
  -- cannot be probed for existence via a different error.
  if h.owner_id = caller
     or h.visibility <> 'shared'
     or not h.active
     or not public.shares_group_with(h.owner_id)
  then
    raise exception 'Not allowed right now' using errcode = '42501';
  end if;

  today := (now() at time zone (
    select coalesce(p.timezone, 'UTC') from public.profiles p where p.id = h.owner_id
  ))::date;

  select coalesce(bool_or(d.excused), false),
         coalesce(bool_or(d.lapsed), false),
         coalesce(bool_or(d.at_risk_at is not null), false)
  into is_excused, is_lapsed, at_risk
  from public.habit_days d
  where d.habit_id = h.id and d.day_date = today;

  if is_excused then
    raise exception 'Not allowed right now' using errcode = '42501';
  end if;

  -- Relevance and "not already satisfied", per habit shape.
  if h.recurrence_type = 'weekly_target' then
    select count(*) into week_done
    from public.habit_checkins c
    where c.habit_id = h.id
      and c.completion_date >= public.week_start(today)
      and c.completion_date <  public.week_start(today) + 7;
    if week_done >= h.weekly_target then
      raise exception 'Not allowed right now' using errcode = '42501';
    end if;
  else
    if not (extract(isodow from today)::smallint = any (h.scheduled_days)) then
      raise exception 'Not allowed right now' using errcode = '42501';
    end if;
    if h.kind = 'do' then
      if exists (
        select 1 from public.habit_checkins c
        where c.habit_id = h.id and c.completion_date = today
      ) then
        raise exception 'Not allowed right now' using errcode = '42501';
      end if;
    else
      -- Avoidance: encouragement is welcome while the day is still going, but once
      -- someone has logged a slip, piling on is exactly what this app should not do.
      if is_lapsed then
        raise exception 'Not allowed right now' using errcode = '42501';
      end if;
    end if;
  end if;

  -- The owner's own policy.
  if h.nudge_policy = 'never' then
    raise exception 'Not allowed right now' using errcode = '42501';
  elsif h.nudge_policy = 'at_risk_only' and not at_risk then
    raise exception 'Not allowed right now' using errcode = '42501';
  elsif h.nudge_policy = 'after_time' then
    if (now() at time zone (
          select coalesce(p.timezone, 'UTC') from public.profiles p where p.id = h.owner_id
        ))::time < h.nudge_after_time
    then
      raise exception 'Not allowed right now' using errcode = '42501';
    end if;
  end if;

  -- Anti-spam: same sender, same habit, twice within two hours.
  if exists (
    select 1 from public.nudges n
    where n.sender_id = caller
      and n.habit_id = h.id
      and n.created_at > now() - interval '2 hours'
  ) then
    raise exception 'You already nudged this recently' using errcode = '53400';
  end if;

  insert into public.nudges (
    group_id, habit_id, sender_id, recipient_id, day_date, preset, message
  )
  values (h.group_id, h.id, caller, h.owner_id, today, nullif(btrim(coalesce(p_preset, '')), ''), msg)
  returning id into new_id;

  insert into public.activity_events (
    group_id, actor_id, target_user_id, habit_id, type, day_date, metadata
  )
  values (
    h.group_id, caller, h.owner_id, h.id, 'nudge', today,
    jsonb_strip_nulls(jsonb_build_object(
      'habit_name',  h.name,
      'habit_emoji', h.emoji,
      -- The preset label is fun to show; a custom message stays between the two of them.
      'preset',      nullif(btrim(coalesce(p_preset, '')), '')
    ))
  );

  return new_id;
end;
$$;

/*
 * "I might miss this today — please bother me."
 *
 * Only the owner, only their own shared, active, unfinished habit, always for the
 * owner's local today. Idempotent: re-marking refreshes the note.
 */
create or replace function public.mark_at_risk(p_habit_id uuid, p_note text default null)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  h      public.habits%rowtype;
  today  date;
  note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into h from public.habits where id = p_habit_id;
  if not found or h.owner_id <> caller or h.visibility <> 'shared' or not h.active then
    raise exception 'Not allowed right now' using errcode = '42501';
  end if;

  if note is not null and length(note) > 140 then
    raise exception 'Note is too long' using errcode = '22023';
  end if;

  today := public.owner_today(p_habit_id);

  insert into public.habit_days (habit_id, user_id, day_date, at_risk_at, at_risk_note)
  values (h.id, caller, today, now(), note)
  on conflict (habit_id, day_date) do update
    set at_risk_at = now(), at_risk_note = excluded.at_risk_note;

  -- One at-risk event per habit per day, so re-marking does not spam the feed.
  if not exists (
    select 1 from public.activity_events e
    where e.type = 'at_risk' and e.habit_id = h.id and e.day_date = today
  ) then
    insert into public.activity_events (
      group_id, actor_id, habit_id, type, day_date, metadata
    )
    values (
      h.group_id, caller, h.id, 'at_risk', today,
      jsonb_strip_nulls(jsonb_build_object(
        'habit_name',  h.name,
        'habit_emoji', h.emoji,
        'note',        note
      ))
    );
  end if;

  return today;
end;
$$;

/* Clears the at-risk flag for the owner's today. */
create or replace function public.clear_at_risk(p_habit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.habit_days d
  set at_risk_at = null, at_risk_note = null
  where d.habit_id = p_habit_id
    and d.user_id = caller
    and d.day_date = public.owner_today(p_habit_id);
end;
$$;

/*
 * Excuse or un-excuse a scheduled occurrence.
 *
 * Weekly-target habits are rejected: their semantics are week-level, and a per-day
 * excuse on "exercise 3x/week" means nothing.
 *
 * The date must be within the last 60 days and not in the future, in the owner's
 * timezone — you can excuse yesterday's flu, not next month.
 */
create or replace function public.set_excused(
  p_habit_id uuid,
  p_date     date,
  p_excused  boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  h      public.habits%rowtype;
  today  date;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into h from public.habits where id = p_habit_id;
  if not found or h.owner_id <> caller then
    raise exception 'Not allowed right now' using errcode = '42501';
  end if;
  if h.recurrence_type <> 'scheduled_days' then
    raise exception 'Only scheduled habits can be excused' using errcode = '22023';
  end if;

  today := public.owner_today(p_habit_id);
  if p_date > today or p_date < today - 60 then
    raise exception 'That date is out of range' using errcode = '22023';
  end if;
  if not (extract(isodow from p_date)::smallint = any (h.scheduled_days)) then
    raise exception 'That day was not scheduled' using errcode = '22023';
  end if;

  insert into public.habit_days (habit_id, user_id, day_date, excused)
  values (h.id, caller, p_date, p_excused)
  on conflict (habit_id, day_date) do update
    -- Excusing a day clears any lapse on it; the two are mutually exclusive.
    set excused = p_excused,
        lapsed  = case when p_excused then false else public.habit_days.lapsed end;

  if p_excused then
    -- An excused day needs no rescue.
    update public.habit_days
    set at_risk_at = null, at_risk_note = null
    where habit_id = h.id and day_date = p_date;
  end if;
end;
$$;

/*
 * Log or undo a lapse on an avoidance habit ("I slipped today").
 *
 * Undo exists because this is one tap and mistakes happen.
 */
create or replace function public.set_lapse(
  p_habit_id uuid,
  p_date     date,
  p_lapsed   boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  h      public.habits%rowtype;
  today  date;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into h from public.habits where id = p_habit_id;
  if not found or h.owner_id <> caller then
    raise exception 'Not allowed right now' using errcode = '42501';
  end if;
  if h.kind <> 'avoid' then
    raise exception 'Only avoidance habits can have a slip' using errcode = '22023';
  end if;

  today := public.owner_today(p_habit_id);
  if p_date > today or p_date < today - 60 then
    raise exception 'That date is out of range' using errcode = '22023';
  end if;
  if not (extract(isodow from p_date)::smallint = any (h.scheduled_days)) then
    raise exception 'That day was not scheduled' using errcode = '22023';
  end if;

  insert into public.habit_days (habit_id, user_id, day_date, lapsed)
  values (h.id, caller, p_date, p_lapsed)
  on conflict (habit_id, day_date) do update
    set lapsed  = p_lapsed,
        excused = case when p_lapsed then false else public.habit_days.excused end;

  if p_lapsed then
    update public.habit_days
    set at_risk_at = null, at_risk_note = null
    where habit_id = h.id and day_date = p_date;
  end if;
end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.habit_days        enable row level security;
alter table public.nudges            enable row level security;
alter table public.activity_events   enable row level security;
alter table public.event_reactions   enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;

-- --- habit_days -------------------------------------------------------------

-- Your own day states always; a friend's only for SHARED habits in your group.
-- The EXISTS is what keeps a private habit's excused/lapsed/at-risk state invisible.
create policy habit_days_select_own_or_shared
  on public.habit_days for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.habits h
      where h.id = habit_days.habit_id
        and h.visibility = 'shared'
        and h.group_id in (select public.my_group_ids())
    )
  );

-- Writes are owner-only. The RPCs above are the normal path, but direct writes are
-- permitted for the owner so a future screen does not need a new RPC for every field.
create policy habit_days_insert_own
  on public.habit_days for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy habit_days_update_own
  on public.habit_days for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy habit_days_delete_own
  on public.habit_days for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- --- nudges -----------------------------------------------------------------

-- You can see nudges you sent or received. Nudges between two other people are not
-- your business, even inside the group — the feed carries the public version.
create policy nudges_select_involved
  on public.nudges for select
  to authenticated
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
  );

-- Deliberately NO insert/update/delete policies. send_nudge() is the only way in,
-- and it is the only thing that enforces the cooldown and the owner's policy.

-- --- activity_events --------------------------------------------------------

create policy activity_events_select_group
  on public.activity_events for select
  to authenticated
  using (group_id in (select public.my_group_ids()));

-- No write policies at all: events come only from triggers and RPCs.

-- --- event_reactions --------------------------------------------------------

-- You may see reactions on events you can see.
create policy event_reactions_select_visible
  on public.event_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.activity_events e
      where e.id = event_reactions.event_id
        and e.group_id in (select public.my_group_ids())
    )
  );

-- You may only react as yourself, and only to an event you can read.
create policy event_reactions_insert_own
  on public.event_reactions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.activity_events e
      where e.id = event_reactions.event_id
        and e.group_id in (select public.my_group_ids())
    )
  );

create policy event_reactions_update_own
  on public.event_reactions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy event_reactions_delete_own
  on public.event_reactions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- --- notification_prefs -----------------------------------------------------

create policy notification_prefs_select_own
  on public.notification_prefs for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy notification_prefs_insert_own
  on public.notification_prefs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy notification_prefs_update_own
  on public.notification_prefs for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --- push_subscriptions -----------------------------------------------------

-- Strictly owner-only, in every direction. A friend must never be able to read
-- somebody's endpoint or keys — that would let them push to that device directly.
create policy push_subscriptions_select_own
  on public.push_subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_update_own
  on public.push_subscriptions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================================
-- Grants
-- ============================================================================

revoke all on public.habit_days         from anon;
revoke all on public.nudges             from anon;
revoke all on public.activity_events    from anon;
revoke all on public.event_reactions    from anon;
revoke all on public.notification_prefs from anon;
revoke all on public.push_subscriptions from anon;

grant select, insert, update, delete on public.habit_days to authenticated;
-- Read-only from the client; send_nudge() writes.
grant select on public.nudges to authenticated;
-- Read-only from the client; triggers and RPCs write.
grant select on public.activity_events to authenticated;
grant select, insert, update, delete on public.event_reactions to authenticated;
grant select, insert, update on public.notification_prefs to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- RPCs: authenticated only, never anon.
revoke all on function public.send_nudge(uuid, text, text)   from public, anon;
revoke all on function public.mark_at_risk(uuid, text)        from public, anon;
revoke all on function public.clear_at_risk(uuid)             from public, anon;
revoke all on function public.set_excused(uuid, date, boolean) from public, anon;
revoke all on function public.set_lapse(uuid, date, boolean)   from public, anon;
revoke all on function public.owner_today(uuid)                from public, anon;
revoke all on function public.owner_local_time(uuid)           from public, anon;
revoke all on function public.scheduled_streak_at(uuid, date)  from public, anon;

grant execute on function public.send_nudge(uuid, text, text)    to authenticated;
grant execute on function public.mark_at_risk(uuid, text)         to authenticated;
grant execute on function public.clear_at_risk(uuid)              to authenticated;
grant execute on function public.set_excused(uuid, date, boolean) to authenticated;
grant execute on function public.set_lapse(uuid, date, boolean)   to authenticated;

-- These are internal helpers used inside the definer functions above. The client has
-- no reason to call them, and owner_local_time() in particular would leak a friend's
-- wall-clock time, so they stay ungranted.

-- ============================================================================
-- Realtime
--
-- UI freshness only — never an authorization boundary. push_subscriptions is
-- deliberately absent: its rows are secret material and must not be broadcast.
-- ============================================================================

alter publication supabase_realtime add table public.habit_days;
alter publication supabase_realtime add table public.activity_events;
alter publication supabase_realtime add table public.event_reactions;
