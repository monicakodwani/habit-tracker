/**
 * The desktop sidebar. Replaces the tab bar at `lg` and up — never both at once.
 *
 * Same routes, same order, same icons as the phone tab bar; both render from
 * `NAV_ITEMS`. Deliberately light: a wordmark, four destinations, and who you are
 * signed in as. No account menus, no settings tree, no collapse toggle — this is a
 * little shared household, not an admin console.
 */
import { NavLink } from 'react-router-dom'
import { useAppData } from '../hooks/useAppData'
import { NAV_ITEMS } from './navItems'

export function Sidebar() {
  const { me } = useAppData()

  return (
    <aside
      // `sticky` rather than `fixed` so it participates in the centred shell and
      // never overlaps content on a short window.
      className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0 lg:flex-col lg:py-8 lg:pl-8 lg:pr-2"
    >
      <div className="mb-8 flex items-center gap-2 px-3">
        <span aria-hidden="true" className="text-xl leading-none">
          🌱
        </span>
        <span className="text-[1.05rem] font-semibold tracking-tight">Habits</span>
      </div>

      <nav aria-label="Main">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-soft text-accent-ink'
                      : 'text-ink-soft hover:bg-sunken hover:text-ink'
                  }`
                }
              >
                {/* NavLink sets aria-current="page" itself, so the active state is
                    announced without colour being the only cue. */}
                <span className="shrink-0">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {me && (
        <div className="mt-auto flex min-w-0 items-center gap-2.5 px-3 pt-6">
          <span aria-hidden="true" className="text-lg leading-none">
            {me.avatar_emoji}
          </span>
          <span className="min-w-0 truncate text-[0.85rem] font-medium text-ink-soft">
            {me.display_name}
          </span>
        </div>
      )}
    </aside>
  )
}
