import { describe, it, expect } from "vitest";
import { ForeUpAdapter } from "../src/adapters/foreup";
import { InMemoryFetcher } from "../src/adapters/fetcher";

/**
 * Realistic ForeUp response for Tenison Park (provider_course_id "tenison-park").
 * Mix of available and unavailable slots, two sub-courses (Highland + Classic).
 *
 * NB: ForeUp's time field is course-local — we must use the ctx.timezone
 * to convert. These times are 07:00–14:30 CT on 2026-07-20.
 */
const TENISON_PARK_RESPONSE = [
  {
    id: 1001,
    time: "7:00 AM",
    available_spots: 4,
    green_fee: 32,
    cart_fee: 18,
    total: 50,
    holes: 18,
  },
  {
    id: 1002,
    time: "7:30 AM",
    available_spots: 2,
    green_fee: 32,
    cart_fee: 18,
    total: 50,
    holes: 18,
  },
  {
    id: 1003,
    time: "12:00 PM",
    available_spots: 4,
    green_fee: 38,
    cart_fee: 20,
    total: 58,
    holes: 18,
  },
  {
    id: 1004,
    time: "2:30 PM",
    available_spots: 0, // filtered
    green_fee: 28,
    cart_fee: 18,
    total: 46,
    holes: 18,
  },
  {
    id: 1005,
    time: "4:00 PM",
    available_spots: 4,
    green_fee: 25, // twilight
    cart_fee: 18,
    total: 43,
    holes: 18,
  },
];

describe("ForeUpAdapter", () => {
  it("builds POST request with MM/DD/YYYY date format", () => {
    const adapter = new ForeUpAdapter(new InMemoryFetcher().asFetcher());
    const req = adapter.buildRequest("tenison-park", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(req.method).toBe("POST");
    expect(req.url).toMatch(/foreupsoftware\.com/);
    const body = req.body as URLSearchParams;
    expect(body.get("course_id")).toBe("tenison-park");
    expect(body.get("date")).toBe("07/20/2026");
    expect(body.get("players")).toBe("2");
    expect(body.get("mobile")).toBe("1");
  });

  it("parses Tenison Park fixture and converts course-local times to UTC", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/foreupsoftware\.com/, "POST", {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(TENISON_PARK_RESPONSE),
      url: "",
    });
    const adapter = new ForeUpAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("tenison-park", {
      date: "2026-07-20",
      players: 2,
      timezone: "America/Chicago",
    });
    expect(tt).toHaveLength(4); // 1004 filtered
    // 7:00 AM CT on Jul 20, 2026 → 12:00 UTC (CDT = UTC-5)
    const first = tt[0];
    expect(first?.timeEpochMs).toBe(Date.UTC(2026, 6, 20, 12, 0));
    expect(first?.hotDealPriceCents).toBe(5000); // total = 5000 cents ($50)
    expect(first?.rackPriceCents).toBe(3200); // green_fee = 3200 cents ($32)
  });

  it("respects DST (CDT = UTC-5 in July)", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/foreupsoftware\.com/, "POST", {
      status: 200,
      headers: {},
      body: JSON.stringify([
        {
          id: 1,
          time: "6:00 AM",
          available_spots: 4,
          green_fee: 30,
          total: 45,
        },
      ]),
      url: "",
    });
    const adapter = new ForeUpAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("c1", {
      date: "2026-07-04", // summer — CDT
      players: 2,
      timezone: "America/Chicago",
    });
    // 6:00 AM CDT = 11:00 UTC
    expect(tt[0]?.timeEpochMs).toBe(Date.UTC(2026, 6, 4, 11, 0));
  });

  it("respects CST (UTC-6) in January", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/foreupsoftware\.com/, "POST", {
      status: 200,
      headers: {},
      body: JSON.stringify([
        {
          id: 1,
          time: "8:00 AM",
          available_spots: 4,
          green_fee: 30,
        },
      ]),
      url: "",
    });
    const adapter = new ForeUpAdapter(fetcher.asFetcher());
    const tt = await adapter.fetchAvailability("c1", {
      date: "2026-01-15", // winter — CST
      players: 2,
      timezone: "America/Chicago",
    });
    // 8:00 AM CST = 14:00 UTC
    expect(tt[0]?.timeEpochMs).toBe(Date.UTC(2026, 0, 15, 14, 0));
  });

  it("throws on HTML response (Playwright fallback needed)", async () => {
    const fetcher = new InMemoryFetcher();
    fetcher.route(/foreupsoftware\.com/, "POST", {
      status: 200,
      headers: {},
      body: "<html><body>Booking</body></html>",
      url: "",
    });
    const adapter = new ForeUpAdapter(fetcher.asFetcher());
    await expect(
      adapter.fetchAvailability("c1", {
        date: "2026-07-20",
        players: 2,
        timezone: "America/Chicago",
      }),
    ).rejects.toThrow(/non-JSON/);
  });
});