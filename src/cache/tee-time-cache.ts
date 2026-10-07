/**
 * KV tee-time cache with stale-while-revalidate (SWR).
 *
 * Key format:   tt:{provider}:{providerCourseId}:{dateISO}
 * Value:        JSON-encoded { teeTimes, scrapedAt }
 * KV expiration metadata: wallclock seconds
 *
 * SWR semantics (configurable via constructor):
 *   - `freshSeconds`: serve from cache, skip upstream scrape
 *   - `staleSeconds`: serve from cache (with `stale: true` flag),
 *                     trigger background refresh — caller does NOT block
 *   - beyond `staleSeconds`: cache miss
 *
 * Cloudflare KV does not support per-key TTLs as flexible metadata, so we
 * store `scrapedAt` and compute freshness client-side. KV's `expirationTtl`
 * is set to `staleSeconds` to bound storage.
 */
import type { TeeTime } from "../types";
import { TeeTimeSchema } from "../types";

export interface CacheEntry {
  teeTimes: TeeTime[];
  scrapedAt: number;
}

export interface CacheReadResult {
  hit: boolean;
  stale: boolean;
  teeTimes: TeeTime[];
  scrapedAt: number | null;
  ageSeconds: number;
}

export interface KVCacheConfig {
  /** Up to this age, serve as fresh (default 600s = 10 min) */
  freshSeconds?: number;
  /** Up to this age, serve as stale (triggers SWR refresh). default 1800s = 30 min */
  staleSeconds?: number;
  /** now() override for tests */
  now?: () => number;
}

const DEFAULT_FRESH = 600;
const DEFAULT_STALE = 1800;

export class TeeTimeCache {
  private readonly kv: KVNamespace;
  private readonly fresh: number;
  private readonly stale: number;
  private readonly now: () => number;

  constructor(kv: KVNamespace, config: KVCacheConfig = {}) {
    this.kv = kv;
    this.fresh = config.freshSeconds ?? DEFAULT_FRESH;
    this.stale = config.staleSeconds ?? DEFAULT_STALE;
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
  }

  static key(
    provider: string,
    providerCourseId: string,
    dateISO: string,
  ): string {
    return `tt:${provider}:${providerCourseId}:${dateISO}`;
  }

  async get(
    provider: string,
    providerCourseId: string,
    dateISO: string,
  ): Promise<CacheReadResult> {
    const key = TeeTimeCache.key(provider, providerCourseId, dateISO);
    const raw = await this.kv.get(key, "json");
    const now = this.now();

    if (!raw || typeof raw !== "object" || !("scrapedAt" in raw)) {
      return {
        hit: false,
        stale: false,
        teeTimes: [],
        scrapedAt: null,
        ageSeconds: Infinity,
      };
    }

    const entry = raw as CacheEntry;
    const age = Math.max(0, now - Math.floor(entry.scrapedAt / 1000));

    if (age <= this.fresh) {
      return {
        hit: true,
        stale: false,
        teeTimes: entry.teeTimes,
        scrapedAt: entry.scrapedAt,
        ageSeconds: age,
      };
    }
    if (age <= this.stale) {
      return {
        hit: true,
        stale: true,
        teeTimes: entry.teeTimes,
        scrapedAt: entry.scrapedAt,
        ageSeconds: age,
      };
    }
    return {
      hit: false,
      stale: false,
      teeTimes: [],
      scrapedAt: entry.scrapedAt,
      ageSeconds: age,
    };
  }

  async set(
    provider: string,
    providerCourseId: string,
    dateISO: string,
    teeTimes: TeeTime[],
  ): Promise<void> {
    const key = TeeTimeCache.key(provider, providerCourseId, dateISO);
    // Validate before persisting so corrupted entries can't poison the cache.
    for (const t of teeTimes) TeeTimeSchema.parse(t);
    // scrapedAt is wall-clock epoch ms; store via the configured clock
    // so tests with a frozen clock get consistent values.
    const scrapedAt = this.now() * 1000;
    const entry: CacheEntry = { teeTimes, scrapedAt };
    // KV TTL slightly longer than staleSeconds so we don't lose entries
    // right at the boundary.
    await this.kv.put(key, JSON.stringify(entry), {
      expirationTtl: this.stale + 60,
    });
  }

  async delete(
    provider: string,
    providerCourseId: string,
    dateISO: string,
  ): Promise<void> {
    await this.kv.delete(TeeTimeCache.key(provider, providerCourseId, dateISO));
  }
}