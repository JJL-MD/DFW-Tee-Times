/**
 * Domain types — Zod schemas + inferred TypeScript types.
 *
 * All times stored as epoch milliseconds UTC. Render in course-local TZ
 * (default America/Chicago for DFW) at the view layer.
 */
import { z } from "zod";

// ---------- providers ----------

export const PROVIDERS = [
  "golfnow",
  "teeoff",
  "chronogolf",
  "foreup",
  "miclub",
  "quick18",
  "lightspeed",
  "clubprophet",
  "ezlinks",
  "course_direct",
] as const;
export type Provider = (typeof PROVIDERS)[number];

// ---------- course ----------

export const CourseSchema = z.object({
  id: z.string().min(1), // canonical id, e.g. "tpc_craig_ranch"
  name: z.string().min(1),
  city: z.string(),
  state: z.string().length(2).default("TX"),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  defaultProvider: z.enum(PROVIDERS),
  bookingWindowDays: z.number().int().min(0).max(365).default(7),
  bookingOpensAtLocal: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "HH:MM")
    .default("06:00"), // course-local time slot window opens
  timezone: z.string().default("America/Chicago"),
});
export type Course = z.infer<typeof CourseSchema>;

// Same course on multiple providers — dedup at lookup time
export const CourseProviderSchema = z.object({
  courseId: z.string(),
  provider: z.enum(PROVIDERS),
  providerCourseId: z.string(),
  baseUrl: z.string().url().optional(),
});
export type CourseProvider = z.infer<typeof CourseProviderSchema>;

// ---------- tee time ----------

export const TeeTimeSchema = z.object({
  // Stable composite id: "{provider}:{providerCourseId}:{epochMs}"
  id: z.string(),
  provider: z.enum(PROVIDERS),
  providerCourseId: z.string(),
  courseId: z.string(), // canonical
  /** epoch ms in UTC; render in course timezone */
  timeEpochMs: z.number().int().positive(),
  /** number of players this slot can accommodate (1–4 typical) */
  playersAvailable: z.number().int().min(1).max(4),
  /** Whether the slot is currently bookable online (provider flag) */
  bookable: z.boolean(),
  /** Price in USD cents. null if provider hides price. */
  hotDealPriceCents: z.number().int().nonnegative().nullable(),
  rackPriceCents: z.number().int().nonnegative().nullable(),
  twilightPriceCents: z.number().int().nonnegative().nullable(),
  /** Provider-internal tee-time id used in deep links and booking calls */
  providerSlotId: z.string(),
  /** When this row was scraped */
  scrapedAt: z.number().int().positive(),
});
export type TeeTime = z.infer<typeof TeeTimeSchema>;

// ---------- scrape result ----------

export const ScrapeErrorSchema = z.object({
  provider: z.enum(PROVIDERS),
  courseId: z.string(),
  date: z.string(), // YYYY-MM-DD
  message: z.string(),
  occurredAt: z.number().int().positive(),
});
export type ScrapeError = z.infer<typeof ScrapeErrorSchema>;

export const ScrapeResultSchema = z.object({
  date: z.string(), // YYYY-MM-DD (course-local)
  teeTimes: z.array(TeeTimeSchema),
  errors: z.array(ScrapeErrorSchema),
  durationMs: z.number().int().nonnegative(),
});
export type ScrapeResult = z.infer<typeof ScrapeResultSchema>;

// ---------- credentials vault ----------

export const VaultKindSchema = z.enum(["cookies", "password"]);
export type VaultKind = z.infer<typeof VaultKindSchema>;

/**
 * Cookie entry shape — what the user pastes from the Chrome extension
 * or what the login-harvester pulls from Playwright.
 */
export const VaultCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string().default("/"),
  expires: z.number().int().nullable().optional(), // epoch seconds or null
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(false),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});
export type VaultCookie = z.infer<typeof VaultCookieSchema>;

export const VaultEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.enum(PROVIDERS),
  kind: VaultKindSchema,
  /** AES-GCM ciphertext (base64), IV (base64), tag (base64) */
  ciphertext: z.string(),
  iv: z.string(),
  /** When the cookies expire (epoch ms) — null means unknown / session-only */
  expiresAt: z.number().int().positive().nullable(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});
export type VaultEntry = z.infer<typeof VaultEntrySchema>;

// ---------- scheduling ----------

export const ScheduledBookingStatusSchema = z.enum([
  "pending", // waiting for book_at
  "due", // due to run, in daemon queue
  "booking", // executor in flight
  "booked", // success
  "failed", // all retries exhausted
  "cancelled", // user cancelled
]);
export type ScheduledBookingStatus = z.infer<typeof ScheduledBookingStatusSchema>;

export const ScheduledBookingSchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.enum(PROVIDERS),
  providerCourseId: z.string(),
  courseId: z.string(),
  /** Date the slot must be on (YYYY-MM-DD in course-local TZ) */
  date: z.string(),
  /** Acceptable time window in HH:MM (course-local) */
  timeWindowStart: z.string().regex(/^\d{2}:\d{2}$/),
  timeWindowEnd: z.string().regex(/^\d{2}:\d{2}$/),
  players: z.number().int().min(1).max(4),
  /** Skip slots priced above this (USD cents). null = no ceiling. */
  maxPriceCents: z.number().int().nonnegative().nullable(),
  /** When to attempt the booking (epoch ms UTC) */
  bookAt: z.number().int().positive(),
  status: ScheduledBookingStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
  /** Filled when status='booked' */
  confirmationCode: z.string().nullable().default(null),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});
export type ScheduledBooking = z.infer<typeof ScheduledBookingSchema>;

// ---------- booking attempt ----------

export const BookingAttemptSchema = z.object({
  id: z.string(),
  scheduledBookingId: z.string(),
  attemptedAt: z.number().int().positive(),
  status: z.enum(["booked", "failed", "expired"]),
  confirmationCode: z.string().nullable(),
  providerSlotId: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type BookingAttempt = z.infer<typeof BookingAttemptSchema>;

// ---------- notification ----------

export const NotificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  scheduledBookingId: z.string().nullable(),
  channel: z.enum(["email", "sms"]),
  sentAt: z.number().int().positive(),
  subject: z.string(),
  body: z.string(),
  status: z.enum(["sent", "failed"]),
  errorMessage: z.string().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

// ---------- helpers ----------

export function makeTeeTimeId(
  provider: Provider,
  providerCourseId: string,
  timeEpochMs: number,
): string {
  return `${provider}:${providerCourseId}:${timeEpochMs}`;
}

export function makeCanonicalCourseId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}