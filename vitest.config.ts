import { defineConfig } from 'vitest/config'

/*
 * Test config is kept separate from vite.config.ts on purpose.
 *
 * The tests cover `src/domain` — pure TypeScript with no JSX and no CSS — so they
 * need none of the app's build plugins. Keeping the two configs apart also avoids a
 * type clash between the app's Vite and the copy Vitest bundles.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
