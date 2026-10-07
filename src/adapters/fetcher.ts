/**
 * Fetcher — abstract HTTP layer shared by all provider adapters.
 *
 * Why this exists: in production the runner needs to fetch from real
 * providers; in dev/test we want to play back recorded fixtures without
 * touching the network; and for SPA-only providers we want to proxy
 * through the Playwright fallback host. All three flows are identical
 * from the adapter's perspective: "give me bytes for this URL".
 *
 * Adapters accept any function matching `Fetcher` and call it.
 */
export interface FetcherRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | URLSearchParams | undefined;
  /** Per-request timeout in ms (adapters set this; runner also enforces a hard cap) */
  timeoutMs?: number;
  /** AbortSignal honored by implementations that support it */
  signal?: AbortSignal;
}

export interface FetcherResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  url: string;
}

export type Fetcher = (req: FetcherRequest) => Promise<FetcherResponse>;

export class FetcherError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FetcherError";
  }
}

/**
 * Real network fetcher backed by global fetch. Honors AbortSignal +
 * a hard timeout via AbortController.
 */
export function realFetch(f: typeof fetch): Fetcher {
  return async (req) => {
    const controller = new AbortController();
    const timeoutMs = req.timeoutMs ?? 5000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Chain external signal with our internal one
    if (req.signal) {
      if (req.signal.aborted) controller.abort();
      else req.signal.addEventListener("abort", () => controller.abort());
    }
    try {
      const init: RequestInit = {
        method: req.method ?? "GET",
        signal: controller.signal,
      };
      if (req.headers !== undefined) init.headers = req.headers;
      if (req.body !== undefined) init.body = req.body;
      const res = await f(req.url, init);
      const headers: Record<string, string> = {};
      const h = res.headers as unknown as {
        forEach(cb: (v: string, k: string) => void): void;
      };
      h.forEach((v, k) => {
        headers[k] = v;
      });
      return {
        status: res.status,
        headers,
        body: await res.text(),
        url: res.url,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new FetcherError(`fetch timeout after ${timeoutMs}ms`);
      }
      throw new FetcherError(
        err instanceof Error ? err.message : String(err),
        undefined,
        err,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Fixture-backed fetcher. Records request → response pairs on disk so
 * adapters can be tested and replayed without network access.
 *
 * Lookup rule: `fixtures/{provider}/{method}-{urlHash}.json`
 *   - method: lowercase GET/POST
 *   - urlHash: short hash of the request URL (deterministic)
 *
 * Playback mode: if a recorded response exists, return it.
 * Record mode: if no record exists AND env.FIXTURE_RECORD=1, fetch real
 * network and write the response to disk for next time.
 */
export interface FixtureFetcherOptions {
  provider: string;
  fixturesDir: string;
  /** When true, missing fixtures trigger real network fetch + write */
  record?: boolean;
  /** Real fetcher used when recording */
  realFetcher?: Fetcher;
}

export function fixtureFetcher(opts: FixtureFetcherOptions): Fetcher {
  return async (req) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const crypto = await import("node:crypto");

    const hash = crypto
      .createHash("sha1")
      .update(`${req.method ?? "GET"}:${req.url}`)
      .digest("hex")
      .slice(0, 12);
    const filename = `${(req.method ?? "GET").toLowerCase()}-${hash}.json`;
    const fixturePath = path.join(opts.fixturesDir, opts.provider, filename);

    // Try playback first
    try {
      const raw = await fs.readFile(fixturePath, "utf8");
      const recorded = JSON.parse(raw) as {
        status: number;
        headers: Record<string, string>;
        body: string;
        url: string;
      };
      return {
        status: recorded.status,
        headers: recorded.headers,
        body: recorded.body,
        url: recorded.url,
      };
    } catch {
      // No fixture — record or fail
    }

    if (opts.record && opts.realFetcher) {
      const live = await opts.realFetcher(req);
      await fs.mkdir(path.dirname(fixturePath), { recursive: true });
      await fs.writeFile(
        fixturePath,
        JSON.stringify(
          {
            status: live.status,
            headers: live.headers,
            body: live.body,
            url: live.url,
            recordedAt: Date.now(),
            requestUrl: req.url,
            requestMethod: req.method ?? "GET",
          },
          null,
          2,
        ),
      );
      return live;
    }

    throw new FetcherError(
      `no fixture for ${opts.provider} ${req.method ?? "GET"} ${req.url} ` +
        `(looked at ${fixturePath}). ` +
        `Run with FIXTURE_RECORD=1 to capture from live network.`,
    );
  };
}

/**
 * In-memory fetcher for tests. Keys requests by URL+method, returns
 * pre-programmed responses.
 */
export class InMemoryFetcher {
  private routes: Array<{
    match: (url: string, method: string) => boolean;
    response: FetcherResponse | ((req: FetcherRequest) => FetcherResponse);
  }> = [];
  requests: FetcherRequest[] = [];

  route(
    urlPattern: RegExp | string,
    method: "GET" | "POST" | "ANY" = "ANY",
    response:
      | FetcherResponse
      | ((req: FetcherRequest) => FetcherResponse),
  ): void {
    this.routes.push({
      match: (url, m) => {
        const urlOk =
          typeof urlPattern === "string"
            ? url === urlPattern
            : urlPattern.test(url);
        const methodOk = method === "ANY" || m === method;
        return urlOk && methodOk;
      },
      response,
    });
  }

  asFetcher(): Fetcher {
    return async (req) => {
      this.requests.push(req);
      const route = this.routes.find((r) =>
        r.match(req.url, req.method ?? "GET"),
      );
      if (!route) {
        throw new FetcherError(
          `no route for ${req.method ?? "GET"} ${req.url}`,
        );
      }
      return typeof route.response === "function"
        ? route.response(req)
        : route.response;
    };
  }
}