/**
 * GolfNow booking executor.
 *
 * GolfNow's booking endpoint (subject to verification via live capture):
 *   POST https://www.golfnow.com/api/tee-times/book
 *     Body: { teeTimeId: string, courseId: string, players: number, holes: 18 }
 *     Cookies: session auth
 *
 * Returns 200 with { confirmationNumber: "ABC123" } on success.
 *
 * For real bookings, the session cookie must be valid. We surface
 * auth errors as 'expired' so the daemon re-prompts the user.
 */
import type { BookRequest, BookResult, BookingExecutor } from "./executor";
import type { Fetcher } from "../adapters/fetcher";

const BOOK_URL = "https://www.golfnow.com/api/tee-times/book";

export class GolfNowBooker implements BookingExecutor {
  readonly id = "golfnow" as const;
  private fetcher: Fetcher;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  async book(req: BookRequest): Promise<BookResult> {
    const cookieHeader = req.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    try {
      const res = await this.fetcher({
        url: BOOK_URL,
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
          Referer: "https://www.golfnow.com/",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          teeTimeId: req.providerSlotId,
          courseId: req.providerCourseId,
          players: req.players,
          holes: 18,
          date: req.date,
        }),
        timeoutMs: 10_000,
      });

      // Auth expired
      if (res.status === 401 || res.status === 403) {
        return {
          status: "expired",
          errorMessage: `golfnow auth ${res.status} — re-harvest cookies`,
        };
      }

      // Parse response
      let data: { confirmationNumber?: string; error?: string; message?: string };
      try {
        data = JSON.parse(res.body) as typeof data;
      } catch {
        return {
          status: "failed",
          errorMessage: `golfnow: invalid JSON (HTTP ${res.status})`,
        };
      }

      if (data.confirmationNumber) {
        return {
          status: "booked",
          confirmationCode: data.confirmationNumber,
        };
      }

      // Already booked / sold out / date passed
      const msg = data.error ?? data.message ?? `HTTP ${res.status}`;
      const lowered = msg.toLowerCase();
      if (lowered.includes("sold out") || lowered.includes("no longer available")) {
        return { status: "expired", errorMessage: msg };
      }
      return { status: "failed", errorMessage: msg };
    } catch (err) {
      return {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}