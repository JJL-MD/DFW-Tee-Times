import { describe, it, expect } from "vitest";
import {
  clearAdapters,
  getAdapter,
  listAdapters,
  registerAdapter,
} from "../src/adapters";
import { StubAdapter } from "../src/adapters/types";
import { TeeTimeSchema, makeTeeTimeId } from "../src/types";
import type { TeeTime } from "../src/types";

const NOW = 1_700_000_000_000;

function sampleTeeTime(providerCourseId: string, offsetHrs: number): TeeTime {
  return TeeTimeSchema.parse({
    id: makeTeeTimeId("golfnow", providerCourseId, NOW + offsetHrs * 3600_000),
    provider: "golfnow",
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

describe("adapter registry", () => {
  it("register / get / list / clear", () => {
    clearAdapters();
    const a = new StubAdapter({ id: "golfnow", name: "GolfNow Test" });
    const b = new StubAdapter({ id: "teeoff", name: "TeeOff Test" });
    registerAdapter(a);
    registerAdapter(b);
    expect(listAdapters()).toHaveLength(2);
    expect(getAdapter("golfnow")).toBe(a);
    expect(getAdapter("teeoff")).toBe(b);
    expect(getAdapter("chronogolf")).toBeUndefined();
    clearAdapters();
    expect(listAdapters()).toHaveLength(0);
  });
});

describe("StubAdapter", () => {
  it("returns [] for unknown course", async () => {
    const a = new StubAdapter({ id: "golfnow" });
    const tt = await a.fetchAvailability("does-not-exist", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt).toEqual([]);
  });

  it("returns canned data for known course", async () => {
    const canned = new Map<string, TeeTime[]>();
    canned.set("12345", [sampleTeeTime("12345", 1), sampleTeeTime("12345", 3)]);
    const a = new StubAdapter({ id: "golfnow", canned });
    const tt = await a.fetchAvailability("12345", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt).toHaveLength(2);
    expect(tt[0]?.providerCourseId).toBe("12345");
  });

  it("throws when configured to error", async () => {
    const errs = new Map<string, Error>();
    errs.set("broken", new Error("simulated upstream 503"));
    const a = new StubAdapter({ id: "golfnow", error: errs });
    await expect(
      a.fetchAvailability("broken", {
        date: "2026-07-20",
        players: 2,
        timezone: "America/Chicago",
      }),
    ).rejects.toThrow("simulated upstream 503");
  });

  it("healthcheck returns ok by default", async () => {
    const a = new StubAdapter({ id: "golfnow" });
    await expect(a.healthcheck()).resolves.toEqual({ ok: true });
  });
});