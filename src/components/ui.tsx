/**
 * Small shared UI pieces: buttons, empty states, loading skeletons.
 *
 * Everything here is sized for a thumb — interactive elements are at least 44px
 * tall, which is Apple's minimum comfortable tap target.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

const BUTTON_BASE =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55'

const VARIANTS = {
  primary: 'bg-accent text-bg hover:opacity-90',
  secondary: 'border border-line bg-surface text-ink hover:bg-sunken',
  quiet: 'text-ink-soft hover:text-ink',
  danger: 'border border-danger/40 bg-danger-soft text-danger hover:bg-danger/15',
} as const

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS
  full?: boolean
}

export function Button({
  variant = 'primary',
  full = false,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} ${VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    />
  )
}

/** A link styled as a button, for navigation rather than actions. */
export function ButtonLink({
  to,
  variant = 'primary',
  full = false,
  children,
}: {
  to: string
  variant?: keyof typeof VARIANTS
  full?: boolean
  children: ReactNode
}) {
  return (
    <Link to={to} className={`${BUTTON_BASE} ${VARIANTS[variant]} ${full ? 'w-full' : ''}`}>
      {children}
    </Link>
  )
}

/**
 * Empty states are real product UI, not a fallback. They say something human and,
 * where there is an obvious next step, offer it.
 */
export function EmptyState({
  title,
  action,
  compact = false,
}: {
  title: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-line px-5 text-center ${
        compact ? 'py-5' : 'py-9'
      }`}
    >
      <p className="text-[0.95rem] text-ink-soft">{title}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/** A grey block standing in for content that is still loading. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-[skeleton-pulse_1.6s_ease-in-out_infinite] rounded-xl bg-sunken ${className}`}
    />
  )
}

/**
 * The Today screen's loading state.
 *
 * Mirrors the real layout — a heading, then habit rows — so content settles into
 * place instead of the page jumping to a different shape once data arrives.
 */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[4.5rem]" />
      ))}
    </div>
  )
}

/** A full-screen centred spinner, for the brief moment before auth resolves. */
export function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <div className="size-7 animate-spin rounded-full border-2 border-line border-t-accent" />
    </div>
  )
}

/** An inline field-level or form-level error message. */
export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-2 text-sm font-medium text-danger">
      {children}
    </p>
  )
}

/** A labelled text input sized so iOS does not zoom when it gains focus. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  )
}

/**
 * Shared styling for text inputs and selects.
 *
 * Note it sets `w-full` and no other width. Appending a competing width utility
 * (`w-20`) does NOT override it — Tailwind resolves same-property conflicts by
 * stylesheet order, not by the order classes appear in the attribute. To make an
 * input narrower, wrap it in a sized container instead.
 */
export const INPUT_CLASS =
  'w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'
