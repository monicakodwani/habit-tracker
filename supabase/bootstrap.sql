-- ============================================================================
-- One-time bootstrap: create the group and add the three friends to it.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor), after all
-- three people have signed up in the app at least once.
--
-- Why this is a manual step: the client has no INSERT policy on `groups` or
-- `group_members` at all, so nobody can create a group or add themselves to one
-- from the browser. Membership is deliberately an admin action.
--
-- It is safe to re-run: the group is matched by name and memberships upsert.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- EDIT THESE, then run the whole file.
-- ---------------------------------------------------------------------------
do $$
declare
  group_name  constant text   := 'Us';               -- whatever you want to call it
  emails      constant text[] := array[              -- the sign-up emails, exactly
    'monica@example.com',
    'ura@example.com',
    'ojas@example.com'
  ];
  -- ------------------------------------------------------------------------
  gid       uuid;
  addr      text;
  uid       uuid;
  added     int := 0;
begin
  -- Find or create the group.
  select id into gid from public.groups where name = group_name;
  if gid is null then
    insert into public.groups (name) values (group_name) returning id into gid;
    raise notice 'Created group "%" (%)', group_name, gid;
  else
    raise notice 'Reusing existing group "%" (%)', group_name, gid;
  end if;

  foreach addr in array emails loop
    select id into uid from auth.users where lower(email) = lower(addr);

    if uid is null then
      raise warning 'No account found for % — have them sign up in the app first, then re-run this file.', addr;
      continue;
    end if;

    -- handle_new_user() normally creates this; insert defensively in case the
    -- account predates the trigger.
    insert into public.profiles (id, display_name)
    values (uid, split_part(addr, '@', 1))
    on conflict (id) do nothing;

    insert into public.group_members (group_id, user_id)
    values (gid, uid)
    on conflict (group_id, user_id) do nothing;

    added := added + 1;
    raise notice 'Added % (%) to the group', addr, uid;
  end loop;

  raise notice '--- % of % accounts are now in "%" ---', added, cardinality(emails), group_name;
end;
$$;

-- Verify: this should list your three friends.
select
  g.name  as group_name,
  p.display_name,
  p.avatar_emoji,
  p.timezone,
  u.email
from public.group_members gm
join public.groups   g on g.id = gm.group_id
join public.profiles p on p.id = gm.user_id
join auth.users      u on u.id = gm.user_id
order by g.name, p.display_name;
