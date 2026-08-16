/**
 * What you can do about one of your own habits today.
 *
 * Lives in a sheet rather than as a row of buttons so the Today screen still scans in
 * one glance. Completing stays a single tap on the row itself — this is only for the
 * less-common actions, plus an optional note when asking for help.
 */
import { useState } from 'react'
import type { HabitStatus } from '../domain/status'
import { AT_RISK_NOTE_MAX_LENGTH } from '../domain/nudges'
import { Sheet, SheetAction } from './Sheet'
import { Button, INPUT_CLASS } from './ui'

interface HabitActionSheetProps {
  open: boolean
  onClose: () => void
  status: HabitStatus
  onComplete: () => void
  onUndoComplete: () => void
  onAtRisk: (note: string | null) => void
  onClearAtRisk: () => void
  onExcuse: () => void
  onUnexcuse: () => void
  onLapse: () => void
  onUndoLapse: () => void
}

export function HabitActionSheet(props: HabitActionSheetProps) {
  const { open, onClose, status } = props
  const { habit, outcome, atRisk, excused } = status
  const [askingForPush, setAskingForPush] = useState(false)
  const [note, setNote] = useState('')

  const isAvoid = habit.kind === 'avoid'
  const isShared = habit.visibility === 'shared'
  // Grace applies to scheduled occurrences; a weekly target has no single day to excuse.
  const canExcuse = habit.recurrence_type === 'scheduled_days'

  function close() {
    setAskingForPush(false)
    setNote('')
    onClose()
  }

  function run(action: () => void) {
    action()
    close()
  }

  if (askingForPush) {
    return (
      <Sheet
        open={open}
        onClose={close}
        title="Ask for a push"
        subtitle="Your group will see this and can nudge you."
      >
        <label className="block">
          <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink">
            Anything they should know? <span className="font-normal text-ink-faint">(optional)</span>
          </span>
          <input
            className={INPUT_CLASS}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="I'm exhausted. Make me do 10 pages."
            maxLength={AT_RISK_NOTE_MAX_LENGTH}
            enterKeyHint="done"
            autoCapitalize="sentences"
          />
        </label>
        <div className="mt-4 space-y-2">
          <Button full onClick={() => run(() => props.onAtRisk(note.trim() || null))}>
            Ask for a push
          </Button>
          <Button variant="quiet" full onClick={() => setAskingForPush(false)}>
            Back
          </Button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={habit.name}
      subtitle={
        <>
          <span aria-hidden="true">{habit.emoji}</span>{' '}
          {isAvoid ? 'Avoiding this today' : 'On your list today'}
        </>
      }
    >
      <div className="space-y-0.5">
        {/* --- the main action, which differs by habit kind --- */}
        {isAvoid ? (
          outcome === 'lapsed' ? (
            <SheetAction onClick={() => run(props.onUndoLapse)}>
              <span aria-hidden="true">↻</span> Undo the slip
            </SheetAction>
          ) : (
            <SheetAction onClick={() => run(props.onLapse)}>
              <span aria-hidden="true">🫤</span> I slipped today
            </SheetAction>
          )
        ) : status.completedToday ? (
          <SheetAction onClick={() => run(props.onUndoComplete)}>
            <span aria-hidden="true">↻</span> Undo completion
          </SheetAction>
        ) : (
          <SheetAction onClick={() => run(props.onComplete)}>
            <span aria-hidden="true">✅</span> Mark complete
          </SheetAction>
        )}

        {/*
          Asking for a push only makes sense for a shared habit that is still
          outstanding — nobody can help with a private one, and there is nothing to
          rescue once it is done.
        */}
        {isShared && !excused && (outcome === 'pending' || outcome === 'still-going' || (status.weekly && !status.weekly.met)) && (
          atRisk ? (
            <SheetAction onClick={() => run(props.onClearAtRisk)}>
              <span aria-hidden="true">✋</span> I&rsquo;m fine actually
            </SheetAction>
          ) : (
            <SheetAction onClick={() => setAskingForPush(true)}>
              <span aria-hidden="true">⚠️</span> I need a push
            </SheetAction>
          )
        )}

        {canExcuse &&
          (excused ? (
            <SheetAction onClick={() => run(props.onUnexcuse)}>
              <span aria-hidden="true">↻</span> Un-excuse today
            </SheetAction>
          ) : (
            <SheetAction onClick={() => run(props.onExcuse)}>
              <span aria-hidden="true">❄️</span> Excuse today
            </SheetAction>
          ))}
      </div>

      {canExcuse && !excused && (
        <p className="mt-3 px-4 text-[0.75rem] leading-relaxed text-ink-faint">
          An excused day doesn&rsquo;t count as done, and doesn&rsquo;t break your streak.
        </p>
      )}
    </Sheet>
  )
}
