import { describe, it, expect, beforeEach } from "vitest";
import { runScrape, type ScrapeJob } from "../src/scrape/runner";
import { StubAdapter } from "../src/adapters/types";
import type { Provider, TeeTime } from "../src/types";
import { TeeTimeSchema, makeTeeTimeId } from "../src/types";

const NOW = 1_700_000_000_000;

function tt(
  provider: Provider,
  providerCourseId: string,
  offsetHrs: number,
): TeeTime {
  return TeeTimeSchema.parse({
    id: makeTeeTimeId(provider, providerCourseId, NOW + offsetHrs * 3600_000),
    provider,
    providerCourseId,
    courseId: `course_${providerCourseId}`,
    timeEpochMs: NOW + offsetHrs * 3600_000,
    playersAvailable: 4,
    bookable: true,
    hotDealPriceCents: 4500,
    rackPriceCents: 12000,
    twilightPriceCents: 3500,
    providerSlotId: `slot-${providerCourseId}-${offsetHrs}`,
    scrapedAt: NOW,
  });
}

/** sleep that resolves immediately — keeps tests fast */
const noSleep = () => Promise.resolve();
const fixedNow = () => NOW;

describe("runScrape", () => {
  beforeEach(() => {});

  it("returns tee times and zero errors on happy path", async () => {
    const golfnow = new StubAdapter({
      id: "golfnow",
      canned: new Map([
        ["c1", [tt("golfnow", "c1", 1), tt("golfnow", "c1", 2)]],
        ["c2", [tt("golfnow", "c2", 3)]],
      ]),
    });
    const jobs: ScrapeJob[] = [
      { provider: "golfnow", providerCourseId: "c1", courseId: "course_c1" },
      { provider: "golfnow", providerCourseId: "c2", courseId: "course_c2" },
    ];
    const result = await runScrape(
      "2026-07-20",
      2,
      "America/Chicago",
      jobs,
      { jitterMs: 0, timeoutMs: 1000, concurrencyPerHost: 1 },
      { resolveAdapter: (id) => (id === "golfnow" ? golfnow : undefined), sleep: noSleep, now: fixedNow },
    );
    expect(result.errors).toEqual([]);
    expect(result.teeTimes).toHaveLength(3);
    expect(result.date).toBe("2026-07-20");
    expect(result.durationMs).toBe(0);
  });

  it("isolates errors: 2 OK + 1 throw still returns 2 results + 1 error", async () => {
    const golfnow = new StubAdapter({
      id: "golfnow",
      canned: new Map([["c1", [tt("golfnow", "c1", 1)]]]),
      error: new Map([["broken", new Error("503 upstream")]]),
    });
    const jobs: ScrapeJob[] = [
      { provider: "golfnow", providerCourseId: "c1", courseId: "course_c1" },
      {
        provider: "golfnow",
        providerCourseId: "broken",
        courseId: "course_broken",
      },
      { provider: "golfnow", providerCourseId: "c2", courseId: "course_c2" }, // empty
    ];
    const result = await runScrape(
      "2026-07-20",
      2,
      "America/Chicago",
      jobs,
      { jitterMs: 0, timeoutMs: 1000 },
      { resolveAdapter: (id) => (id === "golfnow" ? golfnow : undefined), sleep: noSleep, now: fixedNow },
    );
    expect(result.teeTimes).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe("503 upstream");
    expect(result.errors[0]?.courseId).toBe("course_broken");
  });

  it("caps concurrency per host", async () => {
    // Adapter that tracks peak in-flight count.
    let peak = 0;
    let current = 0;
    const tracking = {
      async healthcheck() {
        return { ok: true };
      },
      id: "golfnow" as const,
      name: "tracking",
      async fetchAvailability(id: string) {
        current++;
        peak = Math.max(peak, current);
        await new Promise((r) => setTimeout(r, 30));
        current--;
        return [tt("golfnow", id, 1)];
      },
    };
    const jobs: ScrapeJob[] = Array.from({ length: 5 }, (_, i) => ({
      provider: "golfnow",
      providerCourseId: `c${i}`,
      courseId: `course_c${i}`,
    }));
    await runScrape(
      "2026-07-20",
      2,
      "America/Chicago",
      jobs,
      { concurrencyPerHost: 2, jitterMs: 0, timeoutMs: 1000 },
      { resolveAdapter: () => tracking, sleep: noSleep, now: fixedNow },
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("times out slow adapters and records error", async () => {
    const slow = {
      async healthcheck() {
        return { ok: true };
      },
      id: "golfnow" as const,
      name: "slow",
      async fetchAvailability() {
        await new Promise((r) => setTimeout(r, 100));
        return [tt("golfnow", "c1", 1)];
      },
    };
    const result = await runScrape(
      "2026-07-20",
      2,
      "America/Chicago",
      [{ provider: "golfnow", providerCourseId: "c1", courseId: "course_c1" }],
      { timeoutMs: 20, jitterMs: 0, concurrencyPerHost: 1 },
      { resolveAdapter: () => slow, sleep: noSleep, now: fixedNow },
    );
    expect(result.teeTimes).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/timeout/);
  });

  it("records error when no adapter is registered for a provider", async () => {
    const result = await runScrape(
      "2026-07-20",
      2,
      "America/Chicago",
      [
        {
          provider: "chronogolf",
          providerCourseId: "c1",
          courseId: "course_c1",
        },
      ],
      { jitterMs: 0 },
      { resolveAdapter: () => undefined, sleep: noSleep, now: fixedNow },
    );
    expect(result.teeTimes).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/no adapter/);
  });

  it("stamps courseId on every returned tee time", async () => {
    const golfnow = new StubAdapter({
      id: "golfnow",
      canned: new Map([["c1", [tt("golfnow", "c1", 1)]]]),
    });
    const result = await runScrape(
      "2026-07-20",
      2,
      "America/Chicago",
      [
        {
          provider: "golfnow",
          providerCourseId: "c1",
          courseId: "renamed_canon",
        },
      ],
      { jitterMs: 0 },
      { resolveAdapter: () => golfnow, sleep: noSleep, now: fixedNow },
    );
    expect(result.teeTimes[0]?.courseId).toBe("renamed_canon");
  });
});