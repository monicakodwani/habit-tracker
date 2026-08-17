-- ============================================================================
-- RLS + rule tests for the social layer.
--
-- Runs after 01_rls_test.sql against the same throwaway database, and reuses the
-- fixtures it created:
--
--   Monica  11111111-…  owns 'Vitamins' (shared), 'Therapy' (PRIVATE), 'Walk' (weekly)
--   Ura     22222222-…  owns 'Yoga (evening)' (shared)
--   Ojas    33333333-…  in the same group, owns nothing
--   Zed     99999999-…  an authenticated stranger in a DIFFERENT group
--   Nova    44444444-…  authenticated, in NO group
--
-- The helper functions assert_eq / assert_raises / act_as come from that file.
--
-- For every new table this asserts what the owner, a friend, a stranger and anon can
-- each read and write — and, most importantly, that nothing here opens a side channel
-- onto a private habit.
-- ============================================================================

\set ON_ERROR_STOP on

reset role;

/*
 * The fixture users' local "today", used throughout instead of `current_date`.
 *
 * The RPCs under test derive today from the habit owner's timezone — that is the
 * behaviour being tested — whereas `current_date` is the server's UTC date. Between
 * UTC midnight and 04:00 the two disagree, so every assertion that sets up "a
 * check-in for today" or "an excuse for today" would silently target the wrong day
 * and fail. This suite really did pass all day and fail after midnight UTC.
 *
 * All fixture profiles use America/New_York, so one helper covers the whole file.
 */
/*
 * Pin every fixture profile to a known zone first.
 *
 * Previously this file assumed the profiles table's default. When that default changed
 * from America/New_York to UTC, the helper below silently disagreed with the RPCs and
 * a third of this suite failed. The suite now states the assumption instead of
 * inheriting it, so a future default change cannot break it from a distance.
 */
update public.profiles set timezone = 'America/New_York';

create or replace function fixture_today()
returns date language sql stable as $fn$
  select (now() at time zone 'America/New_York')::date;
$fn$;


-- Deterministic ids for the rows created below.
\set MONICA '''11111111-1111-1111-1111-111111111111'''
\set URA    '''22222222-2222-2222-2222-222222222222'''
\set OJAS   '''33333333-3333-3333-3333-333333333333'''
\set ZED    '''99999999-9999-9999-9999-999999999999'''
\set VITAMINS '''c1111111-0000-0000-0000-000000000001'''
\set THERAPY  '''c1111111-0000-0000-0000-000000000002'''
\set WALK     '''c1111111-0000-0000-0000-000000000003'''
\set YOGA     '''c2222222-0000-0000-0000-000000000001'''

-- ----------------------------------------------------------------------------
-- Migration safety: existing rows survived and defaulted correctly
-- ----------------------------------------------------------------------------

select assert_eq((select count(*)::int from public.habits where kind <> 'do'), 0,
  'every pre-existing habit migrated to kind = do');
select assert_eq((select count(*)::int from public.habits where nudge_policy <> 'anytime'), 0,
  'every pre-existing habit defaulted to nudge_policy = anytime');
select assert_eq((select count(*)::int from public.habits where nudge_after_time is not null), 0,
  'no pre-existing habit has a stray preferred time');

-- ----------------------------------------------------------------------------
-- Schema constraints
-- ----------------------------------------------------------------------------

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, weekly_target, kind)
    values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Bad','weekly_target',3,'avoid')$$,
  'habits_avoid_is_scheduled',
  'an avoidance habit cannot be weekly-target');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, scheduled_days, nudge_policy)
    values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Bad','scheduled_days','{1}','after_time')$$,
  'habits_nudge_time_shape',
  'after_time requires a preferred time');

select assert_raises(
  $$insert into public.habits (owner_id, group_id, name, recurrence_type, scheduled_days, nudge_policy, nudge_after_time)
    values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Bad','scheduled_days','{1}','anytime','18:00')$$,
  'habits_nudge_time_shape',
  'a preferred time is rejected unless the policy is after_time');

select assert_raises(
  $$insert into public.habit_days (habit_id, user_id, day_date, excused, lapsed)
    values ('c1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', fixture_today(), true, true)$$,
  'habit_days_excused_xor_lapsed',
  'a day cannot be both excused and a lapse');

select assert_raises(
  $$insert into public.habit_days (habit_id, user_id, day_date)
    values ('c1111111-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222', fixture_today())$$,
  'habit_days_habit_owner_fkey|foreign key',
  'a day state cannot be attributed to a non-owner');

select assert_raises(
  $$insert into public.event_reactions (event_id, user_id, emoji)
    select id, '11111111-1111-1111-1111-111111111111', '🦆' from public.activity_events limit 1$$,
  'event_reactions_emoji_check|violates check constraint|null value',
  'reactions are restricted to the fixed emoji set');

-- ----------------------------------------------------------------------------
-- Set the stage: an avoidance habit, and a private avoidance habit
-- ----------------------------------------------------------------------------

insert into public.habits (id, owner_id, group_id, name, emoji, kind, recurrence_type, scheduled_days, visibility)
values
  ('d1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'No takeout', '🍟', 'avoid', 'scheduled_days', '{1,2,3,4,5,6,7}', 'shared'),
  ('d1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'No doomscrolling', '📱', 'avoid', 'scheduled_days', '{1,2,3,4,5,6,7}', 'private');

-- Make Vitamins due today so nudges are possible, and clear prior state.
update public.habits set scheduled_days = '{1,2,3,4,5,6,7}' where id = 'c1111111-0000-0000-0000-000000000001';
delete from public.habit_checkins where habit_id = 'c1111111-0000-0000-0000-000000000001' and completion_date = fixture_today();
delete from public.nudges;
delete from public.activity_events;
delete from public.habit_days;

-- ============================================================================
-- send_nudge — the rules that must not be bypassable
-- ============================================================================

set role authenticated;
select act_as('22222222-2222-2222-2222-222222222222');   -- Ura

-- The happy path first, so later refusals are clearly about the rule under test.
select assert_eq(
  (select public.send_nudge('c1111111-0000-0000-0000-000000000001', '👀 Ahem.', 'ahem')) is not null,
  true, 'a friend can nudge a due, unfinished, shared habit');

select assert_eq((select count(*)::int from public.nudges), 1, 'the nudge was stored');
select assert_eq(
  (select count(*)::int from public.activity_events where type = 'nudge'), 1,
  'the nudge produced exactly one activity event');

-- Cooldown.
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'again', null)$$,
  'already nudged this recently',
  'the two-hour cooldown cannot be bypassed by calling the RPC directly');

-- Private habits.
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000002', 'hi', null)$$,
  'Not allowed right now',
  'a private habit cannot be nudged');
select assert_raises(
  $$select public.send_nudge('d1111111-0000-0000-0000-000000000002', 'hi', null)$$,
  'Not allowed right now',
  'a private AVOIDANCE habit cannot be nudged');

-- A nudge must never confirm a private habit exists: the error is identical to the
-- one for a completely unknown id.
select assert_raises(
  $$select public.send_nudge('00000000-0000-0000-0000-0000000000ff', 'hi', null)$$,
  'Not allowed right now',
  'an unknown habit id gives the same error as a private one');

-- Self-nudge.
reset role; set role authenticated;
select act_as('11111111-1111-1111-1111-111111111111');   -- Monica
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'hi', null)$$,
  'Not allowed right now',
  'nobody can nudge themselves');

-- A stranger outside the group.
select act_as('99999999-9999-9999-9999-999999999999');   -- Zed
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'hi', null)$$,
  'Not allowed right now',
  'an unrelated account cannot nudge into another group');

-- Message validation.
select act_as('33333333-3333-3333-3333-333333333333');   -- Ojas
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', '', null)$$,
  'Message must be',
  'an empty message is rejected');
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', repeat('x', 201), null)$$,
  'Message must be',
  'an over-long message is rejected');

-- The sender cannot be forged: the RPC takes no actor argument, and direct INSERT
-- is refused because `authenticated` has no insert grant on nudges.
select assert_raises(
  $$insert into public.nudges (group_id, habit_id, sender_id, recipient_id, day_date, message)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
            fixture_today(),'forged')$$,
  'permission denied|row-level security',
  'nudges cannot be inserted directly, so a sender cannot be forged');

-- A completed habit cannot be nudged.
reset role;
insert into public.habit_checkins (habit_id, user_id, completion_date)
values ('c1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', fixture_today());
set role authenticated;
select act_as('33333333-3333-3333-3333-333333333333');
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'hi', null)$$,
  'Not allowed right now',
  'a completed habit cannot be nudged');
reset role;
delete from public.habit_checkins where habit_id = 'c1111111-0000-0000-0000-000000000001' and completion_date = fixture_today();

-- Nudge policy: 'never'.
update public.habits set nudge_policy = 'never' where id = 'c1111111-0000-0000-0000-000000000001';
set role authenticated;
select act_as('33333333-3333-3333-3333-333333333333');
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'hi', null)$$,
  'Not allowed right now',
  'nudge_policy = never is enforced server-side');

-- Nudge policy: 'at_risk_only'.
reset role;
update public.habits set nudge_policy = 'at_risk_only' where id = 'c1111111-0000-0000-0000-000000000001';
set role authenticated;
select act_as('33333333-3333-3333-3333-333333333333');
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'hi', null)$$,
  'Not allowed right now',
  'at_risk_only refuses until the owner asks for a push');

-- ...and allows it once they do.
select act_as('11111111-1111-1111-1111-111111111111');
select public.mark_at_risk('c1111111-0000-0000-0000-000000000001', 'please make me');
select act_as('33333333-3333-3333-3333-333333333333');
select assert_eq(
  (select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'on it', null)) is not null,
  true, 'at_risk_only allows a nudge once the owner has asked');

-- Nudge policy: 'after_time'. Set the threshold to just after the owner's local time.
reset role;
update public.habits
set nudge_policy = 'after_time',
    nudge_after_time = ((now() at time zone 'America/New_York')::time + interval '2 hours')::time
where id = 'c1111111-0000-0000-0000-000000000001';
delete from public.nudges;   -- clear the cooldown for this check
set role authenticated;
select act_as('33333333-3333-3333-3333-333333333333');
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'hi', null)$$,
  'Not allowed right now',
  'after_time refuses before the owner''s preferred hour');

reset role;
update public.habits set nudge_policy = 'anytime', nudge_after_time = null
where id = 'c1111111-0000-0000-0000-000000000001';

-- An excused day cannot be nudged.
set role authenticated;
select act_as('11111111-1111-1111-1111-111111111111');
select public.set_excused('c1111111-0000-0000-0000-000000000001', fixture_today(), true);
select act_as('33333333-3333-3333-3333-333333333333');
select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001', 'hi', null)$$,
  'Not allowed right now',
  'an excused day cannot be nudged');
select act_as('11111111-1111-1111-1111-111111111111');
select public.set_excused('c1111111-0000-0000-0000-000000000001', fixture_today(), false);

-- An avoidance habit: nudgeable while going, not after a slip.
select act_as('33333333-3333-3333-3333-333333333333');
select assert_eq(
  (select public.send_nudge('d1111111-0000-0000-0000-000000000001', 'stay strong', null)) is not null,
  true, 'an avoidance habit can be encouraged while the day is still going');

select act_as('11111111-1111-1111-1111-111111111111');
select public.set_lapse('d1111111-0000-0000-0000-000000000001', fixture_today(), true);
select act_as('22222222-2222-2222-2222-222222222222');
select assert_raises(
  $$select public.send_nudge('d1111111-0000-0000-0000-000000000001', 'ha', null)$$,
  'Not allowed right now',
  'nobody can pile on after a slip has been logged');
select act_as('11111111-1111-1111-1111-111111111111');
select public.set_lapse('d1111111-0000-0000-0000-000000000001', fixture_today(), false);

-- ============================================================================
-- habit_days — at risk, excused, lapses
-- ============================================================================

select act_as('11111111-1111-1111-1111-111111111111');   -- Monica

select assert_raises(
  $$select public.set_lapse('c1111111-0000-0000-0000-000000000001', fixture_today(), true)$$,
  'Only avoidance habits',
  'a slip cannot be logged against a do-habit');

select assert_raises(
  $$select public.set_excused('c1111111-0000-0000-0000-000000000003', fixture_today(), true)$$,
  'Only scheduled habits',
  'a weekly-target habit cannot have a per-day excuse');

select assert_raises(
  $$select public.set_excused('c1111111-0000-0000-0000-000000000001', fixture_today() + 5, true)$$,
  'out of range',
  'the future cannot be excused');

select assert_raises(
  $$select public.set_excused('c1111111-0000-0000-0000-000000000001', fixture_today() - 400, true)$$,
  'out of range',
  'the distant past cannot be excused');

-- Others cannot touch Monica's day state.
select act_as('22222222-2222-2222-2222-222222222222');   -- Ura
select assert_raises(
  $$select public.mark_at_risk('c1111111-0000-0000-0000-000000000001', 'x')$$,
  'Not allowed right now',
  'a friend cannot mark someone else''s habit at risk');
select assert_raises(
  $$select public.set_excused('c1111111-0000-0000-0000-000000000001', fixture_today(), true)$$,
  'Not allowed right now',
  'a friend cannot excuse someone else''s day');
select assert_raises(
  $$select public.set_lapse('d1111111-0000-0000-0000-000000000001', fixture_today(), true)$$,
  'Not allowed right now',
  'a friend cannot log a slip on someone else''s habit');

-- Direct table writes are owner-only too.
update public.habit_days set excused = true
where habit_id = 'c1111111-0000-0000-0000-000000000001';
select assert_eq(
  (select count(*)::int from public.habit_days
   where habit_id = 'c1111111-0000-0000-0000-000000000001' and excused), 0,
  'a friend cannot flip someone else''s day state by direct update');

select assert_raises(
  $$insert into public.habit_days (habit_id, user_id, day_date, excused)
    values ('c1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', fixture_today() - 1, true)$$,
  'row-level security',
  'a friend cannot insert a day state for someone else');

-- Visibility of day state.
reset role;
delete from public.habit_days;
insert into public.habit_days (habit_id, user_id, day_date, at_risk_at, at_risk_note)
values ('c1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', fixture_today(), now(), 'shared note');
insert into public.habit_days (habit_id, user_id, day_date, excused)
values ('c1111111-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111', fixture_today(), true);  -- PRIVATE Therapy
insert into public.habit_days (habit_id, user_id, day_date, lapsed)
values ('d1111111-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111', fixture_today(), true);  -- PRIVATE avoidance

set role authenticated;
select act_as('22222222-2222-2222-2222-222222222222');   -- Ura
select assert_eq((select count(*)::int from public.habit_days), 1,
  'a friend sees day state for SHARED habits only');
select assert_eq((select at_risk_note from public.habit_days), 'shared note',
  'a friend can read an at-risk note on a shared habit');
select assert_eq(
  (select count(*)::int from public.habit_days
   where habit_id = 'c1111111-0000-0000-0000-000000000002'), 0,
  'a private habit''s excused state is invisible, even by explicit id');
select assert_eq(
  (select count(*)::int from public.habit_days
   where habit_id = 'd1111111-0000-0000-0000-000000000002'), 0,
  'a private avoidance habit''s LAPSE is invisible');

select act_as('99999999-9999-9999-9999-999999999999');   -- Zed
select assert_eq((select count(*)::int from public.habit_days), 0,
  'an unrelated account sees no day state at all');

select act_as('44444444-4444-4444-4444-444444444444');   -- Nova, in no group
select assert_eq((select count(*)::int from public.habit_days), 0,
  'a group-less account sees no day state');

-- ============================================================================
-- activity_events
-- ============================================================================

reset role;
delete from public.activity_events;
-- A completion on a SHARED habit produces an event; a private one must not.
insert into public.habit_checkins (habit_id, user_id, completion_date)
values ('c1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', fixture_today() - 1);
insert into public.habit_checkins (habit_id, user_id, completion_date)
values ('c1111111-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111', fixture_today() - 1);

select assert_eq((select count(*)::int from public.activity_events), 1,
  'only the shared completion produced an event');
select assert_eq(
  (select count(*)::int from public.activity_events where metadata->>'habit_name' = 'Therapy'), 0,
  'a PRIVATE habit never produces an activity event');

-- Undoing a completion retracts the event.
delete from public.habit_checkins
where habit_id = 'c1111111-0000-0000-0000-000000000001' and completion_date = fixture_today() - 1;
select assert_eq((select count(*)::int from public.activity_events where type = 'habit_completed'), 0,
  'undoing a completion removes its event');

-- Making a habit private wipes its social trail.
reset role;
insert into public.habit_checkins (habit_id, user_id, completion_date)
values ('c2222222-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222', fixture_today() - 1);
select assert_eq((select count(*)::int from public.activity_events where habit_id = 'c2222222-0000-0000-0000-000000000001'), 1,
  'Ura''s shared completion produced an event');
update public.habits set visibility = 'private' where id = 'c2222222-0000-0000-0000-000000000001';
select assert_eq((select count(*)::int from public.activity_events where habit_id = 'c2222222-0000-0000-0000-000000000001'), 0,
  'turning a habit private deletes its past activity events');
update public.habits set visibility = 'shared' where id = 'c2222222-0000-0000-0000-000000000001';

-- Reading the feed.
reset role;
delete from public.activity_events;
insert into public.habit_checkins (habit_id, user_id, completion_date)
values ('c1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', fixture_today() - 2);

set role authenticated;
select act_as('22222222-2222-2222-2222-222222222222');
select assert_eq((select count(*)::int from public.activity_events), 1,
  'a group member can read the feed');

select act_as('99999999-9999-9999-9999-999999999999');
select assert_eq((select count(*)::int from public.activity_events), 0,
  'an unrelated account cannot read the group''s feed');

select act_as('44444444-4444-4444-4444-444444444444');
select assert_eq((select count(*)::int from public.activity_events), 0,
  'a group-less account cannot read any feed');

-- Events cannot be forged or tampered with from the client.
select act_as('22222222-2222-2222-2222-222222222222');
select assert_raises(
  $$insert into public.activity_events (group_id, actor_id, type, day_date)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','habit_completed', fixture_today())$$,
  'permission denied|row-level security',
  'a user cannot forge an activity event or its actor');

-- Not merely filtered to zero rows: `authenticated` has no UPDATE or DELETE grant on
-- this table at all, so the attempt is refused before any policy is consulted.
select assert_raises(
  $$update public.activity_events set metadata = '{"habit_name":"Hacked"}'::jsonb$$,
  'permission denied',
  'activity events are immutable from the client');

select assert_raises(
  $$delete from public.activity_events$$,
  'permission denied',
  'a user cannot delete activity events');

reset role;
select assert_eq((select count(*)::int from public.activity_events), 1,
  'the event survived both attempts');

-- ============================================================================
-- event_reactions
-- ============================================================================

set role authenticated;
select act_as('22222222-2222-2222-2222-222222222222');   -- Ura

insert into public.event_reactions (event_id, user_id, emoji)
select id, '22222222-2222-2222-2222-222222222222', '🎉' from public.activity_events limit 1;
select assert_eq((select count(*)::int from public.event_reactions), 1,
  'a group member can react to a readable event');

-- One reaction per person per event.
select assert_raises(
  $$insert into public.event_reactions (event_id, user_id, emoji)
    select id, '22222222-2222-2222-2222-222222222222', '❤️' from public.activity_events limit 1$$,
  'event_reactions_one_per_user|duplicate key',
  'one reaction per person per event');

-- Changing your own reaction is an update, and allowed.
update public.event_reactions set emoji = '🔥'
where user_id = '22222222-2222-2222-2222-222222222222';
select assert_eq((select emoji from public.event_reactions), '🔥',
  'a user can change their own reaction');

-- Forging somebody else's reaction is not.
select assert_raises(
  $$insert into public.event_reactions (event_id, user_id, emoji)
    select id, '11111111-1111-1111-1111-111111111111', '😂' from public.activity_events limit 1$$,
  'row-level security',
  'a user cannot react as somebody else');

-- A stranger can neither see nor add reactions.
select act_as('99999999-9999-9999-9999-999999999999');
select assert_eq((select count(*)::int from public.event_reactions), 0,
  'an unrelated account cannot read reactions');
select assert_raises(
  $$insert into public.event_reactions (event_id, user_id, emoji)
    values ((select id from public.activity_events limit 1), '99999999-9999-9999-9999-999999999999', '😂')$$,
  'row-level security',
  'an unrelated account cannot react to another group''s event');

-- Ojas cannot remove Ura's reaction.
select act_as('33333333-3333-3333-3333-333333333333');
delete from public.event_reactions;
select assert_eq((select count(*)::int from public.event_reactions), 1,
  'a user cannot delete somebody else''s reaction');

-- Ura can remove their own.
select act_as('22222222-2222-2222-2222-222222222222');
delete from public.event_reactions where user_id = '22222222-2222-2222-2222-222222222222';
select assert_eq((select count(*)::int from public.event_reactions), 0,
  'a user can remove their own reaction');

-- ============================================================================
-- notification_prefs
-- ============================================================================

select act_as('22222222-2222-2222-2222-222222222222');
insert into public.notification_prefs (user_id, nudges) values ('22222222-2222-2222-2222-222222222222', false);
select assert_eq((select count(*)::int from public.notification_prefs), 1,
  'a user can create their own preferences');

select assert_raises(
  $$insert into public.notification_prefs (user_id) values ('11111111-1111-1111-1111-111111111111')$$,
  'row-level security',
  'a user cannot create preferences for somebody else');

select act_as('11111111-1111-1111-1111-111111111111');
select assert_eq((select count(*)::int from public.notification_prefs), 0,
  'a friend cannot read someone else''s notification preferences');

update public.notification_prefs set reactions = true;
reset role;
select assert_eq((select count(*)::int from public.notification_prefs where reactions), 0,
  'a friend cannot change someone else''s notification preferences');

-- ============================================================================
-- push_subscriptions — the most sensitive table
-- ============================================================================

set role authenticated;
select act_as('11111111-1111-1111-1111-111111111111');   -- Monica
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('11111111-1111-1111-1111-111111111111', 'https://push.example/monica', 'KEY', 'AUTH');
select assert_eq((select count(*)::int from public.push_subscriptions), 1,
  'a user can store their own push subscription');

select assert_raises(
  $$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('22222222-2222-2222-2222-222222222222','https://push.example/forged','K','A')$$,
  'row-level security',
  'a user cannot store a subscription for somebody else');

-- The core guarantee: a friend must never obtain another person's endpoint or keys,
-- because holding them is enough to push to that device directly.
select act_as('22222222-2222-2222-2222-222222222222');   -- Ura
select assert_eq((select count(*)::int from public.push_subscriptions), 0,
  'a FRIEND cannot read another person''s push subscription');
select assert_eq(
  (select count(*)::int from public.push_subscriptions
   where endpoint = 'https://push.example/monica'), 0,
  'and cannot reach it by explicit endpoint either');

delete from public.push_subscriptions;
reset role;
select assert_eq((select count(*)::int from public.push_subscriptions), 1,
  'a friend cannot delete another person''s subscription');

set role authenticated;
select act_as('99999999-9999-9999-9999-999999999999');
select assert_eq((select count(*)::int from public.push_subscriptions), 0,
  'an unrelated account sees no push subscriptions');

-- push_subscriptions must never be broadcast over realtime.
reset role;
select assert_eq(
  (select count(*)::int from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename = 'push_subscriptions'), 0,
  'push_subscriptions is NOT in the realtime publication');


-- ============================================================================
-- group_daily_streaks — the aggregate friends are allowed to see
--
-- The feature's whole justification is that a person's true streak depends on their
-- PRIVATE habits, which a friend cannot read. So these assert two things together:
-- the number is accurate (private habits really do move it) and the private habit
-- itself remains completely unreachable.
-- ============================================================================

reset role;

-- Clean slate, then a deterministic history for Monica in her own timezone.
delete from public.habit_checkins;
delete from public.habit_days;

-- Monica keeps: Vitamins (shared, daily) and Therapy (PRIVATE, daily).
update public.habits set scheduled_days = '{1,2,3,4,5,6,7}'
where id in ('c1111111-0000-0000-0000-000000000001', 'c1111111-0000-0000-0000-000000000002');
-- Park everything else out of the way so the arithmetic is unambiguous.
update public.habits set active = false, updated_at = now() - interval '365 days'
where owner_id = '11111111-1111-1111-1111-111111111111'
  and id not in ('c1111111-0000-0000-0000-000000000001', 'c1111111-0000-0000-0000-000000000002');
update public.habits set created_at = now() - interval '30 days'
where id in ('c1111111-0000-0000-0000-000000000001', 'c1111111-0000-0000-0000-000000000002');

-- Both habits completed on each of the last three finished days.
insert into public.habit_checkins (habit_id, user_id, completion_date)
select h.id, h.owner_id, d::date
from public.habits h
cross join generate_series(fixture_today() - 3, fixture_today() - 1, interval '1 day') d
where h.id in ('c1111111-0000-0000-0000-000000000001', 'c1111111-0000-0000-0000-000000000002');

set role authenticated;
select act_as('22222222-2222-2222-2222-222222222222');   -- Ura, a friend

select assert_eq(
  (select current_streak from public.group_daily_streaks()
    where user_id = '11111111-1111-1111-1111-111111111111'),
  3, 'a friend can read the aggregate streak');

-- Now remove ONE private completion. The number must move — that is what makes the
-- aggregate honest rather than a shared-habits-only approximation.
reset role;
delete from public.habit_checkins
where habit_id = 'c1111111-0000-0000-0000-000000000002'
  and completion_date = fixture_today() - 2;

set role authenticated;
select act_as('22222222-2222-2222-2222-222222222222');

select assert_eq(
  (select current_streak from public.group_daily_streaks()
    where user_id = '11111111-1111-1111-1111-111111111111'),
  1, 'a PRIVATE habit genuinely affects the aggregate a friend sees');

-- ...while the private habit itself stays entirely unreachable.
select assert_eq(
  (select count(*)::int from public.habits
    where id = 'c1111111-0000-0000-0000-000000000002'), 0,
  'and the private habit is still invisible to that friend');
select assert_eq(
  (select count(*)::int from public.habit_checkins
    where habit_id = 'c1111111-0000-0000-0000-000000000002'), 0,
  'and its check-ins are still invisible');

-- The aggregate returns numbers only — no habit id, name, or count of any kind.
select assert_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name = 'group_daily_streaks'), 0,
  'the aggregate is a function, not a table anyone can select columns from');

-- Scope: only people the caller shares a group with.
select assert_eq((select count(*)::int from public.group_daily_streaks()), 3,
  'a member sees exactly their own group''s three people');

select act_as('99999999-9999-9999-9999-999999999999');   -- Zed, different group
select assert_eq(
  (select count(*)::int from public.group_daily_streaks()
    where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'an unrelated account gets no row for someone in another group');
select assert_eq((select count(*)::int from public.group_daily_streaks()), 1,
  'an unrelated account sees only themselves');

select act_as('44444444-4444-4444-4444-444444444444');   -- Nova, in no group
select assert_eq((select count(*)::int from public.group_daily_streaks()), 0,
  'a group-less account gets an empty aggregate');

-- The helpers take an arbitrary user id, so they are deliberately not granted. Only
-- the entry point that derives its subjects from auth.uid() is callable.
select assert_raises(
  $$select * from public.daily_streak_for('11111111-1111-1111-1111-111111111111')$$,
  'permission denied',
  'an authenticated user cannot compute a streak for an arbitrary person');
select assert_raises(
  $$select * from public.daily_status_days('11111111-1111-1111-1111-111111111111')$$,
  'permission denied',
  'nor read anyone''s per-day breakdown, which would reveal private habit days');

-- ============================================================================
-- anon — no valid JWT
-- ============================================================================

set role anon;
select set_config('request.jwt.claims', null, false);

select assert_raises($$select count(*) from public.habit_days$$,        'permission denied', 'anon cannot read day state');
select assert_raises($$select count(*) from public.nudges$$,            'permission denied', 'anon cannot read nudges');
select assert_raises($$select count(*) from public.activity_events$$,   'permission denied', 'anon cannot read the feed');
select assert_raises($$select count(*) from public.event_reactions$$,   'permission denied', 'anon cannot read reactions');
select assert_raises($$select count(*) from public.notification_prefs$$,'permission denied', 'anon cannot read preferences');
select assert_raises($$select count(*) from public.push_subscriptions$$,'permission denied', 'anon cannot read push subscriptions');

select assert_raises(
  $$select public.send_nudge('c1111111-0000-0000-0000-000000000001','hi',null)$$,
  'permission denied',
  'anon cannot call send_nudge');
select assert_raises(
  $$select public.mark_at_risk('c1111111-0000-0000-0000-000000000001',null)$$,
  'permission denied',
  'anon cannot call mark_at_risk');
select assert_raises(
  $$select public.set_excused('c1111111-0000-0000-0000-000000000001', fixture_today(), true)$$,
  'permission denied',
  'anon cannot call set_excused');
select assert_raises(
  $$select public.set_lapse('d1111111-0000-0000-0000-000000000001', fixture_today(), true)$$,
  'permission denied',
  'anon cannot call set_lapse');
select assert_raises(
  $$select public.owner_today('c1111111-0000-0000-0000-000000000001')$$,
  'permission denied',
  'anon cannot call the internal timezone helper');
select assert_raises(
  $$select * from public.group_daily_streaks()$$,
  'permission denied',
  'anon cannot read the daily streak aggregate');

-- Even an authenticated user has no business calling the internal helpers directly:
-- owner_local_time would leak a friend's wall-clock time.
reset role; set role authenticated;
select act_as('22222222-2222-2222-2222-222222222222');
select assert_raises(
  $$select public.owner_local_time('c1111111-0000-0000-0000-000000000001')$$,
  'permission denied',
  'internal helpers are not granted to authenticated users either');

reset role;
\echo ''
\echo '======================================'
\echo ' All social RLS assertions passed.'
\echo '======================================'
