/**
 * GolfNow availability adapter.
 *
 * Endpoint pattern (subject to change — verify against live capture):
 *   GET https://www.golfnow.com/api/tee-times/tee-times?courseId={id}&date=YYYY-MM-DD&players=N&holes=18
 * Returns JSON envelope:
 *   {
 *     "teeTimes": [
 *       {
 *         "id": "slot-id",
 *         "courseId": 12345,
 *         "teeTimeEpochMs": 1700000000000,   // epoch ms UTC
 *         "playersAvailable": 4,
 *         "minPlayers": 1,
 *         "maxPlayers": 4,
 *         "isAvailable": true,
 *         "isBookableOnline": true,
 *         "rates": [
 *           { "type": "HotDeal", "greenFee": 4500 },        // cents
 *           { "type": "Regular", "greenFee": 12000 }
 *         ],
 *         "holes": 18,
 *         "subCourseName": "Highland"
 *       }
 *     ],
 *     "facility": { "id": ..., "name": "...", "timezone": "America/Chicago" }
 *   }
 *
 * If the real shape differs, the parser is the only thing to update —
 * the fetcher + base adapter plumbing stay the same.
 */
import { HttpAdapter, parsePriceCents } from "../base";
import type { Fetcher } from "../fetcher";
import type { FetcherRequest, FetcherResponse } from "../fetcher";
import type { ScrapeContext } from "../types";
import { TeeTimeSchema, makeTeeTimeId } from "../../types";
import type { TeeTime } from "../../types";

const BASE_URL = "https://www.golfnow.com";

interface GolfNowRate {
  type?: string;
  greenFee?: number;
  rateName?: string;
}

interface GolfNowSlot {
  id: string | number;
  courseId?: number | string;
  teeTimeEpochMs?: number;
  /** Some responses use ISO string instead of epoch */
  teeTime?: string;
  playersAvailable?: number;
  minPlayers?: number;
  maxPlayers?: number;
  isAvailable?: boolean;
  isBookableOnline?: boolean;
  rates?: GolfNowRate[];
  holes?: number;
  subCourseName?: string;
}

interface GolfNowResponse {
  teeTimes?: GolfNowSlot[];
  /** Older endpoints may return top-level array */
  results?: GolfNowSlot[];
}

export class GolfNowAdapter extends HttpAdapter {
  constructor(fetcher: Fetcher) {
    super({
      id: "golfnow",
      name: "GolfNow",
      fetcher,
      defaultHeaders: {
        Referer: "https://www.golfnow.com/",
        "X-Requested-With": "XMLHttpRequest",
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
      courseId: providerCourseId,
      date: ctx.date,
      players: String(ctx.players),
      holes: "18",
    });
    return {
      url: `${BASE_URL}/api/tee-times/tee-times?${params.toString()}`,
      method: "GET",
      timeoutMs: 5000,
    };
  }

  parseResponse(
    providerCourseId: string,
    _ctx: ScrapeContext,
    response: FetcherResponse,
  ): TeeTime[] {
    let data: GolfNowResponse;
    try {
      data = JSON.parse(response.body) as GolfNowResponse;
    } catch {
      throw new Error(`golfnow: invalid JSON for course ${providerCourseId}`);
    }

    const slots = data.teeTimes ?? data.results ?? [];
    const teeTimes: TeeTime[] = [];

    for (const slot of slots) {
      if (!slot.isBookableOnline) continue;

      // Resolve the time. Prefer epoch ms; fall back to parsing ISO.
      let epochMs: number | null = null;
      if (typeof slot.teeTimeEpochMs === "number" && slot.teeTimeEpochMs > 0) {
        epochMs = slot.teeTimeEpochMs;
      } else if (slot.teeTime) {
        const parsed = Date.parse(slot.teeTime);
        if (!Number.isNaN(parsed)) epochMs = parsed;
      }
      if (epochMs == null) continue;

      // Pick rates. Hot-deal first, fall back to regular.
      let hotDeal: number | null = null;
      let rack: number | null = null;
      let twilight: number | null = null;
      for (const rate of slot.rates ?? []) {
        const cents = parsePriceCents(rate.greenFee);
        if (cents == null) continue;
        const type = (rate.type ?? rate.rateName ?? "").toLowerCase();
        if (type.includes("hotdeal") || type.includes("hot deal")) {
          hotDeal = cents;
        } else if (type.includes("twilight")) {
          twilight = cents;
        } else {
          rack = cents;
        }
      }

      const slotId = String(slot.id);
      teeTimes.push(
        TeeTimeSchema.parse({
          id: makeTeeTimeId(this.id, providerCourseId, epochMs),
          provider: this.id,
          providerCourseId,
          // courseId is canonical and stamped by the runner, not by the adapter
          courseId: providerCourseId,
          timeEpochMs: epochMs,
          playersAvailable: slot.playersAvailable ?? slot.maxPlayers ?? 4,
          bookable: slot.isBookableOnline ?? slot.isAvailable ?? false,
          hotDealPriceCents: hotDeal,
          rackPriceCents: rack,
          twilightPriceCents: twilight,
          providerSlotId: slotId,
          scrapedAt: Date.now(), // runner overwrites
        }),
      );
    }

    return teeTimes;
  }
}