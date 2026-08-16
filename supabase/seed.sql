-- ============================================================================
-- OPTIONAL development seed.
--
-- Gives every member of a group a handful of habits and ~3 weeks of plausible
-- check-in history, so the Today / Week / history screens have something to show
-- while you are building.
--
-- Run in the Supabase SQL editor AFTER supabase/bootstrap.sql.
--
-- These names and emoji are sample data only. Nothing in the application code
-- knows or cares about them.
--
-- To undo: see the DELETE at the bottom of this file.
-- ============================================================================

do $$
declare
  group_name constant text := 'Us';  -- must match the group you bootstrapped

  gid      uuid;
  member   record;
  habit    record;
  hid      uuid;
  seat     int := 0;
  day      date;
  days     smallint[];
  -- Three habit sets, handed out to group members in join order. Each entry is
  -- (name, emoji, recurrence, scheduled_days, weekly_target, visibility).
  kits jsonb := '[
    [
      ["Vitamins",     "💊", "scheduled_days", [1,2,3,4,5,6,7], null, "shared"],
      ["Read",         "📖", "scheduled_days", [1,2,3,4,5,6,7], null, "shared"],
      ["Dissertation", "💻", "scheduled_days", [1,2,3,4,5],     null, "shared"],
      ["Walk",         "🚶", "weekly_target",  null,            4,    "shared"]
    ],
    [
      ["Yoga",    "🧘", "scheduled_days", [1,2,3,4,5],     null, "shared"],
      ["Journal", "📓", "scheduled_days", [1,2,3,4,5,6,7], null, "shared"],
      ["Read",    "📖", "scheduled_days", [1,2,3,4,5,6,7], null, "shared"]
    ],
    [
      ["Walk",   "🚶", "scheduled_days", [1,2,3,4,5,6,7], null, "shared"],
      ["Sketch", "✏️", "weekly_target",  null,            3,    "shared"],
      ["Gym",    "🏋️", "weekly_target",  null,            3,    "shared"]
    ]
  ]'::jsonb;
  kit jsonb;
begin
  select id into gid from public.groups where name = group_name;
  if gid is null then
    raise exception 'No group named "%". Run supabase/bootstrap.sql first.', group_name;
  end if;

  for member in
    select gm.user_id, p.display_name
    from public.group_members gm
    join public.profiles p on p.id = gm.user_id
    where gm.group_id = gid
    order by gm.joined_at, p.display_name
  loop
    -- Wrap around if the group somehow has more than three people.
    kit := kits -> (seat % jsonb_array_length(kits));
    seat := seat + 1;

    for habit in select * from jsonb_array_elements(kit) as h(v) loop
      -- Skip habits this person already has, so the seed is re-runnable.
      select id into hid
      from public.habits
      where owner_id = member.user_id and name = (habit.v ->> 0);

      if hid is not null then
        continue;
      end if;

      -- scheduled_days must reach the DB sorted ascending and distinct.
      if habit.v -> 3 = 'null'::jsonb then
        days := null;
      else
        select array_agg(distinct x::smallint order by x::smallint)
        into days
        from jsonb_array_elements_text(habit.v -> 3) as t(x);
      end if;

      insert into public.habits (
        owner_id, group_id, name, emoji, recurrence_type,
        scheduled_days, weekly_target, visibility, created_at
      )
      values (
        member.user_id,
        gid,
        habit.v ->> 0,
        habit.v ->> 1,
        (habit.v ->> 2)::public.recurrence_type,
        days,
        nullif(habit.v ->> 4, '')::smallint,
        (habit.v ->> 5)::public.habit_visibility,
        -- Backdated to match the history seeded below. A habit created "now" with
        -- three weeks of check-ins is incoherent data, and the app correctly refuses
        -- to credit days from before a habit existed.
        now() - interval '21 days'
      )
      returning id into hid;

      -- Backfill ~3 weeks of history. Deterministic pseudo-randomness (hashing the
      -- habit id and date) keeps re-runs stable and gives each habit its own pattern.
      for day in
        select generate_series(current_date - 20, current_date, interval '1 day')::date
      loop
        -- A scheduled habit can only be completed on a day it was actually due.
        continue when days is not null
          and not (extract(isodow from day)::smallint = any (days));

        -- Scheduled habits land ~78% of the time, leaving gaps so both streaks and
        -- misses show up. Weekly-target habits are completed at roughly their own
        -- target rate, so "2 / 3 this week" looks believable rather than maxed out.
        continue when (abs(hashtext(hid::text || day::text)) % 100)
          >= case when days is null
                  then (nullif(habit.v ->> 4, '')::int * 100) / 7
                  else 78
             end;

        insert into public.habit_checkins (habit_id, user_id, completion_date)
        values (hid, member.user_id, day)
        on conflict do nothing;
      end loop;

      raise notice 'Seeded % for %', habit.v ->> 0, member.display_name;
    end loop;
  end loop;
end;
$$;

-- ============================================================================
-- Social seed: an avoidance habit, a private habit, an at-risk item, a nudge and
-- some reactions, so every Phase 2 screen has something real to show.
--
-- Activity events are NOT inserted directly — the check-ins above already fired the
-- trigger that creates them, which is also a small end-to-end check that the trigger
-- works. Push subscriptions are deliberately never seeded: they are per-device
-- crypto material and a fake one would just fail to deliver.
-- ============================================================================

do $$
declare
  group_name constant text := 'Us';
  gid    uuid;
  first  uuid;   -- gets the private + avoidance habits
  second uuid;   -- gets the at-risk item
  third  uuid;   -- sends the nudge
  avoid_id uuid;
  target   uuid;
  target_days smallint[];
  ev       uuid;
  day      date;
begin
  select id into gid from public.groups where name = group_name;
  if gid is null then
    raise exception 'No group named "%". Run supabase/bootstrap.sql first.', group_name;
  end if;

  select user_id into first  from public.group_members where group_id = gid order by joined_at limit 1;
  select user_id into second from public.group_members where group_id = gid order by joined_at offset 1 limit 1;
  select user_id into third  from public.group_members where group_id = gid order by joined_at offset 2 limit 1;
  if second is null then second := first; end if;
  if third  is null then third  := first; end if;

  -- --- an avoidance habit, with a slip a few days ago ----------------------
  select id into avoid_id from public.habits where owner_id = first and name = 'No takeout';
  if avoid_id is null then
    insert into public.habits (owner_id, group_id, name, emoji, kind, recurrence_type, scheduled_days, visibility, created_at)
    values (first, gid, 'No takeout', '🍟', 'avoid', 'scheduled_days', '{1,2,3,4,5,6,7}', 'shared',
            now() - interval '20 days')
    returning id into avoid_id;

    insert into public.habit_days (habit_id, user_id, day_date, lapsed)
    values (avoid_id, first, current_date - 6, true)
    on conflict do nothing;

    raise notice 'Seeded avoidance habit "No takeout"';
  end if;

  -- --- a private habit, to make the privacy boundary visible ---------------
  if not exists (select 1 from public.habits where owner_id = first and name = 'Therapy') then
    insert into public.habits (owner_id, group_id, name, emoji, recurrence_type, scheduled_days, visibility, created_at)
    values (first, gid, 'Therapy', '🛋️', 'scheduled_days', '{1,2,3,4,5,6,7}', 'private',
            now() - interval '20 days');
    raise notice 'Seeded PRIVATE habit "Therapy" (nobody else should ever see it)';
  end if;

  -- --- an excused day on someone's daily habit -----------------------------
  select id into target from public.habits
  where owner_id = first and recurrence_type = 'scheduled_days' and kind = 'do'
    and visibility = 'shared'
  order by created_at limit 1;

  if target is not null then
    day := current_date - 3;
    -- The array must land in a variable first: `= any (subquery)` would compare a
    -- smallint against a single row *containing* an array, not against its elements.
    select h.scheduled_days into target_days from public.habits h where h.id = target;

    if target_days is not null and extract(isodow from day)::smallint = any (target_days) then
      insert into public.habit_days (habit_id, user_id, day_date, excused)
      values (target, first, day, true)
      on conflict (habit_id, day_date) do update set excused = true;
      raise notice 'Seeded an excused day';
    end if;
  end if;

  -- --- an at-risk item, with a note ----------------------------------------
  select id into target from public.habits
  where owner_id = second and visibility = 'shared' and active
    and recurrence_type = 'scheduled_days' and kind = 'do'
    and extract(isodow from current_date)::smallint = any (scheduled_days)
  order by created_at limit 1;

  if target is not null then
    delete from public.habit_checkins where habit_id = target and completion_date = current_date;

    insert into public.habit_days (habit_id, user_id, day_date, at_risk_at, at_risk_note)
    values (target, second, current_date, now(), 'Please force me to leave the house.')
    on conflict (habit_id, day_date) do update
      set at_risk_at = now(), at_risk_note = excluded.at_risk_note;

    insert into public.activity_events (group_id, actor_id, habit_id, type, day_date, metadata)
    select gid, second, target, 'at_risk', current_date,
           jsonb_build_object('habit_name', h.name, 'habit_emoji', h.emoji,
                              'note', 'Please force me to leave the house.')
    from public.habits h where h.id = target
    on conflict do nothing;

    -- ...and a nudge in reply, from the third person.
    insert into public.nudges (group_id, habit_id, sender_id, recipient_id, day_date, preset, message)
    values (gid, target, third, second, current_date, 'do-the-thing', '🫡 Do the thing')
    on conflict do nothing;

    insert into public.activity_events (group_id, actor_id, target_user_id, habit_id, type, day_date, metadata)
    select gid, third, second, target, 'nudge', current_date,
           jsonb_build_object('habit_name', h.name, 'habit_emoji', h.emoji, 'preset', 'do-the-thing')
    from public.habits h where h.id = target
    on conflict do nothing;

    raise notice 'Seeded an at-risk item and a nudge';
  end if;

  -- --- a couple of reactions on the newest completions ----------------------
  for ev in
    select id from public.activity_events
    where group_id = gid and type = 'habit_completed'
    order by created_at desc limit 3
  loop
    insert into public.event_reactions (event_id, user_id, emoji)
    values (ev, second, '❤️')
    on conflict (event_id, user_id) do nothing;
    insert into public.event_reactions (event_id, user_id, emoji)
    values (ev, third, '🎉')
    on conflict (event_id, user_id) do nothing;
  end loop;

  raise notice 'Seeded reactions';

  -- The completion trigger stamps created_at with "now", but these check-ins were
  -- backfilled across three weeks. Realign the event timestamps with the days they
  -- describe, so the feed reads like a real history instead of everything at once.
  update public.activity_events e
  set created_at = e.day_date + time '19:30' + (random() * interval '90 minutes')
  where e.group_id = gid
    and e.created_at::date <> e.day_date;
end;
$$;

-- ---------------------------------------------------------------------------
-- To remove all seeded data (check-ins, day states, events and reactions all
-- cascade with their habits):
--
--   delete from public.habits
--   where group_id = (select id from public.groups where name = 'Us');
-- ---------------------------------------------------------------------------
