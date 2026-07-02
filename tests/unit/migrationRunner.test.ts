import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock Oracle dependency so migration runner can be tested without a real DB
vi.mock("../../src/server/db/oracle", () => ({
  isOracleEnabled: () => false,
  executeOracle: vi.fn(),
}));
vi.mock("../../src/server/db/db", () => ({
  execDml: vi.fn(),
  queryOne: vi.fn().mockResolvedValue({ cnt: 1 }),
  queryRows: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runMigrations } from "../../src/server/db/migrationRunner";
import type { Migration } from "../../src/server/db/migrationRunner";

describe("runMigrations", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("skips all migrations when Oracle is disabled", async () => {
    const up = vi.fn();
    const migrations: Migration[] = [
      { id: "001_test", description: "test", up },
    ];
    await runMigrations(migrations);
    expect(up).not.toHaveBeenCalled();
  });

  it("accepts empty migration list without error", async () => {
    await expect(runMigrations([])).resolves.toBeUndefined();
  });
});
