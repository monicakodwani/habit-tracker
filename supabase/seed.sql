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
        scheduled_days, weekly_target, visibility
      )
      values (
        member.user_id,
        gid,
        habit.v ->> 0,
        habit.v ->> 1,
        (habit.v ->> 2)::public.recurrence_type,
        days,
        nullif(habit.v ->> 4, '')::smallint,
        (habit.v ->> 5)::public.habit_visibility
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

-- ---------------------------------------------------------------------------
-- To remove all seeded data (check-ins cascade with their habits):
--
--   delete from public.habits
--   where group_id = (select id from public.groups where name = 'Us');
-- ---------------------------------------------------------------------------
