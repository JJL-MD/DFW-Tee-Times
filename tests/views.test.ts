import { describe, it, expect } from "vitest";
import { renderHome } from "../src/views/home";
import { renderResults, type ResultsRow } from "../src/views/results";
import { DFW_COURSES } from "../src/seed/dfw-courses";
import { TeeTimeSchema, makeTeeTimeId } from "../src/types";
import type { TeeTime } from "../src/types";

const NOW = 1_700_000_000_000;
function makeTt(provider: string, courseId: string, offsetMs: number): TeeTime {
  return TeeTimeSchema.parse({
    id: makeTeeTimeId(
      provider as TeeTime["provider"],
      courseId,
      NOW + offsetMs,
    ),
    provider: provider as TeeTime["provider"],
    providerCourseId: courseId,
    courseId,
    timeEpochMs: NOW + offsetMs,
    playersAvailable: 4,
    bookable: true,
    hotDealPriceCents: 4500,
    rackPriceCents: 12000,
    twilightPriceCents: 3500,
    providerSlotId: "s",
    scrapedAt: NOW,
  });
}

describe("renderHome", () => {
  it("renders the search form with catalog count", () => {
    const html = renderHome();
    expect(html).toContain("Find tee times across DFW");
    expect(html).toContain(`${DFW_COURSES.length} courses in the catalog`);
    expect(html).toMatch(/<select[^>]+name="date"/);
    expect(html).toMatch(/<select[^>]+name="players"/);
    expect(html).toMatch(/<select[^>]+name="courseId"/);
    expect(html).toMatch(/hx-get="\/search"/);
  });

  it("includes the 9 priority courses in the dropdown", () => {
    const html = renderHome();
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
      expect(html).toContain(`value="${id}"`);
    }
  });

  it("renders default max price of $50 selected", () => {
    const html = renderHome();
    expect(html).toMatch(/value="5000"[^>]*selected/);
  });
});

describe("renderResults", () => {
  it("empty state when no rows", () => {
    const html = renderResults({
      date: "2026-07-20",
      players: 2,
      rows: [],
      from: "06:00",
      to: "20:00",
      maxPriceCents: 5000,
    });
    expect(html).toContain("No tee times matched");
  });

  it("renders rows sorted by time ascending", () => {
    const rows: ResultsRow[] = [
      {
        teeTime: makeTt("golfnow", "stevens_park", 3 * 3600_000),
        course: DFW_COURSES.find((c) => c.id === "stevens_park"),
      },
      {
        teeTime: makeTt("foreup", "tenison_park", 1 * 3600_000),
        course: DFW_COURSES.find((c) => c.id === "tenison_park"),
      },
    ];
    const html = renderResults({
      date: "2026-07-20",
      players: 2,
      rows,
      from: "06:00",
      to: "20:00",
      maxPriceCents: null,
    });
    // Tenison (1hr) should appear before Stevens (3hr)
    const tenIdx = html.indexOf("Tenison Park");
    const stevIdx = html.indexOf("Stevens Park");
    expect(tenIdx).toBeGreaterThan(-1);
    expect(stevIdx).toBeGreaterThan(tenIdx);
  });

  it("links each row to /book/{id}", () => {
    const tt = makeTt("golfnow", "stevens_park", 1 * 3600_000);
    const html = renderResults({
      date: "2026-07-20",
      players: 2,
      rows: [{ teeTime: tt, course: DFW_COURSES[0] }],
      from: "06:00",
      to: "20:00",
      maxPriceCents: null,
    });
    expect(html).toContain(`/book/${encodeURIComponent(tt.id)}`);
  });

  it("shows hot-deal price in green when present", () => {
    const rows: ResultsRow[] = [
      {
        teeTime: makeTt("golfnow", "stevens_park", 1 * 3600_000),
        course: DFW_COURSES[0],
      },
    ];
    const html = renderResults({
      date: "2026-07-20",
      players: 2,
      rows,
      from: "06:00",
      to: "20:00",
      maxPriceCents: null,
    });
    expect(html).toContain("text-emerald-700");
    expect(html).toContain("$45.00");
  });

  it("shows em dash when price missing", () => {
    const tt = makeTt("golfnow", "stevens_park", 1 * 3600_000);
    const ttNoPrice = { ...tt, hotDealPriceCents: null, rackPriceCents: null };
    const html = renderResults({
      date: "2026-07-20",
      players: 2,
      rows: [{ teeTime: ttNoPrice, course: DFW_COURSES[0] }],
      from: "06:00",
      to: "20:00",
      maxPriceCents: null,
    });
    expect(html).toContain("—");
  });
});