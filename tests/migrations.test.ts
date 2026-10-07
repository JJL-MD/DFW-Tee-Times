import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Apply the D1 migration to an in-memory SQLite and assert the schema.
 * Cloudflare D1 is SQLite-compatible; this catches most schema bugs
 * before we ever run wrangler.
 */
describe("0001_init.sql", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const sql = readFileSync(
      join(process.cwd(), "migrations", "0001_init.sql"),
      "utf8",
    );
    db.exec(sql);
  });

  it("creates all expected tables", () => {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "courses",
        "course_providers",
        "course_aliases",
        "vault_entries",
        "scheduled_bookings",
        "booking_attempts",
        "scrape_errors",
        "notifications",
      ]),
    );
  });

  it("courses table has expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(courses)").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "city",
        "state",
        "lat",
        "lon",
        "default_provider",
        "booking_window_days",
        "booking_opens_at_local",
        "timezone",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("scheduled_bookings status check constraint enforces values", () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO scheduled_bookings
       (id, provider, provider_course_id, course_id, date,
        time_window_start, time_window_end, players, book_at,
        status, attempts, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "sb_x",
      "golfnow",
      "1",
      "c",
      "2026-07-20",
      "07:00",
      "09:00",
      2,
      now,
      "pending",
      0,
      now,
      now,
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO scheduled_bookings
           (id, provider, provider_course_id, course_id, date,
            time_window_start, time_window_end, players, book_at,
            status, attempts, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          "sb_y",
          "golfnow",
          "1",
          "c",
          "2026-07-20",
          "07:00",
          "09:00",
          2,
          now,
          "garbage",
          0,
          now,
          now,
        ),
    ).toThrow();
  });

  it("vault unique (user_id, provider) enforced", () => {
    const now = Date.now();
    const insert = db.prepare(
      `INSERT INTO vault_entries
       (id, user_id, provider, kind, ciphertext, iv, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    insert.run("v1", "u1", "golfnow", "cookies", "ct", "iv", now, now);
    expect(() =>
      insert.run("v2", "u1", "golfnow", "cookies", "ct", "iv", now, now),
    ).toThrow();
    // different provider same user OK
    expect(() =>
      insert.run("v3", "u1", "teeoff", "cookies", "ct", "iv", now, now),
    ).not.toThrow();
  });
});