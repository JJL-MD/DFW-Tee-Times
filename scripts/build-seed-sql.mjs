#!/usr/bin/env node
/**
 * Seed script — generates INSERT SQL for the DFW catalog.
 *
 * Usage:
 *   node scripts/build-seed-sql.mjs > scripts/seed.sql
 *   npx wrangler d1 execute DB --local --file=./scripts/seed.sql
 *   npx wrangler d1 execute DB --remote --file=./scripts/seed.sql
 *
 * The output uses INSERT OR REPLACE so it's idempotent.
 */
import { buildSeedRows } from "../src/seed/dfw-courses.ts";

const now = Date.now();
const { courses, courseProviders } = buildSeedRows(now);

const lines = [];
lines.push("-- Auto-generated seed. DO NOT EDIT BY HAND.");
lines.push("-- Regenerate with: node scripts/build-seed-sql.mjs > scripts/seed.sql");
lines.push("BEGIN TRANSACTION;");
lines.push("");

for (const c of courses) {
  lines.push(
    `INSERT OR REPLACE INTO courses ` +
      `(id, name, city, state, lat, lon, default_provider, booking_window_days, booking_opens_at_local, timezone, created_at, updated_at) ` +
      `VALUES (` +
      [
        sql(c.id),
        sql(c.name),
        sql(c.city),
        sql(c.state),
        c.lat,
        c.lon,
        sql(c.default_provider),
        c.booking_window_days,
        sql(c.booking_opens_at_local),
        sql(c.timezone),
        c.created_at,
        c.updated_at,
      ].join(", ") +
      `);`,
  );
}

for (const cp of courseProviders) {
  lines.push(
    `INSERT OR REPLACE INTO course_providers ` +
      `(course_id, provider, provider_course_id, created_at) ` +
      `VALUES (${sql(cp.courseId)}, ${sql(cp.provider)}, ${sql(cp.providerCourseId)}, ${now});`,
  );
}

lines.push("");
lines.push("COMMIT;");

console.log(lines.join("\n"));

function sql(v) {
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}