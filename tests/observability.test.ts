import { describe, it, expect, beforeEach } from "vitest";
import { Observability } from "../src/obs/observability";
import type { AnalyticsEngineDataset } from "../src/obs/observability";

function makeAE(): AnalyticsEngineDataset & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    writeDataPoint(ev) {
      written.push(ev);
    },
  };
}

describe("Observability", () => {
  let ae: ReturnType<typeof makeAE>;
  let obs: Observability;

  beforeEach(() => {
    ae = makeAE();
    obs = new Observability(ae);
  });

  it("emits a structured event when bound", () => {
    obs.emit({
      type: "scrape",
      outcome: "ok",
      provider: "golfnow",
      courseId: "stevens_park",
      durationMs: 432,
      teeTimeCount: 12,
    });
    expect(ae.written).toHaveLength(1);
    const ev = ae.written[0] as { blobs: string[]; doubles: number[]; indexes: string[] };
    expect(ev.blobs[0]).toBe("golfnow");
    expect(ev.blobs[1]).toBe("scrape");
    expect(ev.blobs[2]).toBe("ok");
    expect(ev.blobs[3]).toBe("stevens_park");
    expect(ev.blobs[4]).toBe("golfnow:stevens_park");
    expect(ev.doubles[0]).toBe(432);
    expect(ev.doubles[2]).toBe(12);
    expect(ev.indexes).toEqual(["scrape", "golfnow"]);
  });

  it("silent when no AE bound", () => {
    const silent = Observability.noop;
    expect(() =>
      silent.emit({ type: "book", outcome: "ok", provider: "golfnow" }),
    ).not.toThrow();
  });

  it("pads blobs to 8 and doubles to 8", () => {
    obs.emit({ type: "daemon", outcome: "skip" });
    const ev = ae.written[0] as { blobs: string[]; doubles: number[] };
    expect(ev.blobs).toHaveLength(8);
    expect(ev.doubles).toHaveLength(8);
  });

  it("timed() records duration on success", async () => {
    const result = await obs.timed(
      "scrape",
      "ok",
      "foreup",
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return "value";
      },
    );
    expect(result).toBe("value");
    expect(ae.written).toHaveLength(1);
    const ev = ae.written[0] as { blobs: string[]; doubles: number[] };
    expect(ev.doubles[0]).toBeGreaterThanOrEqual(4);
    expect(ev.blobs[2]).toBe("ok");
  });

  it("timed() emits fail event and rethrows on error", async () => {
    await expect(
      obs.timed("book", "ok", "golfnow", async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");
    expect(ae.written).toHaveLength(1);
    const ev = ae.written[0] as { blobs: string[]; doubles: number[] };
    expect(ev.blobs[2]).toBe("fail");
  });
});