/**
 * A bottom sheet on phones, a centred dialog on desktop.
 *
 * One component, one set of behaviour, two presentations. On a phone every use of
 * this is a thumb-reach action — choosing a nudge, deciding what to do about a habit
 * — so it slides up from where the thumb already is. With a pointer and a large
 * screen, a sheet pinned to the bottom edge is just a long way from where you are
 * looking, so from `sm` up it becomes a centred dialog.
 *
 * Nothing conditional happens in JavaScript: the difference is entirely CSS, so
 * there is no breakpoint state to get out of sync and no second component to keep
 * in step.
 *
 * Handles the things that are easy to forget and obvious when missing: Escape closes
 * it, a click on the backdrop closes it, focus moves inside on open and returns to
 * the trigger on close, focus is trapped while open, and the page behind cannot
 * scroll.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** Optional smaller line under the title. */
  subtitle?: ReactNode
  children: ReactNode
}

export function Sheet({ open, onClose, title, subtitle, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)

  /*
   * `onClose` lives in a ref so the effect below can depend on `open` ALONE.
   *
   * This is not a micro-optimisation, it is the difference between the sheet working
   * and not. Callers pass inline arrows and locally-declared functions, so `onClose`
   * gets a fresh identity on every render of the parent. With `onClose` in the
   * dependency array, typing a single character into a field inside the sheet
   * re-rendered the parent, tore this effect down and set it up again — the cleanup
   * moved focus back to the trigger and the setup moved it to the panel, so the field
   * lost focus after every keystroke and the iOS keyboard dismissed itself.
   *
   * Focus and the scroll lock belong to the *open* transition, and now depend on
   * exactly that.
   */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const focusables = useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled')),
    [],
  )

  useEffect(() => {
    if (!open) return

    returnFocusTo.current = document.activeElement as HTMLElement | null
    // Focus the panel itself rather than the first control, so a screen reader
    // announces the sheet's title before its options.
    panelRef.current?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      // Trap focus: tabbing past either end wraps to the other.
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      returnFocusTo.current?.focus()
    }
    // `open` only — see the note on onCloseRef. `focusables` is a stable useCallback
    // and is read through the closure rather than re-subscribing this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/25 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-[28rem] animate-[sheet-in_200ms_ease-out] rounded-t-3xl border border-line bg-surface px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 shadow-2xl focus:outline-none sm:animate-[dialog-in_160ms_ease-out] sm:rounded-2xl sm:px-6 sm:pb-6 sm:pt-5"
      >
        {/*
          Grab handle: a phone affordance for a sheet you can flick away. Meaningless
          next to a pointer, so it goes at `sm`. Hidden from assistive tech either way.
        */}
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-line sm:hidden" />

        <h2 className="text-[1.05rem] font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[0.85rem] text-ink-soft">{subtitle}</p>}

        <div className="mt-4 max-h-[65dvh] overflow-y-auto sm:max-h-[70dvh]">{children}</div>
      </div>
    </div>
  )
}

/** A full-width row inside a sheet. */
export function SheetAction({
  onClick,
  children,
  tone = 'normal',
  disabled = false,
}: {
  onClick: () => void
  children: ReactNode
  tone?: 'normal' | 'danger'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-13 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[0.95rem] font-medium transition-colors disabled:opacity-50 ${
        tone === 'danger'
          ? 'text-danger hover:bg-danger-soft'
          : 'text-ink hover:bg-sunken'
      }`}
    >
      {children}
    </button>
  )
}
