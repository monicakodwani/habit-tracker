/**
 * Page scaffolding and the responsive app shell.
 *
 * ONE layout system, three sizes, no duplicated screen trees:
 *
 *   phone   (<768px)  single column, fixed bottom tab bar, safe-area padding
 *   tablet  (768px+)  same shape, wider column, more gutter
 *   desktop (1024px+) left sidebar replaces the tab bar; screens may use two
 *                     columns and the shell opens up to ~1280px
 *
 * The breakpoint that matters is `lg` (1024px): below it the tab bar, above it the
 * sidebar, never both. Everything else is progressive width.
 *
 * Screens do not set their own widths. They pick a {@link ScreenWidth} intent and
 * this file decides what that means at each size, so the app cannot drift into a
 * collection of one-off `max-w-` overrides.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Horizontal padding, shared so the tab bar lines up with content on phones.
 * The width cap lives with each screen's intent, not here.
 */
export const GUTTER = 'px-5 md:px-6 lg:px-8'

/** Width cap for the whole desktop shell — sidebar plus content. */
const SHELL = 'lg:max-w-[80rem]'

/**
 * How wide a screen wants to be.
 *
 * - `default`  — fills the desktop content region. Today, Week.
 * - `settings` — roomy enough for two columns of controls, narrow enough that a row
 *                does not put its label and its button a screen apart. Me.
 * - `reading`  — a comfortable measure for prose-like content. Activity.
 * - `form`     — narrower still; a 1000px-wide text input helps nobody.
 */
export type ScreenWidth = 'default' | 'settings' | 'reading' | 'form'

const WIDTHS: Record<ScreenWidth, string> = {
  // On phones every screen is the same ~28rem column it has always been.
  default: 'max-w-[28rem] md:max-w-[46rem] lg:max-w-none',
  settings: 'max-w-[28rem] md:max-w-[46rem] lg:max-w-[54rem]',
  reading: 'max-w-[28rem] md:max-w-[44rem] lg:max-w-[46rem]',
  form: 'max-w-[28rem] md:max-w-[42rem] lg:max-w-[42rem]',
}

interface ScreenProps {
  children: ReactNode
  /**
   * Adds bottom padding to clear the fixed tab bar and the iPhone home indicator.
   * Irrelevant on desktop, where the sidebar replaces the tab bar.
   */
  withNav?: boolean
  width?: ScreenWidth
}

export function Screen({ children, withNav = true, width = 'default' }: ScreenProps) {
  return (
    <main
      className={`mx-auto w-full ${WIDTHS[width]} ${GUTTER} pt-[calc(env(safe-area-inset-top)+1.5rem)] lg:pt-10 ${
        withNav
          ? // The safe-area term must survive on phones — it is what keeps the last
            // row clear of the home indicator in the installed PWA.
            'pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-16'
          : 'pb-[calc(env(safe-area-inset-bottom)+2rem)] lg:pb-16'
      }`}
    >
      {children}
    </main>
  )
}

/**
 * The desktop shell: sidebar beside content, centred and capped.
 *
 * Below `lg` this is a plain pass-through, so the phone layout is untouched by it.
 */
export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className={`mx-auto w-full ${SHELL} lg:flex lg:gap-2`}>
      {sidebar}
      {/* min-w-0 stops a long habit name from widening the column and forcing the
          whole shell to scroll sideways. */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * A titled group of rows.
 *
 * `spacing="tight"` is for sections stacked inside a desktop column, where the
 * default rhythm is too airy.
 */
export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`mt-7 first:mt-0 ${className}`}>
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

/**
 * Two columns on desktop, stacked below it.
 *
 * `ratio` picks how the space is split. `items-start` keeps the columns
 * independent, so a long left column does not stretch the right one's card.
 */
export function Columns({
  children,
  ratio = 'even',
  className = '',
}: {
  children: ReactNode
  ratio?: 'even' | 'wide-left'
  className?: string
}) {
  const grid =
    ratio === 'wide-left'
      ? 'lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]'
      : 'lg:grid-cols-2'

  return (
    <div className={`lg:grid ${grid} lg:items-start lg:gap-8 ${className}`}>{children}</div>
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

/**
 * A screen title.
 *
 * Slightly larger on desktop, deliberately only slightly: this is a daily-use app,
 * not a landing page.
 */
export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className="mb-7 lg:mb-8">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight lg:text-[2rem]">
        {children}
      </h1>
      {subtitle && <p className="mt-1 text-[0.95rem] text-ink-soft">{subtitle}</p>}
    </header>
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
    <header className="mb-6 lg:mb-8">
      <Link
        to={backTo}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 pr-3 text-sm font-medium text-ink-soft transition-colors hover:text-ink"
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
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight lg:text-[2rem]">
          {title}
        </h1>
        {action}
      </div>
    </header>
  )
}
