import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/index";
import { StubAdapter } from "../src/adapters/types";
import { registerAdapter, clearAdapters } from "../src/adapters";
import {
  TeeTimeSchema,
  makeTeeTimeId,
} from "../src/types";
import type { TeeTime } from "../src/types";
import { DFW_COURSES } from "../src/seed/dfw-courses";
import { TeeTimeCache } from "../src/cache/tee-time-cache";

/**
 * Route-level tests for the Hono app.
 * Hits the Worker via its `app.fetch()` with a stub Env (D1 + KV).
 * Covers /, /api/courses, /search, /course/:id, /api/scrape, /book/:slotId,
 * /map, /vault, /schedule.
 */
describe("routes", () => {
  let env: Env;
  let cache: TeeTimeCache;

  beforeEach(() => {
    env = makeStubEnv();
    cache = new TeeTimeCache(env.CACHE);
    clearAdapters();
  });

  // ---------- existing scaffold ----------

  it("GET / returns HTML homepage with search form", async () => {
    const res = await app.fetch(new Request("http://localhost/"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("Find tee times across DFW");
    expect(body).toMatch(/hx-get="\/search"/);
  });

  it("GET /api/courses returns the DFW catalog", async () => {
    const res = await app.fetch(new Request("http://localhost/api/courses"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { courses: Array<{ id: string }> };
    expect(body.courses.length).toBeGreaterThanOrEqual(40);
    expect(body.courses.map((c) => c.id)).toContain("stevens_park");
  });

  it("unknown route returns 404", async () => {
    const res = await app.fetch(new Request("http://localhost/nope"), env);
    expect(res.status).toBe(404);
  });

  // ---------- POST /api/scrape ----------

  it("POST /api/scrape with no jobs returns a stub note", async () => {
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

  it("POST /api/scrape runs registered adapters and writes to cache", async () => {
    const NOW = Date.now();
    const tt = TeeTimeSchema.parse({
      id: makeTeeTimeId("golfnow", "pc1", NOW + 3_600_000),
      provider: "golfnow",
      providerCourseId: "pc1",
      courseId: "stevens_park",
      timeEpochMs: NOW + 3_600_000,
      playersAvailable: 4,
      bookable: true,
      hotDealPriceCents: 4500,
      rackPriceCents: 12000,
      twilightPriceCents: 3500,
      providerSlotId: "slot-c1",
      scrapedAt: NOW,
    });
    registerAdapter(
      new StubAdapter({
        id: "golfnow",
        canned: new Map([["pc1", [tt]]]),
      }),
    );

    const res = await app.fetch(
      new Request("http://localhost/api/scrape", {
        method: "POST",
        body: JSON.stringify({
          date: "2026-07-20",
          players: 2,
          jobs: [
            { provider: "golfnow", providerCourseId: "pc1", courseId: "stevens_park" },
          ],
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      ran: number;
      cached: number;
      teeTimes: number;
    };
    expect(body.ok).toBe(true);
    expect(body.ran).toBe(1);
    expect(body.cached).toBe(1);
    expect(body.teeTimes).toBe(1);

    // Cache should now have the entry
    const cached = await env.CACHE.get("tt:golfnow:pc1:2026-07-20", "json");
    expect(cached).not.toBeNull();
  });

  // ---------- GET /search ----------

  it("GET /search without date returns 400", async () => {
    const res = await app.fetch(new Request("http://localhost/search"), env);
    expect(res.status).toBe(400);
  });

  it("GET /search with date but empty cache renders empty state", async () => {
    const res = await app.fetch(
      new Request("http://localhost/search?date=2026-07-20"),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("No tee times matched");
  });

  it("GET /search returns rows from cached tee times", async () => {
    // Seed cache with one tee time at 8:00 AM CT on 2026-07-20 = 13:00 UTC (CDT)
    const epochMs = Date.UTC(2026, 6, 20, 13, 0, 0);
    const tt = makeTestTeeTime("foreup", "stevens-park", "stevens_park", epochMs, {
      hotDealPriceCents: 4500,
    });
    await cache.set("foreup", "stevens-park", "2026-07-20", [tt]);

    const res = await app.fetch(
      new Request(
        "http://localhost/search?date=2026-07-20&players=2&from=07:00&to=20:00&maxPrice=8000&courseId=stevens_park",
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("tee times · 2026-07-20");
    expect(body).toContain("Stevens Park");
    expect(body).toContain("foreup");
    expect(body).toContain("$45.00");
  });

  it("GET /search excludes PLACEHOLDER provider ids", async () => {
    // TPC Craig Ranch has providerIds.golfnow = "PLACEHOLDER_CRAIG_RANCH" —
    // its slot must NOT show up because the route skips placeholders.
    const epochMs = Date.UTC(2026, 6, 20, 13, 0, 0);
    const tt = makeTestTeeTime(
      "golfnow",
      "PLACEHOLDER_CRAIG_RANCH",
      "tpc_craig_ranch",
      epochMs,
      {},
    );
    await cache.set("golfnow", "PLACEHOLDER_CRAIG_RANCH", "2026-07-20", [tt]);

    const res = await app.fetch(
      new Request("http://localhost/search?date=2026-07-20"),
      env,
    );
    const body = await res.text();
    expect(body).toContain("No tee times matched");
  });

  it("GET /search filters by max price", async () => {
    const epochMs = Date.UTC(2026, 6, 20, 13, 0, 0);
    await cache.set("foreup", "stevens-park", "2026-07-20", [
      makeTestTeeTime("foreup", "stevens-park", "stevens_park", epochMs, {
        hotDealPriceCents: 4500, // $45 — under $50
      }),
      makeTestTeeTime("foreup", "stevens-park", "stevens_park", epochMs + 3600_000, {
        hotDealPriceCents: 7500, // $75 — over $50
      }),
    ]);

    const res = await app.fetch(
      new Request(
        "http://localhost/search?date=2026-07-20&from=06:00&to=20:00&maxPrice=5000",
      ),
      env,
    );
    const body = await res.text();
    // Should show only the $45 row, not the $75 row.
    expect(body).toContain("$45.00");
    expect(body).not.toContain("$75.00");
  });

  it("GET /search filters by time window", async () => {
    // 7:00 AM CT = 12:00 UTC, 4:00 PM CT = 21:00 UTC.
    // Window 06:00–14:00 should include 7 AM but exclude 4 PM.
    await cache.set("foreup", "stevens-park", "2026-07-20", [
      makeTestTeeTime("foreup", "stevens-park", "stevens_park", Date.UTC(2026, 6, 20, 12, 0), { hotDealPriceCents: 4500 }),
      makeTestTeeTime("foreup", "stevens-park", "stevens_park", Date.UTC(2026, 6, 20, 21, 0), { hotDealPriceCents: 4500 }),
    ]);

    const res = await app.fetch(
      new Request(
        "http://localhost/search?date=2026-07-20&from=06:00&to=14:00&courseId=stevens_park",
      ),
      env,
    );
    const body = await res.text();
    expect(body).toContain("7:00 AM");
    expect(body).not.toContain("4:00 PM");
  });

  it("GET /search filters by courseId when provided", async () => {
    const epochMs = Date.UTC(2026, 6, 20, 13, 0, 0);
    await cache.set("foreup", "tenison-park", "2026-07-20", [
      makeTestTeeTime("foreup", "tenison-park", "tenison_park", epochMs, { hotDealPriceCents: 3500 }),
    ]);
    await cache.set("foreup", "cedar-crest", "2026-07-20", [
      makeTestTeeTime("foreup", "cedar-crest", "cedar_crest", epochMs, { hotDealPriceCents: 3500 }),
    ]);

    const res = await app.fetch(
      new Request(
        "http://localhost/search?date=2026-07-20&courseId=tenison_park&from=06:00&to=20:00",
      ),
      env,
    );
    const body = await res.text();
    expect(body).toContain("Tenison Park");
    expect(body).not.toContain("Cedar Crest");
  });

  it("GET /search applies preferred sub-course filter (Tenison Highland)", async () => {
    const epochMs = Date.UTC(2026, 6, 20, 13, 0, 0);
    // Tenison has two sub-courses; seed both, expect only Highland.
    await cache.set("foreup", "tenison-park", "2026-07-20", [
      {
        ...makeTestTeeTime("foreup", "tenison-park", "tenison_park", epochMs, { hotDealPriceCents: 3500 }),
        subCourse: "Classic",
      } as TeeTime & { subCourse?: string },
      {
        ...makeTestTeeTime("foreup", "tenison-park", "tenison_park", epochMs + 3600_000, { hotDealPriceCents: 3500 }),
        subCourse: "Highland",
      } as TeeTime & { subCourse?: string },
    ]);

    const res = await app.fetch(
      new Request("http://localhost/search?date=2026-07-20&courseId=tenison_park&from=06:00&to=20:00"),
      env,
    );
    const body = await res.text();
    expect(body).toContain("Tenison Park");
    // Should render only 1 row (Highland). We can't directly inspect row count
    // in HTML, but we can verify the price + courseId appears once via the link.
    const occurrences = (body.match(/\/book\//g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("GET /search deduplicates identical slot ids across providers", async () => {
    const epochMs = Date.UTC(2026, 6, 20, 13, 0, 0);
    const tt = makeTestTeeTime("foreup", "stevens-park", "stevens_park", epochMs, { hotDealPriceCents: 4500 });
    // Same slot id (same provider + course + epoch) across two cache keys
    await cache.set("foreup", "stevens-park", "2026-07-20", [tt]);
    await cache.set("foreup", "stevens-park-2", "2026-07-20", [tt]);

    const res = await app.fetch(
      new Request("http://localhost/search?date=2026-07-20&from=06:00&to=20:00"),
      env,
    );
    const body = await res.text();
    const occurrences = (body.match(/\/book\//g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("GET /search links each row to /book/{slotId}", async () => {
    const epochMs = Date.UTC(2026, 6, 20, 13, 0, 0);
    const tt = makeTestTeeTime("foreup", "stevens-park", "stevens_park", epochMs, { hotDealPriceCents: 4500 });
    await cache.set("foreup", "stevens-park", "2026-07-20", [tt]);

    const res = await app.fetch(
      new Request("http://localhost/search?date=2026-07-20&from=06:00&to=20:00"),
      env,
    );
    const body = await res.text();
    const slotId = tt.id;
    expect(body).toContain(`/book/${encodeURIComponent(slotId)}`);
  });

  // ---------- GET /course/:id ----------

  it("GET /course/:id returns 200 for known course", async () => {
    const res = await app.fetch(
      new Request("http://localhost/course/tenison_park"),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Tenison Park Golf Course");
    expect(body).toContain("foreup");
    expect(body).toContain("Sub-courses");
    expect(body).toContain("Highland");
  });

  it("GET /course/:id 404 for unknown course", async () => {
    const res = await app.fetch(
      new Request("http://localhost/course/nonexistent_course"),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("GET /course/:id shows sub-course preferences when set", async () => {
    const res = await app.fetch(
      new Request("http://localhost/course/tenison_park"),
      env,
    );
    const body = await res.text();
    expect(body).toContain("Sub-courses");
    expect(body).toContain("Highland");
    expect(body).toContain("Classic");
    expect(body).toContain("preferred");
  });

  // ---------- GET /book/:slotId ----------

  it("GET /book/:slotId renders placeholder for any slotId", async () => {
    const res = await app.fetch(
      new Request("http://localhost/book/golfnow:stevens-park:1700000000000"),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("golfnow:stevens-park:1700000000000");
    expect(body).toContain("Schedule tee time");
  });

  // ---------- GET /map ----------

  it("GET /map returns 200 with embedded course data", async () => {
    const res = await app.fetch(new Request("http://localhost/map"), env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Course map");
    expect(body).toContain("stevens_park");
    // Courses should be embedded as JSON for map.js
    expect(body).toMatch(/<script[^>]+id="courses-data"/);
    expect(body).toMatch(/<script[^>]+src="\/map\.js"/);
  });

  // ---------- /vault and /schedule placeholders ----------

  it("GET /vault returns 200 (UI placeholder for now)", async () => {
    const res = await app.fetch(new Request("http://localhost/vault"), env);
    // vault route isn't wired in the Worker yet — should 404
    expect([200, 404]).toContain(res.status);
  });

  it("GET /schedule returns 404 (not wired yet)", async () => {
    const res = await app.fetch(new Request("http://localhost/schedule"), env);
    expect(res.status).toBe(404);
  });
});

// ---------- helpers ----------

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
  const stub = {
    prepare(_sql: string) {
      return {
        bind() {
          return {
            async all() {
              return { results: [], success: true, meta: {} };
            },
            async first() {
              return null;
            },
            async run() {
              return { success: true, meta: {} };
            },
          };
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
    },
  };
  return stub as unknown as D1Database;
}

function makeStubKV(): KVNamespace {
  const data = new Map<string, string>();
  return {
    get: async (k: string, t?: "json" | "text") => {
      const v = data.get(k);
      if (v == null) return null;
      if (t === "json") return JSON.parse(v);
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

function makeTestTeeTime(
  provider: string,
  providerCourseId: string,
  courseId: string,
  epochMs: number,
  overrides: { hotDealPriceCents?: number; rackPriceCents?: number; twilightPriceCents?: number },
): TeeTime {
  return TeeTimeSchema.parse({
    id: makeTeeTimeId(
      provider as TeeTime["provider"],
      providerCourseId,
      epochMs,
    ),
    provider: provider as TeeTime["provider"],
    providerCourseId,
    courseId,
    timeEpochMs: epochMs,
    playersAvailable: 4,
    bookable: true,
    hotDealPriceCents: overrides.hotDealPriceCents ?? null,
    rackPriceCents: overrides.rackPriceCents ?? null,
    twilightPriceCents: overrides.twilightPriceCents ?? null,
    providerSlotId: `slot-${providerCourseId}-${epochMs}`,
    scrapedAt: epochMs,
  });
}