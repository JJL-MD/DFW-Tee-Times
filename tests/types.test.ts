import { describe, it, expect } from "vitest";
import {
  TeeTimeSchema,
  ScheduledBookingSchema,
  VaultEntrySchema,
  VaultCookieSchema,
  makeTeeTimeId,
  makeCanonicalCourseId,
} from "../src/types";

const NOW = 1_700_000_000_000;

describe("TeeTime schema", () => {
  it("round-trips a valid tee time", () => {
    const tt = {
      id: "golfnow:12345:1700000000000",
      provider: "golfnow" as const,
      providerCourseId: "12345",
      courseId: "tpc_craig_ranch",
      timeEpochMs: 1_700_000_000_000,
      playersAvailable: 4,
      bookable: true,
      hotDealPriceCents: 4500,
      rackPriceCents: 12000,
      twilightPriceCents: 3500,
      providerSlotId: "slot-abc",
      scrapedAt: NOW,
    };
    const parsed = TeeTimeSchema.parse(tt);
    expect(parsed.id).toBe(tt.id);
    expect(parsed.bookable).toBe(true);
    expect(parsed.hotDealPriceCents).toBe(4500);
  });

  it("rejects bookable=false", () => {
    const bad = {
      id: "x",
      provider: "golfnow",
      providerCourseId: "1",
      courseId: "c",
      timeEpochMs: NOW,
      playersAvailable: 2,
      bookable: false,
      hotDealPriceCents: null,
      rackPriceCents: null,
      twilightPriceCents: null,
      providerSlotId: "s",
      scrapedAt: NOW,
    };
    // Should still parse — bookable=false is legal
    expect(() => TeeTimeSchema.parse(bad)).not.toThrow();
  });

  it("rejects unknown provider", () => {
    expect(() =>
      TeeTimeSchema.parse({
        id: "x",
        provider: "garbage",
        providerCourseId: "1",
        courseId: "c",
        timeEpochMs: NOW,
        playersAvailable: 2,
        bookable: true,
        hotDealPriceCents: null,
        rackPriceCents: null,
        twilightPriceCents: null,
        providerSlotId: "s",
        scrapedAt: NOW,
      }),
    ).toThrow();
  });
});

describe("ScheduledBooking schema", () => {
  it("parses valid record", () => {
    const sb = {
      id: "sb_1",
      userId: "u1",
      provider: "golfnow" as const,
      providerCourseId: "12345",
      courseId: "tpc_craig_ranch",
      date: "2026-07-20",
      timeWindowStart: "07:00",
      timeWindowEnd: "09:00",
      players: 2,
      maxPriceCents: 8000,
      bookAt: NOW,
      status: "pending" as const,
      attempts: 0,
      lastError: null,
      confirmationCode: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(() => ScheduledBookingSchema.parse(sb)).not.toThrow();
  });

  it("rejects invalid time format", () => {
    const sb = {
      id: "sb_1",
      userId: "u1",
      provider: "golfnow",
      providerCourseId: "12345",
      courseId: "tpc_craig_ranch",
      date: "2026-07-20",
      timeWindowStart: "7am", // bad
      timeWindowEnd: "09:00",
      players: 2,
      maxPriceCents: 8000,
      bookAt: NOW,
      status: "pending",
      attempts: 0,
      lastError: null,
      confirmationCode: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(() => ScheduledBookingSchema.parse(sb)).toThrow();
  });
});

describe("Vault schemas", () => {
  it("parses cookie", () => {
    const c = {
      name: "session",
      value: "abc123",
      domain: ".golfnow.com",
      path: "/",
      expires: 1_900_000_000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    };
    expect(() => VaultCookieSchema.parse(c)).not.toThrow();
  });

  it("parses vault entry", () => {
    const e = {
      id: "v1",
      userId: "u1",
      provider: "golfnow" as const,
      kind: "cookies" as const,
      ciphertext: "base64",
      iv: "base64",
      expiresAt: NOW + 86_400_000,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(() => VaultEntrySchema.parse(e)).not.toThrow();
  });
});

describe("id helpers", () => {
  it("makeTeeTimeId", () => {
    expect(makeTeeTimeId("golfnow", "12345", 1_700_000_000_000)).toBe(
      "golfnow:12345:1700000000000",
    );
  });

  it("makeCanonicalCourseId", () => {
    expect(makeCanonicalCourseId("TPC Craig Ranch")).toBe("tpc_craig_ranch");
    expect(makeCanonicalCourseId("Stevens Park  Golf Club!!")).toBe(
      "stevens_park_golf_club",
    );
  });
});