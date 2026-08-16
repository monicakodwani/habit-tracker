import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import './index.css'

/*
 * HashRouter, not BrowserRouter.
 *
 * GitHub Pages serves static files and has no way to rewrite unknown paths to
 * index.html, so with a normal router a refresh on /week would 404. The usual
 * workaround — a 404.html that reconstructs the URL in JavaScript — adds a redirect
 * flash and a piece of machinery to maintain. Hash routing simply cannot break, works
 * under any repository subpath without configuration, and the URLs are only ever seen
 * by three people.
 */
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
