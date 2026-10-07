import { describe, it, expect, beforeEach } from "vitest";
import { TeeTimeCache } from "../src/cache/tee-time-cache";
import { TeeTimeSchema, makeTeeTimeId } from "../src/types";
import type { TeeTime } from "../src/types";

function makeKV(): KVNamespace & {
  _data: Map<string, string>;
  _ttls: Map<string, number>;
} {
  const data = new Map<string, string>();
  const ttls = new Map<string, number>();
  const kv = {
    _data: data,
    _ttls: ttls,
    async get(key: string, type?: "json" | "text") {
      const v = data.get(key);
      if (v == null) return null;
      if (type === "json") return JSON.parse(v);
      return v;
    },
    async put(
      key: string,
      value: string,
      opts?: { expirationTtl?: number },
    ) {
      data.set(key, value);
      ttls.set(key, opts?.expirationTtl ?? 0);
    },
    async delete(key: string) {
      data.delete(key);
      ttls.delete(key);
    },
    async list() {
      return {
        keys: Array.from(data.keys()).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
  };
  return kv as unknown as KVNamespace & {
    _data: Map<string, string>;
    _ttls: Map<string, number>;
  };
}

const NOW_MS = 1_700_000_000_000;
function teeTime(provider: string, courseId: string, offsetHrs: number): TeeTime {
  return TeeTimeSchema.parse({
    id: makeTeeTimeId(
      provider as TeeTime["provider"],
      courseId,
      NOW_MS + offsetHrs * 3600_000,
    ),
    provider: provider as TeeTime["provider"],
    providerCourseId: courseId,
    courseId,
    timeEpochMs: NOW_MS + offsetHrs * 3600_000,
    playersAvailable: 4,
    bookable: true,
    hotDealPriceCents: 4500,
    rackPriceCents: 12000,
    twilightPriceCents: 3500,
    providerSlotId: `s-${courseId}-${offsetHrs}`,
    scrapedAt: NOW_MS,
  });
}

describe("TeeTimeCache", () => {
  let kv: ReturnType<typeof makeKV>;
  let cache: TeeTimeCache;

  beforeEach(() => {
    kv = makeKV();
    cache = new TeeTimeCache(kv, {
      freshSeconds: 600,
      staleSeconds: 1800,
      now: () => Math.floor(NOW_MS / 1000),
    });
  });

  it("key format", () => {
    expect(TeeTimeCache.key("golfnow", "12345", "2026-07-20")).toBe(
      "tt:golfnow:12345:2026-07-20",
    );
  });

  it("miss returns empty + not stale", async () => {
    const r = await cache.get("golfnow", "12345", "2026-07-20");
    expect(r.hit).toBe(false);
    expect(r.stale).toBe(false);
    expect(r.teeTimes).toEqual([]);
    expect(r.ageSeconds).toBe(Infinity);
  });

  it("fresh hit returns tee times + not stale", async () => {
    await cache.set("golfnow", "12345", "2026-07-20", [
      teeTime("golfnow", "12345", 1),
    ]);
    const r = await cache.get("golfnow", "12345", "2026-07-20");
    expect(r.hit).toBe(true);
    expect(r.stale).toBe(false);
    expect(r.teeTimes).toHaveLength(1);
    expect(r.ageSeconds).toBe(0);
  });

  it("stale hit between freshSeconds and staleSeconds", async () => {
    await cache.set("golfnow", "12345", "2026-07-20", [
      teeTime("golfnow", "12345", 1),
    ]);
    // Move "now" forward 700s (past fresh=600, within stale=1800)
    cache = new TeeTimeCache(kv, {
      freshSeconds: 600,
      staleSeconds: 1800,
      now: () => Math.floor(NOW_MS / 1000) + 700,
    });
    const r = await cache.get("golfnow", "12345", "2026-07-20");
    expect(r.hit).toBe(true);
    expect(r.stale).toBe(true);
    expect(r.teeTimes).toHaveLength(1);
    expect(r.ageSeconds).toBe(700);
  });

  it("past stale window = miss but still exposes scrapedAt", async () => {
    await cache.set("golfnow", "12345", "2026-07-20", [
      teeTime("golfnow", "12345", 1),
    ]);
    cache = new TeeTimeCache(kv, {
      freshSeconds: 600,
      staleSeconds: 1800,
      now: () => Math.floor(NOW_MS / 1000) + 5000,
    });
    const r = await cache.get("golfnow", "12345", "2026-07-20");
    expect(r.hit).toBe(false);
    expect(r.stale).toBe(false);
    expect(r.scrapedAt).toBe(NOW_MS);
  });

  it("delete removes the entry", async () => {
    await cache.set("golfnow", "12345", "2026-07-20", [
      teeTime("golfnow", "12345", 1),
    ]);
    await cache.delete("golfnow", "12345", "2026-07-20");
    const r = await cache.get("golfnow", "12345", "2026-07-20");
    expect(r.hit).toBe(false);
  });

  it("different (provider, course, date) keys don't collide", async () => {
    await cache.set("golfnow", "c1", "2026-07-20", [teeTime("golfnow", "c1", 1)]);
    await cache.set("golfnow", "c2", "2026-07-20", [teeTime("golfnow", "c2", 2)]);
    await cache.set("teeoff", "c1", "2026-07-20", [teeTime("teeoff", "c1", 3)]);
    await cache.set("golfnow", "c1", "2026-07-21", [teeTime("golfnow", "c1", 4)]);
    expect(kv._data.size).toBe(4);
    const r1 = await cache.get("golfnow", "c1", "2026-07-20");
    const r2 = await cache.get("golfnow", "c2", "2026-07-20");
    const r3 = await cache.get("teeoff", "c1", "2026-07-20");
    const r4 = await cache.get("golfnow", "c1", "2026-07-21");
    expect(r1.teeTimes[0]?.timeEpochMs).toBe(NOW_MS + 1 * 3600_000);
    expect(r2.teeTimes[0]?.timeEpochMs).toBe(NOW_MS + 2 * 3600_000);
    expect(r3.teeTimes[0]?.timeEpochMs).toBe(NOW_MS + 3 * 3600_000);
    expect(r4.teeTimes[0]?.timeEpochMs).toBe(NOW_MS + 4 * 3600_000);
  });

  it("rejects invalid tee times on set", async () => {
    await expect(
      cache.set("golfnow", "12345", "2026-07-20", [
        // missing required fields
        { id: "x" } as unknown as TeeTime,
      ]),
    ).rejects.toThrow();
  });

  it("set writes with KV TTL = staleSeconds + 60", async () => {
    await cache.set("golfnow", "12345", "2026-07-20", [
      teeTime("golfnow", "12345", 1),
    ]);
    expect(kv._ttls.get("tt:golfnow:12345:2026-07-20")).toBe(1800 + 60);
  });
});