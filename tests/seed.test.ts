import { describe, it, expect } from "vitest";
import { DFW_COURSES, buildSeedRows } from "../src/seed/dfw-courses";
import { PROVIDERS } from "../src/types";

describe("DFW course catalog seed", () => {
  it("has at least 40 courses", () => {
    expect(DFW_COURSES.length).toBeGreaterThanOrEqual(40);
  });

  it("every course has a unique canonical id", () => {
    const ids = new Set(DFW_COURSES.map((c) => c.id));
    expect(ids.size).toBe(DFW_COURSES.length);
  });

  it("every course has a known default provider", () => {
    const set = new Set<string>(PROVIDERS);
    for (const c of DFW_COURSES) {
      expect(set.has(c.defaultProvider)).toBe(true);
    }
  });

  it("every course has at least one provider id", () => {
    for (const c of DFW_COURSES) {
      expect(Object.keys(c.providerIds).length).toBeGreaterThan(0);
    }
  });

  it("default provider has a corresponding providerIds entry", () => {
    for (const c of DFW_COURSES) {
      expect(c.providerIds[c.defaultProvider]).toBeTruthy();
    }
  });

  it("coordinates are within plausible DFW bounds", () => {
    // DFW metro bbox (extended): lat 29–34 (covers Lake Jackson to Southlake),
    // lon -98.5 to -95.5 (covers Weatherford to Mabank/Rockwall).
    for (const c of DFW_COURSES) {
      expect(c.lat).toBeGreaterThan(29);
      expect(c.lat).toBeLessThan(34);
      expect(c.lon).toBeGreaterThan(-98.5);
      expect(c.lon).toBeLessThan(-95.5);
    }
  });

  it("buildSeedRows returns aligned course + courseProviders lists", () => {
    const { courses, courseProviders } = buildSeedRows(12345);
    const courseIds = new Set(courses.map((c) => c.id));
    expect(courseIds.size).toBe(DFW_COURSES.length);
    for (const cp of courseProviders) {
      expect(courseIds.has(cp.courseId)).toBe(true);
    }
    expect(courses[0]?.created_at).toBe(12345);
  });

  it("includes the 9 priority courses the user called out", () => {
    const ids = new Set(DFW_COURSES.map((c) => c.id));
    for (const id of [
      "tenison_park",
      "sherrill_park",
      "cedar_crest",
      "firewheel",
      "watters_creek",
      "heritage_ranch",
      "texas_rangers",
      "coyote_ridge",
      "indian_creek",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("marks preferred sub-courses for multi-course venues", () => {
    const byId = new Map(DFW_COURSES.map((c) => [c.id, c]));
    expect(byId.get("tenison_park")?.preferredSubCourse).toBe("Highland");
    expect(byId.get("tenison_park")?.subCourses).toContain("Highland");
    expect(byId.get("sherrill_park")?.preferredSubCourse).toBe("Course 1");
    expect(byId.get("sherrill_park")?.subCourses).toEqual([
      "Course 1",
      "Course 2",
    ]);
    expect(byId.get("firewheel")?.preferredSubCourse).toBe("Bridges");
    expect(byId.get("firewheel")?.subCourses).toContain("Bridges");
  });
});