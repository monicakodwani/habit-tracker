/**
 * The tab bar.
 *
 * Four tabs now that Activity is real: Today, Week, Activity, Me. It was deliberately
 * omitted while the feed was still a placeholder rather than shipped empty.
 */
import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { CONTAINER } from './Layout'

interface Tab {
  to: string
  label: string
  icon: ReactNode
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const TABS: Tab[] = [
  {
    to: '/',
    label: 'Today',
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

export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={`${CONTAINER} flex`}>
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              // `end` so "/" is only active on Today, not on every nested route.
              end={tab.to === '/'}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[0.68rem] font-semibold transition-colors ${
                  isActive ? 'text-accent' : 'text-ink-faint hover:text-ink-soft'
                }`
              }
            >
              {/*
                NavLink sets aria-current="page" on the active tab by itself, so the
                selected state is announced without colour being the only cue.
              */}
              {tab.icon}
              <span>{tab.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
