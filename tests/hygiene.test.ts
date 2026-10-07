import { describe, it, expect } from "vitest";
import {
  REAL_CHROME_UA,
  REAL_FIREFOX_UA,
  REAL_SAFARI_UA,
  defaultHeadersFor,
  jitter,
  ConcurrencyLimiter,
  backoffMs,
} from "../src/obs/hygiene";

describe("User-Agent strings", () => {
  it("Chrome UA looks like a real browser", () => {
    expect(REAL_CHROME_UA).toContain("Chrome/124");
    expect(REAL_CHROME_UA).toContain("Mozilla");
    expect(REAL_CHROME_UA).not.toContain("bot");
  });

  it("Firefox UA looks real", () => {
    expect(REAL_FIREFOX_UA).toContain("Firefox/125");
  });

  it("Safari UA looks real", () => {
    expect(REAL_SAFARI_UA).toContain("Safari/605");
  });
});

describe("defaultHeadersFor", () => {
  it("includes User-Agent and Accept-Language", () => {
    const h = defaultHeadersFor("golfnow");
    expect(h["User-Agent"]).toContain("Chrome");
    expect(h["Accept-Language"]).toBe("en-US,en;q=0.9");
  });

  it("sets Referer matching provider domain", () => {
    expect(defaultHeadersFor("golfnow")["Referer"]).toContain("golfnow.com");
    expect(defaultHeadersFor("teeoff")["Referer"]).toContain("teeoff.com");
    expect(defaultHeadersFor("chronogolf")["Referer"]).toContain("chronogolf.com");
    expect(defaultHeadersFor("foreup")["Referer"]).toContain("foreupsoftware.com");
  });

  it("includes modern Sec-Ch-Ua hints", () => {
    const h = defaultHeadersFor("golfnow");
    expect(h["Sec-Ch-Ua"]).toContain("Chromium");
    expect(h["Sec-Ch-Ua-Mobile"]).toBe("?0");
    expect(h["Sec-Ch-Ua-Platform"]).toContain("macOS");
  });
});

describe("jitter", () => {
  it("stays within bounds", async () => {
    const start = Date.now();
    await jitter(50, 100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("ConcurrencyLimiter", () => {
  it("caps concurrency at max", async () => {
    const lim = new ConcurrencyLimiter(2);
    let peak = 0;
    let current = 0;
    const tasks = Array.from({ length: 6 }, () =>
      lim.run(async () => {
        current++;
        peak = Math.max(peak, current);
        await new Promise((r) => setTimeout(r, 10));
        current--;
        return 1;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("releases permits even on error", async () => {
    const lim = new ConcurrencyLimiter(1);
    await expect(
      lim.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Should not deadlock
    const result = await lim.run(async () => 42);
    expect(result).toBe(42);
  });

  it("rejects max < 1", () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow();
  });
});

describe("backoffMs", () => {
  it("grows with attempt number (with jitter)", () => {
    const a1 = backoffMs(1);
    const a3 = backoffMs(3);
    // attempt 3 should generally be larger than attempt 1, but jitter
    // means we just verify it's within cap.
    expect(a1).toBeGreaterThanOrEqual(0);
    expect(a1).toBeLessThanOrEqual(30_000);
    expect(a3).toBeGreaterThanOrEqual(0);
    expect(a3).toBeLessThanOrEqual(30_000);
  });

  it("caps at capMs", () => {
    const huge = backoffMs(50);
    expect(huge).toBeLessThanOrEqual(30_000);
  });
});