/**
 * Slot-opens predictor — given the current time and a course's booking
 * window config, compute when the booking window next opens.
 *
 * Most DFW courses open their booking window 7 days ahead at 6:00am
 * local time (GolfNow default). Premium courses open 30 days ahead.
 */
import type { Course } from "../types";

export interface PredictorConfig {
  /** Days ahead the booking window opens (e.g. 7 = "one week out") */
  windowDays: number;
  /** Local time the window opens, "HH:MM" */
  opensAtLocal: string;
  /** IANA timezone, e.g. "America/Chicago" */
  timezone: string;
}

/**
 * Return the next datetime (epoch ms) when the booking window opens
 * for the requested tee-time date.
 *
 * If today (in course TZ) is 2026-07-13 and the window is 7 days ahead
 * opening at 06:00 local, the next opening for 2026-07-20 tee times is
 * 2026-07-13 06:00 CT = 2026-07-13 11:00 UTC (CDT).
 */
export function predictNextOpen(
  targetDateISO: string, // YYYY-MM-DD in course TZ
  cfg: PredictorConfig,
  now: Date = new Date(),
): Date {
  // Compute target date as UTC midnight for math.
  const [ty, tm, td] = targetDateISO.split("-").map(Number);
  if (!ty || !tm || !td) throw new Error(`bad targetDateISO: ${targetDateISO}`);

  // Compute open-date = targetDate - windowDays, at opensAtLocal.
  const target = new Date(Date.UTC(ty, tm - 1, td));
  target.setUTCDate(target.getUTCDate() - cfg.windowDays);
  const openDateISO = target.toISOString().slice(0, 10);

  // Build wall-clock at opensAtLocal on openDateISO in cfg.timezone.
  const [hh, mm] = cfg.opensAtLocal.split(":").map(Number);
  if (hh === undefined || mm === undefined) {
    throw new Error(`bad opensAtLocal: ${cfg.opensAtLocal}`);
  }

  // Compute TZ offset at that wall-clock instant.
  const naiveUtc = Date.UTC(ty, tm - 1, td, hh, mm, 0);
  // Iteratively find offset (handles DST boundaries).
  const offsetMin = tzOffsetMinutes(cfg.timezone, naiveUtc);
  const opensUtcMs = naiveUtc - offsetMin * 60_000;

  const opens = new Date(opensUtcMs);
  if (opens > now) return opens;

  // Already opened — return now so scheduler proceeds immediately.
  return now;
}

function tzOffsetMinutes(tz: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * Default predictor config from a Course record.
 */
export function configFromCourse(course: Course): PredictorConfig {
  return {
    windowDays: course.bookingWindowDays,
    opensAtLocal: course.bookingOpensAtLocal,
    timezone: course.timezone,
  };
}