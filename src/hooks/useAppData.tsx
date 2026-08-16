/**
 * The app's single data load.
 *
 * Everything the Today, Week and Me screens need comes from here: the signed-in
 * user's profile, their group, the other members, every habit visible to them, and a
 * useful window of check-ins. Loading it once in one place — rather than per screen —
 * keeps the request count low and means tapping between tabs is instant.
 *
 * Writes go through this hook too, so an optimistic update and its rollback live next
 * to the state they touch.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type {
  Checkin,
  Group,
  Habit,
  HabitDay,
  HabitDraft,
  LocalDate,
  Nudge,
  Profile,
} from '../types/models'
import { addDays, endOfWeek, guessTimezone, safeZone, startOfWeek, todayIn } from '../domain/dates'
import { describeError, supabase } from '../lib/supabase'
import { ensureProfile, fetchGroupMembers, fetchMyGroup, fetchMyProfile } from '../services/groups'
import type { ProfileUpdate } from '../services/groups'
import { updateProfile as updateProfileRequest } from '../services/groups'
import * as habitService from '../services/habits'
import * as social from '../services/social'
import { addCheckin, fetchCheckins, removeCheckin } from '../services/checkins'
import { requestPushDelivery } from '../services/notifications'
import { NUDGE_COOLDOWN_MS } from '../domain/nudges'
import { useAuth } from './useAuth'
import { useToast } from '../components/Toast'

/**
 * How far back the signed-in user's own check-ins are loaded.
 *
 * Streaks are computed from this window, so it needs to comfortably exceed any streak
 * worth displaying while keeping the payload small on a phone. Just over a year is a
 * deliberate trade: a streak longer than this would be reported short, which for
 * three friends starting out is not a real risk, and the habit detail screen fetches
 * that habit's full history anyway.
 */
const OWN_HISTORY_DAYS = 400

type Status = 'loading' | 'ready' | 'error' | 'no-group'

interface AppDataValue {
  status: Status
  error: string | null

  me: Profile | null
  group: Group | null
  /** Everyone in the group, including the signed-in user. */
  members: Profile[]
  /** Everyone except the signed-in user. */
  friends: Profile[]
  habits: Habit[]
  checkins: Checkin[]
  /** Per-day state: grace, avoidance lapses and at-risk markers. */
  habitDays: HabitDay[]
  /** Nudges this user has sent inside the cooldown window, for availability checks. */
  sentNudges: Nudge[]

  /** Today in the signed-in user's own timezone. Re-evaluated as the clock rolls over. */
  today: LocalDate
  /** The signed-in user's timezone, already validated. */
  zone: string

  reload: () => Promise<void>
  toggleCheckin: (habit: Habit, date: LocalDate, completed: boolean) => Promise<void>
  createHabit: (draft: HabitDraft) => Promise<Habit>
  updateHabit: (habitId: string, draft: HabitDraft) => Promise<Habit>
  setHabitActive: (habitId: string, active: boolean) => Promise<void>
  deleteHabit: (habitId: string) => Promise<void>
  updateProfile: (patch: ProfileUpdate) => Promise<void>

  // --- social ---
  sendNudge: (habit: Habit, message: string, preset: string | null) => Promise<void>
  markAtRisk: (habit: Habit, note: string | null) => Promise<void>
  clearAtRisk: (habit: Habit) => Promise<void>
  setExcused: (habit: Habit, date: LocalDate, excused: boolean) => Promise<void>
  setLapse: (habit: Habit, date: LocalDate, lapsed: boolean) => Promise<void>
}

const AppDataContext = createContext<AppDataValue | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { showToast } = useToast()

  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<Profile | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [habits, setHabits] = useState<Habit[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [habitDays, setHabitDays] = useState<HabitDay[]>([])
  const [sentNudges, setSentNudges] = useState<Nudge[]>([])

  const zone = safeZone(me?.timezone)
  const today = useToday(zone)

  // Guards against a slow response from a previous user (or a previous load)
  // overwriting fresher state.
  const loadToken = useRef(0)

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!user) return
      const token = ++loadToken.current
      if (mode === 'initial') setStatus('loading')

      try {
        const [existingProfile, myGroup] = await Promise.all([
          fetchMyProfile(user.id),
          fetchMyGroup(),
        ])
        if (token !== loadToken.current) return

        let profile = existingProfile
        if (!profile) {
          // The `on_auth_user_created` trigger normally creates this row, so reaching
          // here means the account predates the migration — which creating it fixes.
          try {
            profile = await ensureProfile(user.id, {
              display_name: defaultDisplayName(user.email),
              timezone: guessTimezone(),
            })
          } catch (cause) {
            if (token !== loadToken.current) return
            setStatus('error')
            setError(diagnoseMissingProfile(cause))
            return
          }
          if (token !== loadToken.current) return
        }
        setMe(profile)

        if (!myGroup) {
          setStatus('no-group')
          return
        }
        setGroup(myGroup)

        const [groupMembers, groupHabits] = await Promise.all([
          fetchGroupMembers(myGroup.id),
          habitService.fetchGroupHabits(myGroup.id),
        ])
        if (token !== loadToken.current) return

        setMembers(groupMembers)
        setHabits(groupHabits)

        const ownZone = safeZone(profile.timezone)
        const [loadedCheckins, loadedDays, loadedNudges] = await Promise.all([
          loadCheckins(groupHabits, user.id, ownZone),
          loadHabitDays(groupHabits, user.id, ownZone),
          social.fetchMyRecentNudges(
            user.id,
            new Date(Date.now() - NUDGE_COOLDOWN_MS).toISOString(),
          ),
        ])
        if (token !== loadToken.current) return

        setCheckins(loadedCheckins)
        setHabitDays(loadedDays)
        setSentNudges(loadedNudges)

        setError(null)
        setStatus('ready')
      } catch (cause) {
        if (token !== loadToken.current) return
        setError(describeError(cause))
        setStatus('error')
      }
    },
    [user],
  )

  useEffect(() => {
    if (!user) {
      // Clear everything on sign-out so a second account never sees the first's data.
      setMe(null)
      setGroup(null)
      setMembers([])
      setHabits([])
      setCheckins([])
      setHabitDays([])
      setSentNudges([])
      setStatus('loading')
      setError(null)
      return
    }
    void load('initial')
  }, [user, load])

  const reload = useCallback(() => load('refresh'), [load])

  useRealtimeRefresh(Boolean(user) && status === 'ready', reload)

  // --- Writes ---------------------------------------------------------------

  /**
   * Marks a habit complete or undoes it.
   *
   * The local state moves first so the tap feels instant, then the write goes out.
   * If it fails, the exact previous check-in list is restored and the reason is shown
   * — the page keeps its scroll position and every other row keeps its state.
   */
  const toggleCheckin = useCallback(
    async (habit: Habit, date: LocalDate, completed: boolean) => {
      if (!user) return
      const previous = checkins

      const optimistic: Checkin = {
        id: `optimistic:${habit.id}:${date}`,
        habit_id: habit.id,
        user_id: user.id,
        completion_date: date,
        created_at: new Date().toISOString(),
      }

      setCheckins((current) =>
        completed
          ? current.filter((c) => !(c.habit_id === habit.id && c.completion_date === date))
          : [...current, optimistic],
      )

      try {
        if (completed) {
          await removeCheckin(habit.id, date)
        } else {
          const saved = await addCheckin(habit.id, user.id, date)
          // Swap the placeholder for the row the database actually created, so its
          // real id is available for anything that needs it later.
          setCheckins((current) => current.map((c) => (c.id === optimistic.id ? saved : c)))
        }
      } catch (cause) {
        setCheckins(previous)
        showToast(describeError(cause))
      }
    },
    [user, checkins, showToast],
  )

  // --- Social actions -------------------------------------------------------

  /**
   * Patches one habit-day row in local state, creating it if absent.
   *
   * Returns the previous array so a caller can roll back after a failed write.
   */
  const patchDay = useCallback(
    (habitId: string, userId: string, date: LocalDate, patch: Partial<HabitDay>) => {
      setHabitDays((current) => {
        const index = current.findIndex(
          (d) => d.habit_id === habitId && d.day_date === date,
        )
        if (index >= 0) {
          const next = [...current]
          next[index] = { ...next[index]!, ...patch }
          return next
        }
        return [
          ...current,
          {
            id: `optimistic:${habitId}:${date}`,
            habit_id: habitId,
            user_id: userId,
            day_date: date,
            excused: false,
            lapsed: false,
            at_risk_at: null,
            at_risk_note: null,
            ...patch,
          },
        ]
      })
    },
    [],
  )

  /**
   * Sends a nudge.
   *
   * Not optimistic: every rule lives in the database, so pretending it succeeded
   * would regularly be wrong. It is a single fast round trip and the sheet shows a
   * pending state while it runs.
   *
   * Push delivery is requested afterwards and deliberately cannot fail the nudge —
   * the nudge is already stored and visible in the app.
   */
  const sendNudge = useCallback(
    async (habit: Habit, message: string, preset: string | null) => {
      if (!user || !group) throw new Error('Not ready')
      const id = await social.sendNudge(habit.id, message, preset)

      setSentNudges((current) => [
        {
          id,
          group_id: group.id,
          habit_id: habit.id,
          sender_id: user.id,
          recipient_id: habit.owner_id,
          day_date: today,
          preset,
          message,
          created_at: new Date().toISOString(),
        },
        ...current,
      ])

      void requestPushDelivery('nudge', id)
      void reload()
    },
    [user, group, today, reload],
  )

  const markAtRisk = useCallback(
    async (habit: Habit, note: string | null) => {
      if (!user) return
      const previous = habitDays
      patchDay(habit.id, user.id, today, {
        at_risk_at: new Date().toISOString(),
        at_risk_note: note,
      })

      try {
        // The server decides the date, in the owner's timezone — which is what makes
        // an at-risk marker expire correctly at that person's midnight.
        const date = await social.markAtRisk(habit.id, note)
        if (date !== today) {
          setHabitDays(previous)
          await reload()
        }
        void requestPushDelivery('at_risk', habit.id)
      } catch (cause) {
        setHabitDays(previous)
        showToast(describeError(cause))
      }
    },
    [user, habitDays, today, patchDay, reload, showToast],
  )

  const clearAtRisk = useCallback(
    async (habit: Habit) => {
      if (!user) return
      const previous = habitDays
      patchDay(habit.id, user.id, today, { at_risk_at: null, at_risk_note: null })

      try {
        await social.clearAtRisk(habit.id)
      } catch (cause) {
        setHabitDays(previous)
        showToast(describeError(cause))
      }
    },
    [user, habitDays, today, patchDay, showToast],
  )

  const setExcused = useCallback(
    async (habit: Habit, date: LocalDate, excused: boolean) => {
      if (!user) return
      const previous = habitDays
      // Excusing clears any lapse and any call for help, mirroring what set_excused does.
      patchDay(habit.id, user.id, date, {
        excused,
        ...(excused ? { lapsed: false, at_risk_at: null, at_risk_note: null } : {}),
      })

      try {
        await social.setExcused(habit.id, date, excused)
      } catch (cause) {
        setHabitDays(previous)
        showToast(describeError(cause))
      }
    },
    [user, habitDays, patchDay, showToast],
  )

  const setLapse = useCallback(
    async (habit: Habit, date: LocalDate, lapsed: boolean) => {
      if (!user) return
      const previous = habitDays
      patchDay(habit.id, user.id, date, {
        lapsed,
        ...(lapsed ? { excused: false, at_risk_at: null, at_risk_note: null } : {}),
      })

      try {
        await social.setLapse(habit.id, date, lapsed)
      } catch (cause) {
        setHabitDays(previous)
        showToast(describeError(cause))
      }
    },
    [user, habitDays, patchDay, showToast],
  )

  const createHabit = useCallback(
    async (draft: HabitDraft) => {
      if (!user || !group) throw new Error('Not ready')
      const habit = await habitService.createHabit(user.id, group.id, draft)
      setHabits((current) => [...current, habit])
      return habit
    },
    [user, group],
  )

  const updateHabit = useCallback(async (habitId: string, draft: HabitDraft) => {
    const habit = await habitService.updateHabit(habitId, draft)
    setHabits((current) => current.map((h) => (h.id === habitId ? habit : h)))
    return habit
  }, [])

  const setHabitActive = useCallback(async (habitId: string, active: boolean) => {
    const habit = await habitService.setHabitActive(habitId, active)
    setHabits((current) => current.map((h) => (h.id === habitId ? habit : h)))
  }, [])

  const deleteHabit = useCallback(async (habitId: string) => {
    await habitService.deleteHabit(habitId)
    setHabits((current) => current.filter((h) => h.id !== habitId))
    setCheckins((current) => current.filter((c) => c.habit_id !== habitId))
    setHabitDays((current) => current.filter((d) => d.habit_id !== habitId))
  }, [])

  const updateProfile = useCallback(
    async (patch: ProfileUpdate) => {
      if (!user) return
      const profile = await updateProfileRequest(user.id, patch)
      setMe(profile)
      setMembers((current) => current.map((m) => (m.id === profile.id ? profile : m)))
    },
    [user],
  )

  const friends = useMemo(
    () => members.filter((m) => m.id !== user?.id),
    [members, user?.id],
  )

  const value = useMemo<AppDataValue>(
    () => ({
      status,
      error,
      me,
      group,
      members,
      friends,
      habits,
      checkins,
      habitDays,
      sentNudges,
      today,
      zone,
      reload,
      toggleCheckin,
      createHabit,
      updateHabit,
      setHabitActive,
      deleteHabit,
      updateProfile,
      sendNudge,
      markAtRisk,
      clearAtRisk,
      setExcused,
      setLapse,
    }),
    [
      status, error, me, group, members, friends, habits, checkins, habitDays,
      sentNudges, today, zone, reload, toggleCheckin, createHabit, updateHabit,
      setHabitActive, deleteHabit, updateProfile, sendNudge, markAtRisk, clearAtRisk,
      setExcused, setLapse,
    ],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataValue {
  const context = useContext(AppDataContext)
  if (!context) throw new Error('useAppData must be used inside an AppDataProvider')
  return context
}

/** Fallback name for a self-healed profile: the local part of the email address. */
function defaultDisplayName(email: string | undefined): string {
  const local = email?.split('@')[0]?.trim()
  return local && local.length > 0 ? local.slice(0, 40) : 'Friend'
}

/**
 * Explains why a profile could neither be read nor created.
 *
 * The two causes look identical from the UI but mean opposite things, and saying the
 * wrong one sends whoever is debugging in entirely the wrong direction:
 *
 *   - 23505, unique/primary key violation — the row exists but the SELECT policy is
 *     not returning it to its own owner. A policy problem, not a session problem.
 *   - 23503, foreign key violation — there is no auth.users row, so the session
 *     refers to an account that no longer exists.
 */
function diagnoseMissingProfile(cause: unknown): string {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : ''

  if (code === '23505') {
    return 'Your profile exists but is not readable by your own account. This is a database policy problem — check that the latest migration in supabase/migrations has been applied.'
  }
  if (code === '23503') {
    return 'This session is no longer valid. Sign out and sign in again.'
  }
  return describeError(cause)
}

/**
 * Loads check-ins in two shapes, because the screens need two different depths:
 *
 *   - the user's own habits get a long window, since streaks are computed from it;
 *   - friends' habits get just the current week, which is all their cards show.
 *
 * The friends' window is padded by a day at each end so a friend in a timezone ahead
 * of or behind the user still has their whole local week covered.
 */
async function loadCheckins(
  habits: readonly Habit[],
  userId: string,
  zone: string,
): Promise<Checkin[]> {
  const today = todayIn(zone)

  const mine = habits.filter((h) => h.owner_id === userId).map((h) => h.id)
  const theirs = habits.filter((h) => h.owner_id !== userId).map((h) => h.id)

  const [own, friends] = await Promise.all([
    fetchCheckins(mine, addDays(today, -OWN_HISTORY_DAYS, zone), addDays(today, 1, zone)),
    fetchCheckins(
      theirs,
      addDays(startOfWeek(today, zone), -1, zone),
      addDays(endOfWeek(today, zone), 1, zone),
    ),
  ])

  return [...own, ...friends]
}

/**
 * Day states, on the same two-depth principle as check-ins.
 *
 * Own habits get the long window because excused days feed into streaks; friends'
 * habits only need the current week, padded by a day at each end so a friend in
 * another timezone still has their whole local week covered.
 */
async function loadHabitDays(
  habits: readonly Habit[],
  userId: string,
  zone: string,
): Promise<HabitDay[]> {
  const today = todayIn(zone)

  const mine = habits.filter((h) => h.owner_id === userId).map((h) => h.id)
  const theirs = habits.filter((h) => h.owner_id !== userId).map((h) => h.id)

  const [own, friends] = await Promise.all([
    social.fetchHabitDays(mine, addDays(today, -OWN_HISTORY_DAYS, zone), addDays(today, 1, zone)),
    social.fetchHabitDays(
      theirs,
      addDays(startOfWeek(today, zone), -1, zone),
      addDays(endOfWeek(today, zone), 1, zone),
    ),
  ])

  return [...own, ...friends]
}

/**
 * Today's date in `zone`, kept current while the app is open.
 *
 * A phone left on the Today screen overnight, or a PWA resumed from the background
 * the next morning, should roll over on its own rather than showing yesterday.
 */
function useToday(zone: string): LocalDate {
  const [today, setToday] = useState(() => todayIn(zone))

  useEffect(() => {
    const sync = () => setToday((current) => {
      const next = todayIn(zone)
      return next === current ? current : next
    })

    sync()
    const interval = setInterval(sync, 60_000)
    // Resuming from the background can skip many intervals, so re-check on wake.
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [zone])

  return today
}

/**
 * Refetches when someone else changes something.
 *
 * Realtime is used purely as a "something moved" signal — the payload is never
 * trusted or merged. That keeps it simple and safe: RLS decides what the refetch
 * returns, exactly as it does on first load. Changes are debounced so a friend
 * checking off four habits in a row causes one refetch, not four.
 */
function useRealtimeRefresh(enabled: boolean, reload: () => Promise<void>) {
  // Held in a ref so re-subscribing is not triggered by `reload` changing identity.
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void reloadRef.current(), 1500)
    }

    // Every social table that affects what Today and Activity show. All of them are
    // just triggers to refetch; `push_subscriptions` is deliberately absent from the
    // publication entirely, because its rows are secret material.
    const channel = supabase
      .channel('habits-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habit_checkins' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habit_days' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_events' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_reactions' }, schedule)
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [enabled])
}
