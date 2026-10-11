import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/src/**/*.test.tsx'],
    // NOTE: the DB-backed integration suites in apps/api/src (auth, crud,
    // assets, forms, import, publish) are narrative suites — each `it` block
    // builds on module-level state set up by the previous one (marked
    // `describe.sequential`). They require declaration order, so use
    // `--sequence.shuffle.files` (files only) for stress runs; full
    // `--sequence.shuffle` reorders tests *within* files and is intended for
    // order-independent unit tests only.
  },
});
