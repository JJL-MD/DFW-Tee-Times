/**
 * Booking executor — per-provider booking flow.
 *
 * Each provider has a different booking path:
 *   - GolfNow: POST /api/tee-times/book with cookies
 *   - TeeOff:  same shape, separate session
 *   - ForeUp:  POST to /index.php/api/booking/book with booking_class_id
 *   - Chronogolf: POST /api/v2/book
 *   - Playwright fallback: POST to fallback host /book
 *
 * The executor interface is identical across all providers — the runner
 * and daemon don't care which is used.
 */
import type { Provider, VaultCookie } from "../types";

export interface BookRequest {
  provider: Provider;
  providerCourseId: string;
  providerSlotId: string;
  date: string; // YYYY-MM-DD
  players: number;
  cookies: VaultCookie[];
}

export type BookResult =
  | { status: "booked"; confirmationCode: string; rawResponse?: unknown }
  | { status: "failed"; errorMessage: string; rawResponse?: unknown }
  | { status: "expired"; errorMessage: string };

export interface BookingExecutor {
  readonly id: Provider;
  book(req: BookRequest): Promise<BookResult>;
}

/**
 * Map provider → its executor. The Worker keeps this registry.
 * Tests pass in their own executors to keep deterministic.
 */
export class ExecutorRegistry {
  private byProvider = new Map<Provider, BookingExecutor>();

  register(exec: BookingExecutor): void {
    this.byProvider.set(exec.id, exec);
  }

  get(provider: Provider): BookingExecutor | undefined {
    return this.byProvider.get(provider);
  }

  list(): BookingExecutor[] {
    return Array.from(this.byProvider.values());
  }
}

/**
 * Stub executor for tests — programmable outcomes.
 */
export class StubExecutor implements BookingExecutor {
  readonly id: Provider;
  private outcomes: Map<string, BookResult> = new Map();

  constructor(id: Provider) {
    this.id = id;
  }

  setOutcome(slotId: string, outcome: BookResult): void {
    this.outcomes.set(slotId, outcome);
  }

  async book(req: BookRequest): Promise<BookResult> {
    return (
      this.outcomes.get(req.providerSlotId) ?? {
        status: "failed",
        errorMessage: "no outcome programmed for this slot",
      }
    );
  }
}

/**
 * Idempotency helper — for any executor. Some providers return 200 on
 * duplicate booking; check the response shape and avoid double-charging.
 *
 * Caller-provided dedupe key (typically the scheduled_bookings row id).
 */
export interface IdempotencyKey {
  key: string;
  firstSeenAt: number;
}

export const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

export class IdempotencyCache {
  private map = new Map<string, BookResult & { storedAt: number }>();

  get(key: string): BookResult | null {
    const v = this.map.get(key);
    if (!v) return null;
    if (Date.now() - v.storedAt > IDEMPOTENCY_TTL_MS) {
      this.map.delete(key);
      return null;
    }
    return { status: v.status, ...(v as object) } as BookResult;
  }

  put(key: string, result: BookResult): void {
    this.map.set(key, { ...result, storedAt: Date.now() } as BookResult & {
      storedAt: number;
    });
  }
}