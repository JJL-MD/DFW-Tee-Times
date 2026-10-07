/**
 * IP hygiene — UA strings, concurrency, jitter, proxy hints.
 *
 * Hard-won rules for scraping booking sites:
 *   1. Real Chrome UA — bot UAs (curl, python-requests) get banned faster
 *   2. Match the Referer to the provider's domain — empty/mismatched is a flag
 *   3. Concurrency cap 1 per host — too many parallel requests from one IP = bot
 *   4. Jitter 100-300ms between requests — perfectly metronomic timing is a flag
 *   5. For SPA-only providers, route through Playwright with residential IP
 *
 * These are passed to the runner via ScrapeJob-level overrides or via
 * fetcher-level headers. The defaults below match what real browsers send.
 */

export const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const REAL_FIREFOX_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) " +
  "Gecko/20100101 Firefox/125.0";

export const REAL_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/** Per-provider default headers. */
export function defaultHeadersFor(provider: string): Record<string, string> {
  const base: Record<string, string> = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "User-Agent": REAL_CHROME_UA,
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  switch (provider) {
    case "golfnow":
      return { ...base, Referer: "https://www.golfnow.com/" };
    case "teeoff":
      return { ...base, Referer: "https://www.teeoff.com/" };
    case "chronogolf":
      return { ...base, Referer: "https://www.chronogolf.com/" };
    case "foreup":
      return { ...base, Referer: "https://foreupsoftware.com/" };
    default:
      return base;
  }
}

/**
 * Jittered sleep — random delay in [min, max] ms.
 * Use this between requests to avoid metronomic timing.
 */
export function jitter(min = 100, max = 300): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Concurrency limiter — at most N concurrent tasks.
 * Simple semaphore using a promise queue.
 */
export class ConcurrencyLimiter {
  private inFlight = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("max must be >= 1");
  }

  async acquire(): Promise<void> {
    if (this.inFlight < this.max) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.inFlight++;
  }

  release(): void {
    this.inFlight--;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Exponential backoff with jitter — retry transient failures.
 */
export function backoffMs(
  attempt: number,
  baseMs = 500,
  capMs = 30_000,
): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

/**
 * Residential proxy hint — providers that aggressively ban data-center IPs
 * (GolfNow, TeeOff) should be reached via a residential proxy.
 * Wire this into the fetcher via the `proxy` field on FetcherRequest.
 */
export interface ResidentialProxy {
  /** provider name (e.g. "brightdata", "webshare") */
  provider: string;
  /** proxy URL with auth — used as `Request(proxy + targetUrl)` */
  url: string;
  /** Rotate per request (true) or sticky session (false) */
  rotate?: boolean;
}
