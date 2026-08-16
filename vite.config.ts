import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves this app from https://USER.github.io/<repo>/, not from "/".
// The deploy workflow sets VITE_BASE_PATH="/<repo>/" so the built asset URLs resolve.
// Locally (and for any root-hosted deploy) it falls back to "/".
const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
})
