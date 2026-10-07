/**
 * Booking daemon — runs on the `* * * * *` cron trigger.
 *
 * Flow each tick:
 *   1. Query D1 for due scheduled_bookings (status='pending' AND book_at <= now)
 *   2. Mark them 'due' to prevent duplicate processing
 *   3. For each:
 *      a. Scrape for matching slot if cache is stale
 *      b. Load vault cookies for the provider
 *      c. Run executor with idempotency key
 *      d. Update scheduled_bookings row + insert booking_attempts + notify
 *      e. On failure with retries remaining, bump book_at + backoff
 */
import { IdempotencyCache } from "../booking/executor";
import type { ExecutorRegistry } from "../booking/executor";
import type { BookResult } from "../booking/executor";
import type {
  ScheduledBooking,
  ScheduledBookingStatus,
} from "../types";
import { ScheduledBookingSchema } from "../types";
import { runScrape } from "../scrape/runner";
import { TeeTimeCache } from "../cache/tee-time-cache";
import { VaultStorage } from "../vault/storage";

export interface DaemonConfig {
  maxRetries: number;
  retryBackoffMs: number;
  notifyEmail?: string;
}

export interface DaemonDeps {
  db: D1Database;
  cache: TeeTimeCache;
  executors: ExecutorRegistry;
  idempotency: IdempotencyCache;
  vault: VaultStorage;
  masterKey: string;
  sendNotification: (subject: string, body: string) => Promise<void>;
  now?: () => number;
}

export interface TickResult {
  scanned: number;
  due: number;
  booked: number;
  failed: number;
  retried: number;
}

export async function runDaemonTick(
  cfg: DaemonConfig,
  deps: DaemonDeps,
): Promise<TickResult> {
  const now = (deps.now ?? Date.now)();
  const result: TickResult = { scanned: 0, due: 0, booked: 0, failed: 0, retried: 0 };

  // 1. Find due bookings
  const dueRows = await deps.db
    .prepare(
      `SELECT * FROM scheduled_bookings
       WHERE status IN ('pending','due') AND book_at <= ?
       ORDER BY book_at ASC LIMIT 50`,
    )
    .bind(now)
    .all<{
      id: string;
      user_id: string;
      provider: string;
      provider_course_id: string;
      course_id: string;
      date: string;
      time_window_start: string;
      time_window_end: string;
      players: number;
      max_price_cents: number | null;
      book_at: number;
      status: ScheduledBookingStatus;
      attempts: number;
      last_error: string | null;
      confirmation_code: string | null;
      created_at: number;
      updated_at: number;
    }>();

  result.scanned = dueRows.results?.length ?? 0;
  result.due = result.scanned;

  for (const row of dueRows.results ?? []) {
    const sb: ScheduledBooking = ScheduledBookingSchema.parse({
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerCourseId: row.provider_course_id,
      courseId: row.course_id,
      date: row.date,
      timeWindowStart: row.time_window_start,
      timeWindowEnd: row.time_window_end,
      players: row.players,
      maxPriceCents: row.max_price_cents,
      bookAt: row.book_at,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      confirmationCode: row.confirmation_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });

    // 2. Mark 'due' to prevent duplicate processing by next tick
    if (sb.status === "pending") {
      await deps.db
        .prepare(
          `UPDATE scheduled_bookings SET status='due', updated_at=? WHERE id=?`,
        )
        .bind(now, sb.id)
        .run();
    }

    // 3. Try to find a matching slot
    const executor = deps.executors.get(sb.provider);
    if (!executor) {
      await failBooking(deps, sb, now, `no executor for provider '${sb.provider}'`, false);
      result.failed++;
      continue;
    }

    const cookies = await deps.vault.getCookies(sb.provider, deps.masterKey);
    if (!cookies) {
      await failBooking(deps, sb, now, `no cookies for ${sb.provider} — refresh vault`, sb.attempts + 1 < cfg.maxRetries);
      result.failed++;
      continue;
    }

    // Idempotency
    const idemKey = `${sb.id}:${sb.date}`;
    const cached = deps.idempotency.get(idemKey);
    if (cached) {
      await applyResult(deps, sb, now, cached);
      if (cached.status === "booked") result.booked++;
      else result.failed++;
      continue;
    }

    // 4. Scrape to find matching slot
    const cacheRead = await deps.cache.get(
      sb.provider,
      sb.providerCourseId,
      sb.date,
    );
    let candidates = cacheRead.teeTimes;
    if (!cacheRead.hit || cacheRead.stale) {
      // Force a fresh scrape
      const scrape = await runScrape(
        sb.date,
        sb.players,
        "America/Chicago",
        [
          {
            provider: sb.provider,
            providerCourseId: sb.providerCourseId,
            courseId: sb.courseId,
          },
        ],
        { concurrencyPerHost: 1, timeoutMs: 8000 },
      );
      candidates = scrape.teeTimes.filter((t) => t.bookable);
      // Persist fresh results
      if (scrape.teeTimes.length > 0) {
        await deps.cache.set(sb.provider, sb.providerCourseId, sb.date, scrape.teeTimes);
      }
    }

    const slot = pickSlot(candidates, sb);
    if (!slot) {
      await failBooking(
        deps,
        sb,
        now,
        `no slot in window ${sb.timeWindowStart}-${sb.timeWindowEnd}` +
          (sb.maxPriceCents ? ` ≤$${(sb.maxPriceCents / 100).toFixed(2)}` : ""),
        sb.attempts + 1 < cfg.maxRetries,
      );
      if (sb.attempts + 1 < cfg.maxRetries) result.retried++;
      else result.failed++;
      continue;
    }

    // 5. Execute booking
    const bookResult = await executor.book({
      provider: sb.provider,
      providerCourseId: sb.providerCourseId,
      providerSlotId: slot.providerSlotId,
      date: sb.date,
      players: sb.players,
      cookies,
    });

    deps.idempotency.put(idemKey, bookResult);
    await applyResult(deps, sb, now, bookResult);

    if (bookResult.status === "booked") result.booked++;
    else result.failed++;

    // 6. Notify
    if (deps.sendNotification) {
      const subject = bookResult.status === "booked"
        ? `✅ Tee time booked: ${sb.courseId} on ${sb.date}`
        : `❌ Booking failed: ${sb.courseId} on ${sb.date}`;
      const body = bookResult.status === "booked"
        ? `Confirmation: ${bookResult.confirmationCode}\nSlot: ${slot.providerSlotId}`
        : `Error: ${bookResult.errorMessage}`;
      try {
        await deps.sendNotification(subject, body);
      } catch (err) {
        console.error("notification failed", err);
      }
    }
  }

  return result;
}

function pickSlot(
  candidates: Array<{
    timeEpochMs?: number;
    playersAvailable?: number;
    hotDealPriceCents?: number | null;
    rackPriceCents?: number | null;
    providerSlotId?: string;
  }>,
  sb: { timeWindowStart: string; timeWindowEnd: string; players: number; maxPriceCents: number | null },
): { timeEpochMs: number; providerSlotId: string } | null {
  const startMin = hhmmToMinutes(sb.timeWindowStart);
  const endMin = hhmmToMinutes(sb.timeWindowEnd);
  let best: { timeEpochMs: number; providerSlotId: string } | null = null;
  for (const c of candidates) {
    if (!c.timeEpochMs || !c.providerSlotId) continue;
    if ((c.playersAvailable ?? 0) < sb.players) continue;
    const local = new Date(c.timeEpochMs).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Chicago",
    });
    const mins = hhmmToMinutes(local);
    if (mins < startMin || mins > endMin) continue;
    if (sb.maxPriceCents != null) {
      const price = c.hotDealPriceCents ?? c.rackPriceCents;
      if (price != null && price > sb.maxPriceCents) continue;
    }
    if (!best || c.timeEpochMs < best.timeEpochMs) {
      best = { timeEpochMs: c.timeEpochMs, providerSlotId: c.providerSlotId };
    }
  }
  return best;
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

async function failBooking(
  deps: DaemonDeps,
  sb: ScheduledBooking,
  now: number,
  message: string,
  willRetry: boolean,
): Promise<void> {
  const newStatus: ScheduledBookingStatus = willRetry ? "pending" : "failed";
  const newBookAt = willRetry ? now + 60_000 : sb.bookAt; // retry in 1 minute
  await deps.db
    .prepare(
      `UPDATE scheduled_bookings
       SET status=?, attempts=attempts+1, last_error=?, book_at=?, updated_at=?
       WHERE id=?`,
    )
    .bind(newStatus, message, newBookAt, now, sb.id)
    .run();
  await deps.db
    .prepare(
      `INSERT INTO booking_attempts
       (id, scheduled_booking_id, attempted_at, status, confirmation_code, provider_slot_id, error_message)
       VALUES (?, ?, ?, 'failed', NULL, NULL, ?)`,
    )
    .bind(crypto.randomUUID(), sb.id, now, message)
    .run();
}

async function applyResult(
  deps: DaemonDeps,
  sb: ScheduledBooking,
  now: number,
  result: BookResult,
): Promise<void> {
  if (result.status === "booked") {
    await deps.db
      .prepare(
        `UPDATE scheduled_bookings
         SET status='booked', confirmation_code=?, last_error=NULL, updated_at=?
         WHERE id=?`,
      )
      .bind(result.confirmationCode, now, sb.id)
      .run();
    await deps.db
      .prepare(
        `INSERT INTO booking_attempts
         (id, scheduled_booking_id, attempted_at, status, confirmation_code, provider_slot_id, error_message)
         VALUES (?, ?, ?, 'booked', ?, NULL, NULL)`,
      )
      .bind(crypto.randomUUID(), sb.id, now, result.confirmationCode)
      .run();
  } else {
    await failBooking(deps, sb, now, result.errorMessage, sb.attempts + 1 < 3);
  }
}