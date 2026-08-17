import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `base` stays at the default until GitHub Pages deployment lands (SPEC.md §9 step 7).
  test: {
    // The purity rule (SPEC.md §4) means nothing under src/pipeline/ needs a DOM to test.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
