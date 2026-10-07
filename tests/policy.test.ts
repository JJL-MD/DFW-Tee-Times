import { describe, it, expect } from "vitest";
import {
  PolicyStore,
  enforceBookingPolicy,
  PolicyViolation,
} from "../src/security/policy";

describe("PolicyStore", () => {
  it("defaults all providers to personal_read_only", () => {
    const s = new PolicyStore();
    for (const p of [
      "golfnow",
      "teeoff",
      "chronogolf",
      "foreup",
      "miclub",
    ]) {
      expect(s.allow(p)).toBe(false);
      expect(s.get(p)).toBe("personal_read_only");
    }
  });

  it("respects overrides", () => {
    const s = new PolicyStore({ golfnow: "auto_book_allowed" });
    expect(s.allow("golfnow")).toBe(true);
    expect(s.allow("teeoff")).toBe(false);
  });

  it("list returns current policy per provider", () => {
    const s = new PolicyStore({ chronogolf: "auto_book_allowed" });
    const list = s.list();
    expect(list).toContainEqual({
      provider: "chronogolf",
      policy: "auto_book_allowed",
    });
  });

  it("set updates policy at runtime", () => {
    const s = new PolicyStore();
    s.set("foreup", "auto_book_allowed");
    expect(s.allow("foreup")).toBe(true);
  });

  it("treats unknown providers as read-only", () => {
    const s = new PolicyStore();
    expect(s.allow("nonexistent_provider")).toBe(false);
  });
});

describe("enforceBookingPolicy", () => {
  it("does not throw for allowed providers", () => {
    const s = new PolicyStore({ golfnow: "auto_book_allowed" });
    expect(() => enforceBookingPolicy(s, "golfnow")).not.toThrow();
  });

  it("throws PolicyViolation for disallowed providers", () => {
    const s = new PolicyStore();
    expect(() => enforceBookingPolicy(s, "golfnow")).toThrow(PolicyViolation);
  });

  it("error message names the provider and policy", () => {
    const s = new PolicyStore();
    try {
      enforceBookingPolicy(s, "foreup");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolation);
      expect((err as PolicyViolation).provider).toBe("foreup");
      expect((err as PolicyViolation).policy).toBe("personal_read_only");
      expect((err as Error).message).toMatch(/foreup/);
      expect((err as Error).message).toMatch(/personal_read_only/);
    }
  });
});