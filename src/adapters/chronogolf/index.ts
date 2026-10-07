/**
 * Chronogolf availability adapter.
 *
 * Endpoint (public search):
 *   GET https://www.chronogolf.com/api/v2/search?course={slug}&date=YYYY-MM-DD&players=N
 *
 * Response shape (simplified):
 *   {
 *     "items": [
 *       {
 *         "id": "slot-uuid",
 *         "courseId": "course-slug",
 *         "startsAt": "2026-07-20T13:00:00Z",
 *         "playersAvailable": 4,
 *         "priceCents": 4500,
 *         "currency": "USD",
 *         "bookable": true,
 *         "subCourse": "Highland"
 *       }
 *     ]
 *   }
 */
import { HttpAdapter } from "../base";
import type { Fetcher } from "../fetcher";
import type { FetcherRequest, FetcherResponse } from "../fetcher";
import type { ScrapeContext } from "../types";
import { TeeTimeSchema, makeTeeTimeId } from "../../types";
import type { TeeTime } from "../../types";

const BASE_URL = "https://www.chronogolf.com";

interface ChronogolfSlot {
  id: string;
  courseId?: string;
  startsAt?: string;
  startsAtEpochMs?: number;
  playersAvailable?: number;
  priceCents?: number;
  currency?: string;
  bookable?: boolean;
  subCourse?: string;
}

export class ChronogolfAdapter extends HttpAdapter {
  constructor(fetcher: Fetcher) {
    super({
      id: "chronogolf",
      name: "Chronogolf",
      fetcher,
      defaultHeaders: {
        Referer: "https://www.chronogolf.com/",
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
    const params = new URLSearchParams({
      course: providerCourseId,
      date: ctx.date,
      players: String(ctx.players),
    });
    return {
      url: `${BASE_URL}/api/v2/search?${params.toString()}`,
      method: "GET",
      timeoutMs: 5000,
    };
  }

  parseResponse(
    providerCourseId: string,
    _ctx: ScrapeContext,
    response: FetcherResponse,
  ): TeeTime[] {
    const data = JSON.parse(response.body) as { items?: ChronogolfSlot[] };
    const slots = data.items ?? [];
    const teeTimes: TeeTime[] = [];

    for (const slot of slots) {
      const bookable = slot.bookable ?? true;
      if (!bookable) continue;

      let epochMs: number | null = null;
      if (typeof slot.startsAtEpochMs === "number") {
        epochMs = slot.startsAtEpochMs;
      } else if (slot.startsAt) {
        const parsed = Date.parse(slot.startsAt);
        if (!Number.isNaN(parsed)) epochMs = parsed;
      }
      if (epochMs == null) continue;

      teeTimes.push(
        TeeTimeSchema.parse({
          id: makeTeeTimeId(this.id, providerCourseId, epochMs),
          provider: this.id,
          providerCourseId,
          courseId: providerCourseId,
          timeEpochMs: epochMs,
          playersAvailable: slot.playersAvailable ?? 4,
          bookable,
          hotDealPriceCents: slot.priceCents ?? null,
          rackPriceCents: slot.priceCents ?? null,
          twilightPriceCents: null,
          providerSlotId: slot.id,
          scrapedAt: Date.now(),
        }),
      );
    }
    return teeTimes;
  }
}