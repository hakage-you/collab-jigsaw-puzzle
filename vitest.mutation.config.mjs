import { defineConfig } from 'vitest/config';

// Used by Stryker (stryker.config.mjs) only: the "node" project of vitest.config.mjs on its own,
// because the Stryker Vitest runner can't handle the browser project.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.node.test.js'],
  },
});
