/**
 * A bottom sheet.
 *
 * Chosen over a centred modal because every use of it is a thumb-reach action on a
 * phone: choosing a nudge, or picking what to do about a habit. It slides up from
 * where the thumb already is.
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
        onClose()
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
  }, [open, onClose, focusables])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
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
        className="relative w-full max-w-[28rem] animate-[sheet-in_200ms_ease-out] rounded-t-3xl border border-line bg-surface px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 shadow-2xl focus:outline-none"
      >
        {/* Grab handle: purely a visual affordance, hidden from assistive tech. */}
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" />

        <h2 className="text-[1.05rem] font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[0.85rem] text-ink-soft">{subtitle}</p>}

        <div className="mt-4 max-h-[65dvh] overflow-y-auto">{children}</div>
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
