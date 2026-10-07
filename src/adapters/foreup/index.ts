/**
 * ForeUp availability adapter.
 *
 * ForeUp powers many municipal DFW courses (Stevens Park, Cedar Crest,
 * Tenison Park, Firewheel, Sherrill Park). Their search API:
 *
 *   POST https://foreupsoftware.com/index.php/api/booking/times
 *     Body (form-encoded):
 *       time=1710&  (HHMM in course-local TZ, or 'all')
 *       date=07/20/2026&  (MM/DD/YYYY)
 *       course_id=12345
 *       holes=18
 *       players=2
 *       specials_only=0
 *       mobile=0
 *       booking_class=0
 *
 * Response: HTML or JSON depending on `mobile` flag. With `mobile=1`,
 * the response is JSON:
 *   [{ "id": 123, "time": "07:00", "available_spots": 4, "green_fee": 45, ... }, ...]
 */
import { HttpAdapter, parsePriceCents } from "../base";
import type { Fetcher } from "../fetcher";
import type { FetcherRequest, FetcherResponse } from "../fetcher";
import type { ScrapeContext } from "../types";
import { TeeTimeSchema, makeTeeTimeId } from "../../types";
import type { TeeTime } from "../../types";

const BASE_URL = "https://foreupsoftware.com";

interface ForeUpSlot {
  id: number | string;
  time?: string;
  /** "07:00 AM" or "7:00 AM" */
  tee_time?: string;
  available_spots?: number;
  green_fee?: number;
  cart_fee?: number;
  total?: number;
  holes?: number;
  course_id?: number | string;
  schedule_id?: number | string;
  booking_class_id?: number | string;
}

export class ForeUpAdapter extends HttpAdapter {
  constructor(fetcher: Fetcher) {
    super({
      id: "foreup",
      name: "ForeUp",
      fetcher,
      defaultHeaders: {
        Referer: "https://foreupsoftware.com/",
      },
    });
  }

  protected override healthcheckUrl(): string {
    return `${BASE_URL}/`;
  }

  buildRequest(
    providerCourseId: string,
    ctx: ScrapeContext,
  ): FetcherRequest {
    // date format MM/DD/YYYY (US)
    const [yyyy, mm, dd] = ctx.date.split("-");
    const usDate = `${mm}/${dd}/${yyyy}`;
    const body = new URLSearchParams({
      time: "all",
      date: usDate,
      course_id: providerCourseId,
      holes: "18",
      players: String(ctx.players),
      specials_only: "0",
      mobile: "1",
      booking_class: "0",
    });
    return {
      url: `${BASE_URL}/index.php/api/booking/times`,
      method: "POST",
      body,
      timeoutMs: 5000,
    };
  }

  parseResponse(
    providerCourseId: string,
    ctx: ScrapeContext,
    response: FetcherResponse,
  ): TeeTime[] {
    let slots: ForeUpSlot[];
    try {
      slots = JSON.parse(response.body) as ForeUpSlot[];
    } catch {
      // HTML response — can't parse without Playwright fallback
      throw new Error(
        `foreup: non-JSON response for course ${providerCourseId} — ` +
          `fallback to Playwright may be required`,
      );
    }

    const teeTimes: TeeTime[] = [];

    for (const slot of slots) {
      const spots = slot.available_spots ?? 0;
      if (spots <= 0) continue;

      const timeStr = slot.time ?? slot.tee_time;
      if (!timeStr) continue;

      // timeStr is like "07:00" or "7:00 AM". Build course-local Date.
      const epochMs = parseCourseLocalTime(ctx.date, timeStr, ctx.timezone);
      if (epochMs == null) continue;

      // ForeUp returns DOLLARS (whole or fractional). Convert to cents.
      const greenFee = parsePriceCents(slot.green_fee, { asDollars: true });
      const total = parsePriceCents(slot.total, { asDollars: true });
      // ForeUp's "total" is green + cart. green_fee is walking/standard rate.
      teeTimes.push(
        TeeTimeSchema.parse({
          id: makeTeeTimeId(this.id, providerCourseId, epochMs),
          provider: this.id,
          providerCourseId,
          courseId: providerCourseId,
          timeEpochMs: epochMs,
          playersAvailable: spots,
          bookable: true,
          hotDealPriceCents: total ?? greenFee,
          rackPriceCents: greenFee,
          twilightPriceCents: null,
          providerSlotId: String(slot.id),
          scrapedAt: Date.now(),
        }),
      );
    }
    return teeTimes;
  }
}

/**
 * Parse a course-local time string into epoch ms UTC.
 * Accepts "HH:MM", "H:MM", "HH:MM AM/PM".
 */
function parseCourseLocalTime(
  dateISO: string,
  timeStr: string,
  timezone: string,
): number | null {
  const cleaned = timeStr.trim().toUpperCase();
  let hours = 0;
  let minutes = 0;

  const ampmMatch = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (ampmMatch) {
    hours = parseInt(ampmMatch[1] ?? "0", 10);
    minutes = parseInt(ampmMatch[2] ?? "0", 10);
    const ampm = ampmMatch[3];
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
  } else {
    const match = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    hours = parseInt(match[1] ?? "0", 10);
    minutes = parseInt(match[2] ?? "0", 10);
  }

  // Build an ISO string with the offset for `timezone` at `dateISO`.
  // We avoid full TZ libs and rely on Intl to compute the offset.
  const [yyyy, mm, dd] = dateISO.split("-").map(Number);
  if (!yyyy || !mm || !dd) return null;

  // Construct a naive ISO, then find the offset for that timezone
  // at that wall-clock moment, then adjust.
  const naiveUtc = Date.UTC(yyyy, mm - 1, dd, hours, minutes, 0);
  // Get offset minutes for timezone at that wall-clock moment.
  const offsetMin = getTimezoneOffsetMinutes(timezone, naiveUtc);
  return naiveUtc - offsetMin * 60_000;
}

function getTimezoneOffsetMinutes(tz: string, utcMs: number): number {
  // Compare wall-clock in tz vs UTC. Positive offset = tz is ahead of UTC.
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