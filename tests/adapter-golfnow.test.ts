import { describe, it, expect } from "vitest";
import { GolfNowAdapter } from "../src/adapters/golfnow";
import { InMemoryFetcher } from "../src/adapters/fetcher";

/**
 * Fixture for Stevens Park (GolfNow placeholder courseId "PLACEHOLDER_STEVENS_PARK").
 * 6 tee times across early/mid/twilight, mix of hot-deal and regular rates.
 */
const STEVENS_PARK_RESPONSE = {
  teeTimes: [
    {
      id: "gn-001",
      courseId: 12345,
      teeTimeEpochMs: Date.UTC(2026, 6, 20, 13, 0), // 8:00am CT
      playersAvailable: 4,
      maxPlayers: 4,
      isAvailable: true,
      isBookableOnline: true,
      rates: [{ type: "HotDeal", greenFee: 4500 }],
      holes: 18,
      subCourseName: "Main",
    },
    {
      id: "gn-002",
      courseId: 12345,
      teeTimeEpochMs: Date.UTC(2026, 6, 20, 15, 0), // 10:00am CT
      playersAvailable: 2,
      maxPlayers: 4,
      isAvailable: true,
      isBookableOnline: true,
      rates: [{ type: "Regular", greenFee: 8500 }],
      holes: 18,
    },
    {
      id: "gn-003",
      courseId: 12345,
      teeTimeEpochMs: Date.UTC(2026, 6, 20, 19, 0), // 2:00pm CT (twilight)
      playersAvailable: 4,
      maxPlayers: 4,
      isAvailable: true,
      isBookableOnline: true,
      rates: [{ type: "Twilight", greenFee: 3500 }],
      holes: 18,
    },
    {
      id: "gn-004",
      courseId: 12345,
      teeTimeEpochMs: Date.UTC(2026, 6, 20, 20, 0),
      playersAvailable: 0, // sold out — should be filtered
      maxPlayers: 4,
      isAvailable: false,
      isBookableOnline: false,
      rates: [{ type: "Regular", greenFee: 8500 }],
      holes: 18,
    },
    {
      id: "gn-005",
      courseId: 12345,
      teeTimeEpochMs: Date.UTC(2026, 6, 20, 21, 0),
      playersAvailable: 4,
      maxPlayers: 4,
      isAvailable: true,
      isBookableOnline: true,
      rates: [], // no price
      holes: 18,
    },
    {
      id: "gn-006",
      courseId: 12345,
      teeTimeEpochMs: Date.UTC(2026, 6, 20, 22, 0), // hot deal + regular
      playersAvailable: 3,
      maxPlayers: 4,
      isAvailable: true,
      isBookableOnline: true,
      rates: [
        { type: "HotDeal", greenFee: 4200 },
        { type: "Regular", greenFee: 9000 },
      ],
      holes: 18,
    },
  ],
  facility: { id: 12345, name: "Stevens Park Golf Course", timezone: "America/Chicago" },
};

describe("GolfNowAdapter", () => {
  it("builds the correct search URL", () => {
    const fetcher = new InMemoryFetcher();
    const adapter = new GolfNowAdapter(fetcher.asFetcher());
    const req = adapter.buildRequest("12345", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(req.url).toMatch(/golfnow\.com/);
    expect(req.url).toContain("courseId=12345");
    expect(req.url).toContain("date=2026-07-20");
    expect(req.url).toContain("players=2");
  });

  it("parses a realistic fixture", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/golfnow\.com/, "GET", {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(STEVENS_PARK_RESPONSE),
      url: "https://www.golfnow.com/api/tee-times/tee-times",
    });
    const adapter = new GolfNowAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("12345", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    // Sold-out slot 004 should be filtered
    expect(tt).toHaveLength(5);
    expect(tt.find((t) => t.providerSlotId === "gn-004")).toBeUndefined();
  });

  it("captures hot-deal, rack, and twilight prices", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/golfnow\.com/, "GET", {
      status: 200,
      headers: {},
      body: JSON.stringify(STEVENS_PARK_RESPONSE),
      url: "",
    });
    const adapter = new GolfNowAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("12345", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    const hotDeal = tt.find((t) => t.providerSlotId === "gn-001");
    expect(hotDeal?.hotDealPriceCents).toBe(4500);
    expect(hotDeal?.rackPriceCents).toBeNull();

    const twilight = tt.find((t) => t.providerSlotId === "gn-003");
    expect(twilight?.twilightPriceCents).toBe(3500);

    const both = tt.find((t) => t.providerSlotId === "gn-006");
    expect(both?.hotDealPriceCents).toBe(4200);
    expect(both?.rackPriceCents).toBe(9000);
  });

  it("returns [] when response has no tee times", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/golfnow\.com/, "GET", {
      status: 200,
      headers: {},
      body: JSON.stringify({ teeTimes: [] }),
      url: "",
    });
    const adapter = new GolfNowAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("nope", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt).toEqual([]);
  });

  it("throws on non-2xx", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/golfnow\.com/, "GET", {
      status: 403,
      headers: {},
      body: "forbidden",
      url: "",
    });
    const adapter = new GolfNowAdapter(fetcher.asFetcher());
    await expect(
      adapter.fetchAvailability("12345", {
        date: "2026-07-20",
        players: 2,
        timezone: "America/Chicago",
      }),
    ).rejects.toThrow(/403/);
  });

  it("handles ISO date format as fallback", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/golfnow\.com/, "GET", {
      status: 200,
      headers: {},
      body: JSON.stringify({
        teeTimes: [
          {
            id: "iso-1",
            teeTime: "2026-07-20T13:00:00Z",
            isBookableOnline: true,
            playersAvailable: 4,
            rates: [{ type: "HotDeal", greenFee: 4500 }],
          },
        ],
      }),
      url: "",
    });
    const adapter = new GolfNowAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("c1", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt[0]?.timeEpochMs).toBe(Date.UTC(2026, 6, 20, 13, 0));
  });
});