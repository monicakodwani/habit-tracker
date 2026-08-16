-- ============================================================================
-- Fix: a user who is not yet in a group could not read their own profile.
--
-- THE BUG
--
-- The original policy was:
--
--   using (public.shares_group_with(id))
--
-- and `shares_group_with` joins group_members to group_members. For somebody who
-- belongs to no group, that join has nothing on either side, so it returns false —
-- including when the target row is their own. A brand new account could therefore
-- not see its own profile.
--
-- The visible symptom was severe and misleading: the app read no profile, tried to
-- create one to self-heal, hit a primary key conflict (the row was there all along,
-- merely invisible), and reported "This session is no longer valid." Every new
-- account hit this on first sign-in — which is exactly the documented flow, since
-- people sign up *before* an admin adds them to the group.
--
-- THE FIX
--
-- Allow a user to read their own profile unconditionally, independently of group
-- membership. This grants no access to anyone else's data: `id = auth.uid()` matches
-- exactly one row, your own.
--
-- Safe to run on a database that already has the original policy applied.
-- ============================================================================

drop policy if exists profiles_select_group_members       on public.profiles;
drop policy if exists profiles_select_self_or_group_member on public.profiles;

-- Read your own profile always; read other people's only when you share a group.
create policy profiles_select_self_or_group_member
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or public.shares_group_with(id)
  );

-- The original comment on this function claimed it covered the "I can see myself"
-- case. It only does so once the caller belongs to at least one group, which is the
-- assumption that caused the bug above. Restate it accurately.
comment on function public.shares_group_with is
  'True when target_user shares at least one group with the calling user. NOTE: false '
  'when the caller belongs to no group — including for their own id. Callers that must '
  'work for a group-less user need an explicit auth.uid() check as well.';
