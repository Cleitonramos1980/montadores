import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout:  30000,
    hookTimeout:  15000,
    pool:         "forks",
    poolOptions:  { forks: { singleFork: true } },
    reporter:     "verbose",
    // smoke.test.ts exige servidor rodando; drafts/ são rascunhos fora do build.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/drafts/**",
      "**/smoke.test.ts",
    ],
  },
});
