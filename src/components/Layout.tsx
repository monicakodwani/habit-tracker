/**
 * Page scaffolding.
 *
 * The app is a single column. On a phone it fills the width; on a tablet or desktop
 * it stays capped at a comfortable reading width and centres, rather than stretching
 * a mobile layout across a wide screen.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Shared width cap and horizontal padding, so every screen lines up with the nav. */
export const CONTAINER = 'mx-auto w-full max-w-[28rem] px-5'

interface ScreenProps {
  children: ReactNode
  /** Adds bottom padding to clear the fixed tab bar and the iPhone home indicator. */
  withNav?: boolean
}

export function Screen({ children, withNav = true }: ScreenProps) {
  return (
    <main
      className={`${CONTAINER} pt-[calc(env(safe-area-inset-top)+1.5rem)] ${
        withNav
          ? 'pb-[calc(env(safe-area-inset-bottom)+6rem)]'
          : 'pb-[calc(env(safe-area-inset-bottom)+2rem)]'
      }`}
    >
      {children}
    </main>
  )
}

/** A titled group of rows. `title` is rendered as a quiet, spaced-out label. */
export function Section({
  title,
  action,
  children,
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-7 first:mt-0">
      {(title || action) && (
        <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-[0.09em] text-ink-faint">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** The rounded surface most content sits on. */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>
  )
}

/** A screen header with a back link — used on the pages pushed above the tabs. */
export function PageHeader({
  title,
  backTo,
  backLabel = 'Back',
  action,
}: {
  title: string
  backTo: string
  backLabel?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-6">
      <Link
        to={backTo}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 pr-3 text-sm font-medium text-ink-soft hover:text-ink"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
          <path
            d="M12.5 4 7 10l5.5 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {backLabel}
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {action}
      </div>
    </header>
  )
}
