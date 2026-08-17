-- ============================================================================
-- Stop defaulting people to a US timezone.
--
-- The original schema fell back to 'America/New_York' whenever a new account
-- arrived without a timezone in its metadata. That is a confidently wrong guess: it
-- silently shifts what "today" means for anyone outside the US Eastern zone, which in
-- this app decides when habits are due, when a day is finalised, when an at-risk
-- marker expires and where a streak breaks.
--
-- The app itself always sends the device's timezone at sign-up, so this fallback only
-- fires for accounts created another way (the Supabase dashboard, a seed script). For
-- those, 'UTC' is the honest answer — it reads as "not set yet" rather than as a
-- deliberate choice, and the app prompts the person to correct it on first visit.
--
-- EXISTING ROWS ARE DELIBERATELY NOT TOUCHED. Rewriting someone's timezone would move
-- their day boundaries underneath them and could break a streak that is genuinely
-- correct — Monica really is in New York. People change it themselves, in Me.
-- ============================================================================

alter table public.profiles
  alter column timezone set default 'UTC';

comment on column public.profiles.timezone is
  'IANA timezone name. Drives every "what day is it" decision for this user. Defaults '
  'to UTC only when unknown; the app sends the device zone at sign-up and offers to '
  'correct a mismatch afterwards.';

/*
 * Same change in the sign-up trigger, which is the path that actually runs for a
 * normal account. Everything else about the function is unchanged.
 */
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
    -- The app sends the device's IANA zone here. UTC only when it genuinely is not known.
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'timezone'), ''), 'UTC')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
