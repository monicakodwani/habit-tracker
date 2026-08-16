/**
 * The four destinations, defined once.
 *
 * Both the phone tab bar and the desktop sidebar render from this list, so a route
 * can never appear in one and not the other. Only the presentation differs.
 */
import type { ReactNode } from 'react'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
  /** `end` so "/" only matches Today, not every nested route. */
  end?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Today',
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" {...stroke} />
        <path d="M4 9.5h16M8.5 3v3.5M15.5 3v3.5" {...stroke} />
        <path d="m9 14.5 2 2 4-4" {...stroke} />
      </svg>
    ),
  },
  {
    to: '/week',
    label: 'Week',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        <path d="M4 7h4v10H4zM10 7h4v10h-4zM16 7h4v10h-4z" {...stroke} />
      </svg>
    ),
  },
  {
    to: '/activity',
    label: 'Activity',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        <path d="M4 19V5a1 1 0 0 1 1-1h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" {...stroke} />
        <path d="M8 11h8M8 15h5" {...stroke} />
      </svg>
    ),
  },
  {
    to: '/me',
    label: 'Me',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        <circle cx="12" cy="8.5" r="3.5" {...stroke} />
        <path d="M5 20a7 7 0 0 1 14 0" {...stroke} />
      </svg>
    ),
  },
]
