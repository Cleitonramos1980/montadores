import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout:  30000,
    hookTimeout:  15000,
    pool:         "forks",
    poolOptions:  { forks: { singleFork: true } },
    reporter:     "verbose",
  },
});
