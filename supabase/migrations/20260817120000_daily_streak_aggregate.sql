-- ============================================================================
-- Group-visible daily streaks.
--
-- WHY THIS EXISTS ON THE SERVER
--
-- A person's true daily combined streak depends on ALL their scheduled habits,
-- including private ones. A friend cannot read those rows — correctly so — which means
-- a streak computed in the friend's browser from visible shared habits would be
-- confidently wrong, not merely incomplete.
--
-- So the calculation happens here, where all the rows are readable, and ONLY a number
-- comes back out. No habit name, no habit id, no count of habits, no day breakdown,
-- no indication of which habit broke a run, and nothing that distinguishes a private
-- habit from a shared one.
--
-- WHAT THIS DOES DISCLOSE, DELIBERATELY
--
-- The number itself is the disclosure. If somebody's streak breaks on a day when all
-- their *shared* habits were done, a friend can infer that something private went
-- unhandled. That is inherent to any accurate aggregate over private data, and it is
-- the point of the feature: this is an accountability app between three friends who
-- have chosen to show each other a streak. It is documented rather than hidden.
--
-- The semantics mirror `src/domain/dailyStreak.ts` exactly. The two implementations
-- are kept in step by the assertions in supabase/tests/02_social_rls_test.sql, which
-- run the same scenarios as the TypeScript unit tests.
-- ============================================================================

/*
 * Per-day success/failure for one person, as a set.
 *
 * Days with no applicable habit simply do not appear in the result — which is exactly
 * what "neutral days are transparent" means, so the streak walks below need no special
 * case for them.
 *
 * Mirrors the domain rules:
 *   - only scheduled-days habits; weekly targets are not due on any date
 *   - a habit does not apply before its local creation date
 *   - an archived habit stops applying after `updated_at` (see the README limitation)
 *   - `do`: done, else excused, else missed
 *   - `avoid`: lapsed is a failure, excused is handled, otherwise clean
 *   - the current local day is excluded entirely; it is never finalised early
 */
create or replace function public.daily_status_days(p_user uuid)
returns table (day_date date, applicable integer, failed integer)
language sql
stable
security definer
set search_path = ''
as $$
  with zone as (
    select coalesce(p.timezone, 'UTC') as tz
    from public.profiles p
    where p.id = p_user
  ),
  ref as (
    select (now() at time zone (select tz from zone))::date as today
  ),
  scoped as (
    select h.*,
           (h.created_at at time zone (select tz from zone))::date as starts_on,
           (h.updated_at at time zone (select tz from zone))::date as touched_on
    from public.habits h
    where h.owner_id = p_user
      and h.recurrence_type = 'scheduled_days'
  ),
  span as (
    select greatest(
             coalesce(min(s.starts_on), (select today from ref)),
             (select today from ref) - 400   -- matches MAX_STREAK_LOOKBACK_DAYS
           ) as first_day
    from scoped s
  ),
  days as (
    select generate_series(
             (select first_day from span),
             (select today from ref) - 1,     -- yesterday: today is never finalised
             interval '1 day'
           )::date as d
  ),
  occurrences as (
    select dy.d,
           s.kind,
           exists (
             select 1 from public.habit_checkins c
             where c.habit_id = s.id and c.completion_date = dy.d
           ) as done,
           coalesce((
             select x.excused from public.habit_days x
             where x.habit_id = s.id and x.day_date = dy.d
           ), false) as excused,
           coalesce((
             select x.lapsed from public.habit_days x
             where x.habit_id = s.id and x.day_date = dy.d
           ), false) as lapsed
    from days dy
    join scoped s
      on extract(isodow from dy.d)::smallint = any (s.scheduled_days)
     and dy.d >= s.starts_on
     and (s.active or dy.d <= s.touched_on)
  )
  select o.d,
         count(*)::integer,
         count(*) filter (
           where (o.kind = 'do'    and not o.done and not o.excused)
              or (o.kind = 'avoid' and o.lapsed)
         )::integer
  from occurrences o
  group by o.d;
$$;

/*
 * Current and longest daily streak for one person.
 *
 * Current = successful days after the most recent failure. Longest = the largest run
 * between failures. Neutral days never appear in `daily_status_days`, so they cannot
 * split a run — a weekday-only habit survives the weekend intact.
 */
create or replace function public.daily_streak_for(p_user uuid)
returns table (current_streak integer, longest_streak integer)
language sql
stable
security definer
set search_path = ''
as $$
  with judged as (
    select day_date, (failed = 0) as ok
    from public.daily_status_days(p_user)
  ),
  marked as (
    select day_date,
           ok,
           max(day_date) filter (where not ok) over () as last_failure,
           -- Cumulative failure count partitions the timeline into runs.
           sum(case when ok then 0 else 1 end) over (order by day_date) as run_id
    from judged
  )
  select
    (select count(*)::integer
       from marked m
      where m.ok
        and (m.last_failure is null or m.day_date > m.last_failure)),
    coalesce((select max(len)::integer
       from (select count(*) as len
               from marked m2
              where m2.ok
              group by m2.run_id) runs), 0);
$$;

/*
 * The aggregate the app actually calls: every member of the caller's group, with only
 * a user id and two numbers each.
 *
 * Authorisation is the `shares_group_with` join — a caller only ever receives rows for
 * people they already share a group with, which is the same boundary that governs
 * seeing those people at all. An unrelated account gets an empty set, not an error.
 *
 * Note there is no `p_user` parameter. The caller cannot ask about an arbitrary person;
 * the set of subjects is derived entirely from their own memberships.
 */
create or replace function public.group_daily_streaks()
returns table (user_id uuid, current_streak integer, longest_streak integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, s.current_streak, s.longest_streak
  from (
    select distinct them.user_id
    from public.group_members me
    join public.group_members them on them.group_id = me.group_id
    where me.user_id = (select auth.uid())
  ) m
  cross join lateral public.daily_streak_for(m.user_id) s
  where (select auth.uid()) is not null;
$$;

-- ----------------------------------------------------------------------------
-- Grants
--
-- Only the group-scoped aggregate is callable from the client. The two helpers take a
-- user id and would happily compute for anyone, so they stay ungranted — the entry
-- point is the one that derives its subjects from auth.uid().
-- ----------------------------------------------------------------------------

revoke all on function public.daily_status_days(uuid) from public, anon, authenticated;
revoke all on function public.daily_streak_for(uuid)  from public, anon, authenticated;
revoke all on function public.group_daily_streaks()   from public, anon;

grant execute on function public.group_daily_streaks() to authenticated;
