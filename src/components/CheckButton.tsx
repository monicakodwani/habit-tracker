/**
 * The tap target that marks a habit done.
 *
 * One tap completes, another undoes — no confirmation, no detail page, no modal.
 * The state change is optimistic, so the only feedback needed is a quiet pop and the
 * filled circle.
 */
import { useEffect, useRef, useState } from 'react'

interface CheckButtonProps {
  checked: boolean
  /** Habit name, used to build a meaningful accessible label. */
  label: string
  onToggle: () => void
}

export function CheckButton({ checked, label, onToggle }: CheckButtonProps) {
  const animate = usePopOnCheck(checked)

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      // The visible circle is 32px but the hit area is a full 48px square, so the
      // control is comfortable to tap without making the row visually heavy.
      className="-m-2 flex size-12 shrink-0 items-center justify-center p-2"
      aria-label={checked ? `Undo ${label}` : `Mark ${label} complete`}
    >
      <span
        className={`flex size-8 items-center justify-center rounded-full border-2 transition-colors ${
          checked ? 'border-accent bg-accent text-bg' : 'border-line text-transparent'
        } ${animate ? 'animate-[check-pop_260ms_ease-out]' : ''}`}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
          <path
            d="m4.5 10.5 3.5 3.5 7.5-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  )
}

/**
 * True for a moment after `checked` flips to true.
 *
 * Only on the way in: undoing something should not be celebrated, and the initial
 * render of an already-completed habit should not animate either.
 */
function usePopOnCheck(checked: boolean): boolean {
  const [animate, setAnimate] = useState(false)
  const previous = useRef(checked)

  useEffect(() => {
    const justChecked = checked && !previous.current
    previous.current = checked
    if (!justChecked) return

    setAnimate(true)
    const timer = setTimeout(() => setAnimate(false), 300)
    return () => clearTimeout(timer)
  }, [checked])

  return animate
}

/** The read-only equivalent shown on a friend's habits: status, not a control. */
export function CheckIndicator({ checked }: { checked: boolean }) {
  return (
    <span
      role="img"
      aria-label={checked ? 'Completed' : 'Not yet'}
      className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
        checked ? 'border-accent bg-accent text-bg' : 'border-line text-transparent'
      }`}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3">
        <path
          d="m4.5 10.5 3.5 3.5 7.5-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
