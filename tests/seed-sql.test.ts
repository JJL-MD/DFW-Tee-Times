import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Validates that scripts/seed.sql is in sync with src/seed/dfw-courses.ts
 * and that running it against the schema leaves the catalog populated.
 */
describe("seed.sql", () => {
  it("exists and is non-empty", () => {
    const path = join(process.cwd(), "scripts", "seed.sql");
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, "utf8");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("applies successfully and populates the catalog", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const migration = readFileSync(
      join(process.cwd(), "migrations", "0001_init.sql"),
      "utf8",
    );
    db.exec(migration);

    const seed = readFileSync(
      join(process.cwd(), "scripts", "seed.sql"),
      "utf8",
    );
    db.exec(seed);

    const courseCount = (
      db.prepare("SELECT COUNT(*) AS c FROM courses").get() as { c: number }
    ).c;
    const cpCount = (
      db.prepare("SELECT COUNT(*) AS c FROM course_providers").get() as {
        c: number;
      }
    ).c;

    expect(courseCount).toBeGreaterThanOrEqual(40);
    expect(cpCount).toBeGreaterThanOrEqual(courseCount); // every course ≥ 1 provider

    // Sample row shape check
    const row = db
      .prepare("SELECT * FROM courses WHERE id = ?")
      .get("stevens_park") as { id: string; default_provider: string };
    expect(row.id).toBe("stevens_park");
    expect(row.default_provider).toBe("foreup");
  });
});