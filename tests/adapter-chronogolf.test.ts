import { describe, it, expect } from "vitest";
import { ChronogolfAdapter } from "../src/adapters/chronogolf";
import { InMemoryFetcher } from "../src/adapters/fetcher";

const WATTERS_CREEK_RESPONSE = {
  items: [
    {
      id: "cg-001",
      courseId: "watters-creek",
      startsAt: "2026-07-20T13:00:00Z",
      playersAvailable: 4,
      priceCents: 6500,
      currency: "USD",
      bookable: true,
      subCourse: "Plano Legacy",
    },
    {
      id: "cg-002",
      courseId: "watters-creek",
      startsAt: "2026-07-20T17:00:00Z",
      playersAvailable: 2,
      priceCents: 4500,
      currency: "USD",
      bookable: true,
    },
    {
      id: "cg-003",
      courseId: "watters-creek",
      startsAt: "2026-07-20T20:00:00Z",
      playersAvailable: 4,
      priceCents: 3500,
      bookable: false, // filtered
    },
  ],
};

describe("ChronogolfAdapter", () => {
  it("builds search URL with course slug", () => {
    const adapter = new ChronogolfAdapter(new InMemoryFetcher().asFetcher());
    const req = adapter.buildRequest("watters-creek", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(req.url).toMatch(/chronogolf\.com/);
    expect(req.url).toContain("course=watters-creek");
  });

  it("parses Watters Creek fixture", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/chronogolf\.com/, "GET", {
      status: 200,
      headers: {},
      body: JSON.stringify(WATTERS_CREEK_RESPONSE),
      url: "",
    });
    const adapter = new ChronogolfAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("watters-creek", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt).toHaveLength(2); // cg-003 filtered
    expect(tt[0]?.hotDealPriceCents).toBe(6500);
    expect(tt[0]?.timeEpochMs).toBe(Date.UTC(2026, 6, 20, 13, 0));
  });

  it("returns [] on empty results", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/chronogolf\.com/, "GET", {
      status: 200,
      headers: {},
      body: JSON.stringify({ items: [] }),
      url: "",
    });
    const adapter = new ChronogolfAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("watters-creek", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt).toEqual([]);
  });
});