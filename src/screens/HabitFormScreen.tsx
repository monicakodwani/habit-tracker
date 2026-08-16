/**
 * Create or edit a habit. Both modes share {@link HabitForm}; only the loading and
 * the save call differ.
 */
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import type { HabitDraft } from '../types/models'
import { BLANK_HABIT, HabitForm } from '../components/HabitForm'
import { PageHeader, Screen } from '../components/Layout'
import { ListSkeleton } from '../components/ui'

export function HabitFormScreen({ mode }: { mode: 'create' | 'edit' }) {
  const { habitId } = useParams<{ habitId: string }>()
  const navigate = useNavigate()
  const { status, me, habits, createHabit, updateHabit } = useAppData()

  const habit = habits.find((h) => h.id === habitId)

  if (mode === 'edit') {
    if (status === 'loading') {
      return (
        <Screen>
          <PageHeader title="Edit habit" backTo="/me" />
          <ListSkeleton rows={4} />
        </Screen>
      )
    }
    // Not found, or owned by someone else — either way there is nothing to edit here.
    // RLS would reject the write regardless; this just avoids showing a dead form.
    if (!habit || habit.owner_id !== me?.id) {
      return <Navigate to="/me" replace />
    }
  }

  const initial: HabitDraft = habit
    ? {
        name: habit.name,
        emoji: habit.emoji,
        recurrence_type: habit.recurrence_type,
        scheduled_days: habit.scheduled_days,
        weekly_target: habit.weekly_target,
        visibility: habit.visibility,
      }
    : BLANK_HABIT

  async function handleSubmit(draft: HabitDraft) {
    if (mode === 'edit' && habitId) {
      await updateHabit(habitId, draft)
      navigate(`/habits/${habitId}`, { replace: true })
    } else {
      const created = await createHabit(draft)
      navigate(`/habits/${created.id}`, { replace: true })
    }
  }

  return (
    <Screen>
      <PageHeader
        title={mode === 'edit' ? 'Edit habit' : 'New habit'}
        backTo={mode === 'edit' && habitId ? `/habits/${habitId}` : '/me'}
        backLabel={mode === 'edit' ? 'Cancel' : 'Back'}
      />
      <HabitForm
        initial={initial}
        submitLabel={mode === 'edit' ? 'Save changes' : 'Add habit'}
        onSubmit={handleSubmit}
      />
    </Screen>
  )
}
