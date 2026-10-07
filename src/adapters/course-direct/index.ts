/**
 * Per-system adapter framework.
 *
 * For courses that use course-direct booking systems (MiClub, Quick18,
 * Lightspeed, Club Prophet, EZLinks), we model the system as a thin
 * adapter template that takes:
 *   - search URL template (with `{courseId}`, `{date}` placeholders)
 *   - response parser (system-specific JSON → TeeTime[])
 *   - optional sub-course filter (for multi-course venues)
 *
 * Per-system adapters live in adapters/{system}/index.ts.
 */
import { HttpAdapter } from "../base";
import type { Fetcher } from "../fetcher";
import type { FetcherRequest, FetcherResponse } from "../fetcher";
import type { ScrapeContext } from "../types";
import { TeeTimeSchema, makeTeeTimeId } from "../../types";
import type { Provider, TeeTime } from "../../types";

export interface SystemAdapterConfig {
  id: Provider;
  name: string;
  fetcher: Fetcher;
  /** URL template with {courseId} and {date} placeholders */
  searchUrlTemplate: string;
  /** Parse system JSON → TeeTime[] */
  parseSlots: (data: unknown, providerCourseId: string) => TeeTime[];
  /** Optional sub-course filter — keep only slots whose subCourse matches */
  preferredSubCourse?: string;
  /** Extra request headers */
  headers?: Record<string, string>;
}

/**
 * Generic course-direct system adapter.
 * Most per-system adapters reduce to: fetch this URL, run this parser.
 */
export class SystemAdapter extends HttpAdapter {
  private readonly searchUrlTemplate: string;
  private readonly parseSlots: SystemAdapterConfig["parseSlots"];
  private readonly preferredSubCourse?: string;

  constructor(config: SystemAdapterConfig) {
    super({
      id: config.id,
      name: config.name,
      fetcher: config.fetcher,
      defaultHeaders: config.headers ?? {},
    });
    this.searchUrlTemplate = config.searchUrlTemplate;
    this.parseSlots = config.parseSlots;
    if (config.preferredSubCourse) {
      this.preferredSubCourse = config.preferredSubCourse;
    }
  }

  buildRequest(
    providerCourseId: string,
    ctx: ScrapeContext,
    subCourse?: string,
  ): FetcherRequest {
    const url = this.searchUrlTemplate
      .replace("{courseId}", encodeURIComponent(providerCourseId))
      .replace("{date}", encodeURIComponent(ctx.date))
      .replace("{players}", String(ctx.players));
    const req: FetcherRequest = {
      url,
      method: "GET",
      timeoutMs: 5000,
    };
    return req;
  }

  parseResponse(
    providerCourseId: string,
    _ctx: ScrapeContext,
    response: FetcherResponse,
    subCourse?: string,
  ): TeeTime[] {
    const data = JSON.parse(response.body) as unknown;
    let slots = this.parseSlots(data, providerCourseId);
    const targetSub = subCourse ?? this.preferredSubCourse;
    if (targetSub) {
      slots = slots.filter((t) => {
        const sub = (t as TeeTime & { subCourse?: string }).subCourse;
        return !sub || sub === targetSub;
      });
    }
    // Stamp ids to be stable and include the sub-course when present.
    for (const t of slots) {
      const sub = (t as TeeTime & { subCourse?: string }).subCourse;
      // Validation may strip unknown fields; re-parse defensively.
      const validated = TeeTimeSchema.parse({
        ...t,
        id: makeTeeTimeId(this.id, providerCourseId, t.timeEpochMs),
        provider: this.id,
        providerCourseId,
        courseId: providerCourseId,
        scrapedAt: Date.now(),
      });
      Object.assign(t, validated);
      if (sub) (t as TeeTime & { subCourse?: string }).subCourse = sub;
    }
    return slots;
  }
}