import { describe, expect, it } from "vitest";
import { backupsToPrune, normalizedBackupRetention } from "./backupRules.js";

describe("backup retention", () => {
  it("defaults to 14 and clamps unsafe values", () => {
    expect(normalizedBackupRetention(undefined)).toBe(14);
    expect(normalizedBackupRetention("1")).toBe(3);
    expect(normalizedBackupRetention("30")).toBe(30);
    expect(normalizedBackupRetention("1000")).toBe(90);
    expect(normalizedBackupRetention("not-a-number")).toBe(14);
  });

  it("keeps the newest backups regardless of input order", () => {
    const backups = [
      { name: "old.json", createdAt: "2026-07-01T00:00:00.000Z" },
      { name: "new.json", createdAt: "2026-07-04T00:00:00.000Z" },
      { name: "middle.json", createdAt: "2026-07-03T00:00:00.000Z" },
      { name: "older.json", createdAt: "2026-07-02T00:00:00.000Z" },
    ];

    expect(backupsToPrune(backups, 3).map((backup) => backup.name)).toEqual(["old.json"]);
  });
});
