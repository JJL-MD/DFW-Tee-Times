/**
 * TeeOff availability adapter.
 *
 * TeeOff is owned by NBC Sports Next (same parent as GolfNow) and shares
 * much of the backend. The public search endpoint is:
 *   GET https://www.teeoff.com/api/search/tee-times?facilityId={id}&date=YYYY-MM-DD&players=N
 *
 * Response shape mirrors GolfNow with minor field naming differences:
 *   - `facilityId` instead of `courseId`
 *   - `teeOffSlotId` instead of `id`
 *   - `startTime` ISO string (we convert to epoch)
 */
import { HttpAdapter, parsePriceCents } from "../base";
import type { Fetcher } from "../fetcher";
import type { FetcherRequest, FetcherResponse } from "../fetcher";
import type { ScrapeContext } from "../types";
import { TeeTimeSchema, makeTeeTimeId } from "../../types";
import type { TeeTime } from "../../types";

const BASE_URL = "https://www.teeoff.com";

interface TeeOffRate {
  type?: string;
  amount?: number;
}

interface TeeOffSlot {
  id?: string | number;
  teeOffSlotId?: string | number;
  facilityId?: number | string;
  startTime?: string;
  teeTimeEpochMs?: number;
  maxPlayers?: number;
  playersAvailable?: number;
  bookable?: boolean;
  isAvailable?: boolean;
  rates?: TeeOffRate[];
  courseName?: string;
  subCourseName?: string;
}

export class TeeOffAdapter extends HttpAdapter {
  constructor(fetcher: Fetcher) {
    super({
      id: "teeoff",
      name: "TeeOff",
      fetcher,
      defaultHeaders: {
        Referer: "https://www.teeoff.com/",
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
      facilityId: providerCourseId,
      date: ctx.date,
      players: String(ctx.players),
    });
    return {
      url: `${BASE_URL}/api/search/tee-times?${params.toString()}`,
      method: "GET",
      timeoutMs: 5000,
    };
  }

  parseResponse(
    providerCourseId: string,
    _ctx: ScrapeContext,
    response: FetcherResponse,
  ): TeeTime[] {
    const data = JSON.parse(response.body) as {
      results?: TeeOffSlot[];
      slots?: TeeOffSlot[];
    };
    const slots = data.results ?? data.slots ?? [];
    const teeTimes: TeeTime[] = [];

    for (const slot of slots) {
      const bookable = slot.bookable ?? slot.isAvailable ?? false;
      if (!bookable) continue;

      let epochMs: number | null = null;
      if (typeof slot.teeTimeEpochMs === "number") {
        epochMs = slot.teeTimeEpochMs;
      } else if (slot.startTime) {
        const parsed = Date.parse(slot.startTime);
        if (!Number.isNaN(parsed)) epochMs = parsed;
      }
      if (epochMs == null) continue;

      let hotDeal: number | null = null;
      let rack: number | null = null;
      let twilight: number | null = null;
      for (const rate of slot.rates ?? []) {
        const cents = parsePriceCents(rate.amount);
        if (cents == null) continue;
        const type = (rate.type ?? "").toLowerCase();
        if (type.includes("hot")) hotDeal = cents;
        else if (type.includes("twilight")) twilight = cents;
        else rack = cents;
      }

      const slotId = String(slot.teeOffSlotId ?? slot.id ?? "");
      teeTimes.push(
        TeeTimeSchema.parse({
          id: makeTeeTimeId(this.id, providerCourseId, epochMs),
          provider: this.id,
          providerCourseId,
          courseId: providerCourseId,
          timeEpochMs: epochMs,
          playersAvailable: slot.playersAvailable ?? slot.maxPlayers ?? 4,
          bookable,
          hotDealPriceCents: hotDeal,
          rackPriceCents: rack,
          twilightPriceCents: twilight,
          providerSlotId: slotId,
          scrapedAt: Date.now(),
        }),
      );
    }
    return teeTimes;
  }
}