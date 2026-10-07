import { describe, it, expect } from "vitest";
import { TeeOffAdapter } from "../src/adapters/teeoff";
import { InMemoryFetcher } from "../src/adapters/fetcher";

const TPC_CRAIG_RANCH_RESPONSE = {
  results: [
    {
      teeOffSlotId: "to-001",
      facilityId: 99999,
      startTime: "2026-07-20T13:00:00Z",
      playersAvailable: 4,
      bookable: true,
      rates: [
        { type: "Regular", amount: 25000 }, // $250 rack
      ],
    },
    {
      teeOffSlotId: "to-002",
      facilityId: 99999,
      startTime: "2026-07-20T14:30:00Z",
      playersAvailable: 2,
      bookable: true,
      rates: [
        { type: "Hot Deal", amount: 19500 },
        { type: "Regular", amount: 25000 },
      ],
    },
    {
      id: "to-003", // uses `id` instead of `teeOffSlotId`
      facilityId: 99999,
      startTime: "2026-07-20T19:00:00Z",
      playersAvailable: 4,
      isAvailable: true,
      rates: [{ type: "Twilight", amount: 14500 }],
    },
    {
      // unavailable — filtered
      teeOffSlotId: "to-004",
      facilityId: 99999,
      startTime: "2026-07-20T20:00:00Z",
      playersAvailable: 0,
      bookable: false,
    },
  ],
};

describe("TeeOffAdapter", () => {
  it("builds the search URL with facilityId", () => {
    const adapter = new TeeOffAdapter(new InMemoryFetcher().asFetcher());
    const req = adapter.buildRequest("99999", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(req.url).toMatch(/teeoff\.com/);
    expect(req.url).toContain("facilityId=99999");
    expect(req.url).toContain("date=2026-07-20");
  });

  it("parses TPC Craig Ranch fixture", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/teeoff\.com/, "GET", {
      status: 200,
      headers: {},
      body: JSON.stringify(TPC_CRAIG_RANCH_RESPONSE),
      url: "",
    });
    const adapter = new TeeOffAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("99999", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt).toHaveLength(3); // to-004 filtered
    const hotDeal = tt.find((t) => t.providerSlotId === "to-002");
    expect(hotDeal?.hotDealPriceCents).toBe(19500);
    expect(hotDeal?.rackPriceCents).toBe(25000);
  });

  it("falls back to `id` field when `teeOffSlotId` missing", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/teeoff\.com/, "GET", {
      status: 200,
      headers: {},
      body: JSON.stringify(TPC_CRAIG_RANCH_RESPONSE),
      url: "",
    });
    const adapter = new TeeOffAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("99999", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt.find((t) => t.providerSlotId === "to-003")).toBeDefined();
  });
});