import { defineConfig } from 'vitest/config';

/** The repository name, which GitHub Pages serves the site under. */
const REPOSITORY = 'valuestudypwa';

export default defineConfig(({ command }) => ({
  // Pages serves the site from a subdirectory, so built asset URLs need that prefix. The dev
  // server does not, and prefixing there would only make the local URL longer.
  base: command === 'build' ? `/${REPOSITORY}/` : '/',
  test: {
    // The purity rule (SPEC.md §4) means nothing under src/pipeline/ needs a DOM to test.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
