/**
 * The phone tab bar.
 *
 * Hidden from `lg` up, where {@link Sidebar} takes over. Both render from the same
 * `NAV_ITEMS`, so a destination can never exist in one and not the other.
 */
import { NavLink } from 'react-router-dom'
import { GUTTER } from './Layout'
import { NAV_ITEMS } from './navItems'

export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className={`mx-auto flex w-full max-w-[28rem] md:max-w-[46rem] ${GUTTER}`}>
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.end}
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
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
