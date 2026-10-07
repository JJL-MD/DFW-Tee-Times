/**
 * Provider adapter interface.
 *
 * Every adapter (GolfNow, TeeOff, Chronogolf, ForeUp, per-system, ...)
 * implements this. The runner (src/scrape/runner.ts) consumes adapters
 * uniformly without knowing provider internals.
 *
 * Adapters are stateless singletons; constructor takes no args.
 * Per-call context (date, players, user-agent, proxy hints) is in
 * ScrapeContext.
 */
import type { Provider, TeeTime } from "../types";

export interface ScrapeContext {
  /** YYYY-MM-DD in course-local TZ */
  date: string;
  /** 1–4 */
  players: number;
  /** Course-local timezone (IANA), e.g. "America/Chicago" */
  timezone: string;
  /** Override User-Agent (some providers UA-fingerprint) */
  userAgent?: string;
  /** AbortSignal for cancellation from the runner */
  signal?: AbortSignal;
}

export interface TeeTimeAdapter {
  /** Provider id, matches PROVIDERS in src/types.ts */
  readonly id: Provider;
  /** Human-readable name */
  readonly name: string;
  /** Cheap health probe. Used by the runnable health check (E6). */
  healthcheck(): Promise<{ ok: boolean; message?: string }>;
  /**
   * Fetch all bookable tee times for a single course on a given date.
   * Returns [] if the course has no availability that day — do not throw
   * for empty results. Throw only for transport / parse errors.
   */
  fetchAvailability(
    providerCourseId: string,
    ctx: ScrapeContext,
  ): Promise<TeeTime[]>;
}

/**
 * Minimal stub adapter for tests + future adapter scaffolding.
 */
export class StubAdapter implements TeeTimeAdapter {
  readonly id: Provider;
  readonly name: string;
  /** canned response keyed by providerCourseId */
  private readonly canned: Map<string, TeeTime[]>;
  /** optional override that throws */
  private readonly error: Map<string, Error>;

  constructor(
    opts: {
      id: Provider;
      name?: string;
      canned?: Map<string, TeeTime[]>;
      error?: Map<string, Error>;
    },
  ) {
    this.id = opts.id;
    this.name = opts.name ?? opts.id;
    this.canned = opts.canned ?? new Map();
    this.error = opts.error ?? new Map();
  }

  async healthcheck() {
    return { ok: true };
  }

  async fetchAvailability(
    providerCourseId: string,
    _ctx: ScrapeContext,
  ): Promise<TeeTime[]> {
    const err = this.error.get(providerCourseId);
    if (err) throw err;
    return this.canned.get(providerCourseId) ?? [];
  }
}