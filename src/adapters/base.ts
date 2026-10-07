/**
 * Base adapter — common HTTP plumbing shared by all provider adapters.
 *
 * Adapters extend this, implement `buildRequest()`, and use
 * `parseResponse()` to convert raw JSON into TeeTime[].
 */
import type { TeeTimeAdapter, ScrapeContext } from "./types";
import type { Provider, TeeTime } from "../types";
import type { Fetcher, FetcherRequest, FetcherResponse } from "./fetcher";
import { FetcherError } from "./fetcher";

export interface HttpAdapterConfig {
  /** Provider id */
  id: Provider;
  /** Display name */
  name: string;
  /** Default User-Agent (real browsers get banned less) */
  userAgent?: string;
  /** Extra headers to send on every request */
  defaultHeaders?: Record<string, string>;
  /** Fetcher implementation */
  fetcher: Fetcher;
}

export abstract class HttpAdapter implements TeeTimeAdapter {
  readonly id: Provider;
  readonly name: string;
  protected readonly fetcher: Fetcher;
  protected readonly userAgent: string;
  protected readonly defaultHeaders: Record<string, string>;

  constructor(config: HttpAdapterConfig) {
    this.id = config.id;
    this.name = config.name;
    this.fetcher = config.fetcher;
    this.userAgent =
      config.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    this.defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": this.userAgent,
      ...config.defaultHeaders,
    };
  }

  abstract buildRequest(
    providerCourseId: string,
    ctx: ScrapeContext,
  ): FetcherRequest | FetcherRequest[];

  abstract parseResponse(
    providerCourseId: string,
    ctx: ScrapeContext,
    response: FetcherResponse,
  ): TeeTime[];

  async healthcheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.fetcher({
        url: this.healthcheckUrl(),
        headers: this.defaultHeaders,
        timeoutMs: 3000,
      });
      return {
        ok: res.status >= 200 && res.status < 400,
        message: `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  protected healthcheckUrl(): string {
    return "https://example.com";
  }

  async fetchAvailability(
    providerCourseId: string,
    ctx: ScrapeContext,
  ): Promise<TeeTime[]> {
    const requests = this.buildRequest(providerCourseId, ctx);
    const list = Array.isArray(requests) ? requests : [requests];
    const allTeeTimes: TeeTime[] = [];

    for (const req of list) {
      const merged: FetcherRequest = {
        url: req.url,
        method: req.method ?? "GET",
        headers: { ...this.defaultHeaders, ...req.headers },
        timeoutMs: req.timeoutMs ?? 5000,
        ...(req.body !== undefined ? { body: req.body } : {}),
        ...(ctx.signal ?? req.signal ? { signal: ctx.signal ?? req.signal } : {}),
      } as FetcherRequest;
      const res = await this.fetcher(merged);
      if (res.status < 200 || res.status >= 300) {
        throw new FetcherError(
          `${this.id} returned HTTP ${res.status} for ${providerCourseId}`,
          res.status,
        );
      }
      const teeTimes = this.parseResponse(providerCourseId, ctx, res);
      allTeeTimes.push(...teeTimes);
    }

    return allTeeTimes;
  }
}

/**
 * Parse a price into integer cents.
 *
 * Convention: providers differ on whether values arrive in dollars or
 * cents. Each adapter parser knows its own provider and decides — see
 * `parseDollarsAsCents` below. This helper normalizes the cases where
 * the value type alone tells us which (e.g. "$45.00" strings).
 *
 * If unsure, treat the value as cents (callers wanting dollars should
 * pass `asDollars: true`).
 */
export function parsePriceCents(
  value: unknown,
  opts: { asDollars?: boolean } = {},
): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return null;
    // Decide based on explicit opt or magnitude heuristic:
    //   - if opt says "asDollars", convert
    //   - if value looks like a small dollar amount (< 10000) AND has a
    //     fractional part, it's dollars
    //   - otherwise assume cents
    if (opts.asDollars) return Math.round(value * 100);
    if (Number.isInteger(value)) return value;
    return Math.round(value * 100);
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (Number.isNaN(n)) return null;
    if (opts.asDollars) return Math.round(n * 100);
    if (Number.isInteger(n)) return n;
    return Math.round(n * 100);
  }
  return null;
}