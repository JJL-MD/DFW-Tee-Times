import { describe, it, expect } from "vitest";
import {
  captureShape,
  checkDrift,
  extractSlots,
  diffShapes,
  type ProviderSnapshot,
} from "../src/obs/drift";

describe("captureShape", () => {
  it("captures object key set", () => {
    const shape = captureShape({ a: 1, b: "x", c: true });
    expect(shape.kind).toBe("object");
    expect(shape.keys).toEqual(["a", "b", "c"]);
  });

  it("captures null", () => {
    expect(captureShape(null).kind).toBe("null");
    expect(captureShape(undefined).kind).toBe("null");
  });

  it("captures primitives", () => {
    expect(captureShape("x").kind).toBe("string");
    expect(captureShape(42).kind).toBe("number");
    expect(captureShape(true).kind).toBe("boolean");
  });

  it("captures array + item shape", () => {
    const shape = captureShape([{ id: "a" }, { id: "b" }]);
    expect(shape.kind).toBe("array");
    expect(shape.itemShape?.kind).toBe("object");
    expect(shape.itemShape?.keys).toEqual(["id"]);
  });
});

describe("extractSlots", () => {
  it("golfnow: response.teeTimes", () => {
    expect(extractSlots("golfnow", { teeTimes: [1, 2] })).toEqual([1, 2]);
  });
  it("teeoff: response.results", () => {
    expect(extractSlots("teeoff", { results: [1] })).toEqual([1]);
  });
  it("chronogolf: response.items", () => {
    expect(extractSlots("chronogolf", { items: [1] })).toEqual([1]);
  });
  it("foreup: top-level array", () => {
    expect(extractSlots("foreup", [1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("unknown: returns []", () => {
    expect(extractSlots("unknown", { something: 1 })).toEqual([]);
  });
});

describe("diffShapes", () => {
  it("detects added keys", () => {
    const before = captureShape({ a: 1 });
    const after = captureShape({ a: 1, b: 2 });
    const diff = diffShapes(before, after);
    expect(diff.added).toEqual(["b"]);
    expect(diff.removed).toEqual([]);
  });

  it("detects removed keys", () => {
    const before = captureShape({ a: 1, b: 2 });
    const after = captureShape({ a: 1 });
    const diff = diffShapes(before, after);
    expect(diff.removed).toEqual(["b"]);
  });

  it("detects type changes", () => {
    const before = captureShape({ a: "x" });
    const after = captureShape({ a: { nested: 1 } });
    const diff = diffShapes(before, after);
    expect(diff.changed).toEqual([{ key: "a", before: "string", after: "object" }]);
  });

  it("uses array indexing in path for nested arrays", () => {
    const before = captureShape([{ id: 1 }]);
    const after = captureShape([{ id: 1, name: "x" }]);
    const diff = diffShapes(before, after);
    expect(diff.added).toEqual(["[].name"]);
  });

  it("no drift for identical shapes", () => {
    const before = captureShape({ a: 1, b: "x" });
    const after = captureShape({ a: 99, b: "y" });
    const diff = diffShapes(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});

describe("checkDrift", () => {
  const snapshot: ProviderSnapshot = {
    provider: "golfnow",
    recordedAt: Date.now(),
    responseShape: captureShape({
      teeTimes: [
        { id: "1", isBookableOnline: true, rates: [{ type: "HotDeal", greenFee: 4500 }] },
      ],
    }),
    slotShape: captureShape({
      id: "1",
      isBookableOnline: true,
      rates: [{ type: "HotDeal", greenFee: 4500 }],
    }),
  };

  it("no drift when response matches snapshot", () => {
    const drift = checkDrift(snapshot, {
      teeTimes: [{ id: "2", isBookableOnline: true, rates: [{ type: "Regular", greenFee: 5000 }] }],
    });
    expect(drift.hasDrift).toBe(false);
  });

  it("detects new field on slot", () => {
    const drift = checkDrift(snapshot, {
      teeTimes: [{ id: "2", isBookableOnline: true, newField: "x", rates: [] }],
    });
    expect(drift.hasDrift).toBe(true);
    expect(drift.addedKeys).toContain("newField");
  });

  it("detects removed field", () => {
    const drift = checkDrift(snapshot, {
      teeTimes: [{ id: "2", rates: [] }],
    });
    expect(drift.hasDrift).toBe(true);
    expect(drift.removedKeys).toContain("isBookableOnline");
  });
});