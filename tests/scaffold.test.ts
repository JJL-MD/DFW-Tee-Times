import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { StubAdapter } from "../src/adapters/types";
import { registerAdapter, clearAdapters } from "../src/adapters";
import {
  TeeTimeSchema,
  makeTeeTimeId,
} from "../src/types";
import type { TeeTime } from "../src/types";

/**
 * Smoke tests for A1 + B wiring.
 * Hits the Worker via its Hono fetch handler with stub adapters + a KV stub.
 */
describe("A1 scaffold + B wiring", () => {
  it("GET / returns HTML homepage with search form", async () => {
    const env = makeStubEnv();
    const res = await app.fetch(new Request("http://localhost/"), env);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("Find tee times across DFW");
    expect(body).toMatch(/hx-get="\/search"/);
  });

  it("GET /api/courses returns the DFW catalog", async () => {
    const env = makeStubEnv();
    const res = await app.fetch(new Request("http://localhost/api/courses"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { courses: Array<{ id: string }> };
    expect(body.courses.length).toBeGreaterThanOrEqual(40);
    expect(body.courses.map((c) => c.id)).toContain("stevens_park");
  });

  it("unknown route returns 404", async () => {
    const env = makeStubEnv();
    const res = await app.fetch(new Request("http://localhost/nope"), env);
    expect(res.status).toBe(404);
  });

  it("POST /api/scrape runs registered adapters and writes to cache", async () => {
    clearAdapters();
    const NOW = 1_700_000_000_000;
    const canned = new Map<string, TeeTime[]>();
    canned.set("c1", [
      TeeTimeSchema.parse({
        id: makeTeeTimeId("golfnow", "c1", NOW + 3_600_000),
        provider: "golfnow",
        providerCourseId: "c1",
        courseId: "stevens_park",
        timeEpochMs: NOW + 3_600_000,
        playersAvailable: 4,
        bookable: true,
        hotDealPriceCents: 4500,
        rackPriceCents: 12000,
        twilightPriceCents: 3500,
        providerSlotId: "slot-c1",
        scrapedAt: NOW,
      }),
    ]);
    registerAdapter(new StubAdapter({ id: "golfnow", canned }));

    const env = makeStubEnv();
    const res = await app.fetch(
      new Request("http://localhost/api/scrape", {
        method: "POST",
        body: JSON.stringify({
          date: "2026-07-20",
          players: 2,
          jobs: [
            {
              provider: "golfnow",
              providerCourseId: "c1",
              courseId: "stevens_park",
            },
          ],
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      ran: number;
      teeTimes: number;
      cached: number;
    };
    expect(body.ok).toBe(true);
    expect(body.ran).toBe(1);
    expect(body.teeTimes).toBe(1);
    expect(body.cached).toBe(1);

    // Cache should now have the entry
    const cacheRead = await env.CACHE.get("tt:golfnow:c1:2026-07-20", "json");
    expect(cacheRead).not.toBeNull();
    const entry = cacheRead as { teeTimes: TeeTime[]; scrapedAt: number };
    expect(entry.teeTimes).toHaveLength(1);
  });

  it("POST /api/scrape with no jobs returns helpful stub", async () => {
    const env = makeStubEnv();
    const res = await app.fetch(
      new Request("http://localhost/api/scrape", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ran: number; note?: string };
    expect(body.ran).toBe(0);
    expect(body.note).toMatch(/no jobs/);
  });
});

function makeStubEnv(): Env {
  return {
    DB: makeStubD1(),
    CACHE: makeStubKV(),
  } as unknown as Env;
}

type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
};

function makeStubD1(): D1Database {
  // Minimal D1 stub — only `prepare().all()` is called by current code paths,
  // and even then never during the smoke routes. Kept here so tests don't
  // require wrangler's local mode.
  const stub = {
    prepare: (_sql: string) => ({
      all: async () => ({ results: [], success: true, meta: {} }),
      first: async () => null,
      run: async () => ({ success: true, meta: {} }),
      bind: (..._args: unknown[]) => stub.prepare(_sql),
    }),
  };
  return stub as unknown as D1Database;
}

function makeStubKV(): KVNamespace {
  const data = new Map<string, string>();
  return {
    get: async (k: string, type?: "json" | "text" | "arrayBuffer") => {
      const v = data.get(k);
      if (v == null) return null;
      if (type === "json") return JSON.parse(v);
      return v;
    },
    put: async (k: string, v: string) => {
      data.set(k, v);
    },
    delete: async (k: string) => {
      data.delete(k);
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
  } as unknown as KVNamespace;
}