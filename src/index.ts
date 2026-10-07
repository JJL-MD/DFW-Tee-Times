/**
 * DFW Tee-Times — Cloudflare Worker entrypoint.
 *
 * Routes:
 *   GET  /                       search form (homepage)
 *   GET  /search                 results table (HTMX partial or full page)
 *   GET  /map                    leaflet map of all courses
 *   GET  /course/:id             single course detail
 *   GET  /book/:slotId           schedule a tee time (form + booking helper)
 *   POST /api/scrape             manual scrape trigger (uses runner + cache)
 *   GET  /api/courses            JSON catalog
 *
 * Cron triggers (see wrangler.toml):
 *   every 15 minutes             availability scrape tick
 *   every minute                 booking daemon tick
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { runScrape, type ScrapeJob } from "./scrape/runner";
import { TeeTimeCache } from "./cache/tee-time-cache";
import { DFW_COURSES } from "./seed/dfw-courses";
import { renderHome } from "./views/home";
import { renderResults, type ResultsRow } from "./views/results";
import { renderMap } from "./views/map";
import { renderCourseDetail } from "./views/course";
import type { TeeTime } from "./types";

type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  VAULT_MASTER_KEY?: string;
  FALLBACK_HOST_URL?: string;
  FALLBACK_HOST_TOKEN?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  NOTIFY_EMAIL?: string;
  DEFAULT_TIMEZONE?: string;
  SCRAPE_CONCURRENCY_PER_HOST?: string;
  SCRAPE_TIMEOUT_MS?: string;
  CACHE_TTL_SECONDS?: string;
  CACHE_STALE_SECONDS?: string;
  BOOKING_RETRY_MAX?: string;
  BOOKING_RETRY_BACKOFF_MS?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors({ origin: "*" }));

// ---------- pages ----------

app.get("/", (c) => c.html(renderHome()));

app.get("/map", (c) => c.html(renderMap()));

app.get("/course/:id", (c) => {
  const id = c.req.param("id");
  const course = DFW_COURSES.find((co) => co.id === id);
  if (!course) return c.text("course not found", 404);
  // Tee times will be wired via cache in Phase D2 enhancement;
  // for now show empty list with "no cached" placeholder.
  return c.html(
    renderCourseDetail({
      course,
      teeTimes: [],
      lastUpdated: null,
    }),
  );
});

app.get("/book/:slotId", (c) => {
  // Full schedule form lands in Phase F; placeholder for now.
  const slotId = c.req.param("slotId");
  return c.html(`<!doctype html><meta charset="utf-8">
  <title>Schedule tee time</title>
  <link rel="stylesheet" href="/styles.css">
  <body style="font-family:system-ui;padding:2rem;max-width:600px;margin:auto">
    <h1>Schedule tee time</h1>
    <p>Slot id: <code>${slotId}</code></p>
    <p>The schedule form is wired in Phase F. <a href="/">Back to search</a></p>
  </body>`);
});

app.get("/search", async (c) => {
  const url = new URL(c.req.url);
  const date = url.searchParams.get("date") ?? "";
  const players = Number(url.searchParams.get("players") ?? "2");
  const courseId = url.searchParams.get("courseId") ?? "";
  const from = url.searchParams.get("from") ?? "06:00";
  const to = url.searchParams.get("to") ?? "20:00";
  const maxPriceStr = url.searchParams.get("maxPrice") ?? "";
  const maxPriceCents = maxPriceStr ? Number(maxPriceStr) : null;

  if (!date) {
    return c.html("<p>missing date</p>", 400);
  }

  // Load all tee times from cache for the requested date, then filter.
  const cache = new TeeTimeCache(c.env.CACHE, {
    freshSeconds: Number(c.env.CACHE_TTL_SECONDS ?? 600),
    staleSeconds: Number(c.env.CACHE_STALE_SECONDS ?? 1800),
  });

  const coursesToScan = courseId
    ? DFW_COURSES.filter((co) => co.id === courseId)
    : DFW_COURSES;

  const rows: ResultsRow[] = [];
  const seen = new Set<string>();

  for (const course of coursesToScan) {
    for (const [provider, providerCourseId] of Object.entries(course.providerIds)) {
      if (!providerCourseId || providerCourseId.startsWith("PLACEHOLDER")) continue;
      const r = await cache.get(provider, providerCourseId, date);
      if (r.hit) {
        for (const tt of r.teeTimes) {
          if (seen.has(tt.id)) continue;
          seen.add(tt.id);
          // Apply sub-course preference filter if the course has one
          const subPref = course.preferredSubCourse;
          const subCourse = (tt as TeeTime & { subCourse?: string }).subCourse;
          if (subPref && subCourse && subCourse !== subPref) continue;
          // Apply filters
          if (!inTimeWindow(tt.timeEpochMs, from, to)) continue;
          if (maxPriceCents != null) {
            const price = tt.hotDealPriceCents ?? tt.rackPriceCents;
            if (price != null && price > maxPriceCents) continue;
          }
          rows.push({ teeTime: tt, course });
        }
      }
    }
  }

  return c.html(
    renderResults({ date, players, rows, from, to, maxPriceCents }),
  );
});

// ---------- APIs ----------

app.get("/api/courses", (c) =>
  c.json({ courses: DFW_COURSES }),
);

app.post("/api/scrape", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    date?: string;
    players?: number;
    jobs?: ScrapeJob[];
  };
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  const players = body.players ?? 2;
  const jobs = body.jobs ?? [];

  if (jobs.length === 0) {
    return c.json({
      ok: true,
      ran: 0,
      note: "no jobs provided — pass {date, players, jobs:[{provider, providerCourseId, courseId}]} to scrape",
    });
  }

  const tz = c.env.DEFAULT_TIMEZONE ?? "America/Chicago";
  const result = await runScrape(date, players, tz, jobs, {
    concurrencyPerHost: Number(c.env.SCRAPE_CONCURRENCY_PER_HOST ?? 1),
    timeoutMs: Number(c.env.SCRAPE_TIMEOUT_MS ?? 5000),
    jitterMs: 100,
  });

  const cache = new TeeTimeCache(c.env.CACHE, {
    freshSeconds: Number(c.env.CACHE_TTL_SECONDS ?? 600),
    staleSeconds: Number(c.env.CACHE_STALE_SECONDS ?? 1800),
  });
  const grouped = new Map<string, typeof result.teeTimes>();
  for (const tt of result.teeTimes) {
    const key = `${tt.provider}:${tt.providerCourseId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(tt);
  }
  for (const [key, tt] of grouped) {
    const [provider, providerCourseId] = key.split(":") as [
      Parameters<typeof cache.set>[0],
      string,
    ];
    await cache.set(provider, providerCourseId, date, tt);
  }

  return c.json({
    ok: true,
    ran: jobs.length,
    cached: grouped.size,
    teeTimes: result.teeTimes.length,
    errors: result.errors.length,
    durationMs: result.durationMs,
  });
});

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((err, c) => {
  console.error("worker_error", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

// ---------- helpers ----------

/** Compare an epoch-ms time to HH:MM strings in course-local TZ. */
function inTimeWindow(epochMs: number, from: string, to: string): boolean {
  // Convert epoch to "HH:MM" in America/Chicago (default TZ).
  const hhmm = new Date(epochMs).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Chicago",
  });
  return hhmm >= from && hhmm <= to;
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    const cron = event.cron;
    console.log("cron_tick", { cron });

    if (cron === "*/15 * * * *") {
      // Scrape runner — wired in Phase G6 (booking daemon will share the runner)
      ctx.waitUntil(Promise.resolve());
      return;
    }
    if (cron === "* * * * *") {
      // Booking daemon — wired in Phase G6
      ctx.waitUntil(Promise.resolve());
      return;
    }
  },
};