/**
 * A single, small, transient message at the bottom of the screen.
 *
 * Used for failed writes ("Could not save. Put back."). Deliberately minimal: no
 * stacking, no celebration, no modal. Checking a habit off should feel quiet, and an
 * error should be legible without taking over the page.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type ToastTone = 'error' | 'info'

interface ToastValue {
  showToast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastValue | null>(null)

const DISMISS_AFTER_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; key: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, tone: ToastTone = 'error') => {
    // `key` restarts the enter animation when a second message replaces a first.
    setToast({ message, tone, key: Date.now() })
  }, [])

  useEffect(() => {
    if (!toast) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), DISMISS_AFTER_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [toast])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        `role="status"` with aria-live announces the message to screen readers without
        stealing focus. Sits above the tab bar and clear of the home indicator.
      */}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"
      >
        {toast && (
          <div
            key={toast.key}
            className={`pointer-events-auto max-w-[26rem] animate-[toast-in_180ms_ease-out] rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${
              // `text-bg` rather than a fixed white/black: the danger and ink tones
              // invert between light and dark, so the text has to invert with them.
              toast.tone === 'error' ? 'bg-danger text-bg' : 'bg-ink text-bg'
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside a ToastProvider')
  return context
}
