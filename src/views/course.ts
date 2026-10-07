/**
 * Course detail page — single course's metadata + cached availability +
 * "Schedule" buttons for each tee time.
 */
import { renderLayout, escapeHtml, fmtTime, fmtPrice } from "./layout";
import { DFW_COURSES } from "../seed/dfw-courses";
import type { SeedCourse } from "../seed/dfw-courses";
import type { TeeTime } from "../types";

export interface CourseDetailOptions {
  course: SeedCourse;
  teeTimes: TeeTime[];
  /** oldest scrapedAt among the returned rows, for "last updated" badge */
  lastUpdated: number | null;
}

export function renderCourseDetail(opts: CourseDetailOptions): string {
  const { course, teeTimes, lastUpdated } = opts;

  const subCourses = course.subCourses?.length
    ? `
      <div class="text-sm text-slate-600 mb-2">
        Sub-courses: ${course.subCourses.map(escapeHtml).join(", ")}
        ${course.preferredSubCourse ? ` <span class="text-xs">(preferred: <b>${escapeHtml(course.preferredSubCourse)}</b>)</span>` : ""}
      </div>`
    : "";

  const updated = lastUpdated
    ? new Date(lastUpdated).toLocaleString("en-US", { timeZone: course.timezone })
    : "never";

  const rows = teeTimes
    .slice()
    .sort((a, b) => a.timeEpochMs - b.timeEpochMs)
    .map((tt) => `
      <tr class="border-t hover:bg-slate-50">
        <td class="px-3 py-2">${escapeHtml(new Date(tt.timeEpochMs).toLocaleDateString("en-CA", { timeZone: course.timezone }))}</td>
        <td class="px-3 py-2 font-medium">${escapeHtml(fmtTime(tt.timeEpochMs, course.timezone))}</td>
        <td class="px-3 py-2 text-right">${escapeHtml(fmtPrice(tt.hotDealPriceCents))}</td>
        <td class="px-3 py-2 text-right text-slate-600">${escapeHtml(fmtPrice(tt.rackPriceCents))}</td>
        <td class="px-3 py-2 text-center">${tt.playersAvailable}</td>
        <td class="px-3 py-2 text-right">
          <a href="/book/${encodeURIComponent(tt.id)}" class="text-emerald-700 hover:underline">
            Schedule →
          </a>
        </td>
      </tr>`)
    .join("");

  const body = `
  <section class="space-y-4">
    <div class="bg-white rounded-lg shadow p-5">
      <a href="/" class="text-sm text-emerald-700 hover:underline">← All courses</a>
      <h1 class="text-2xl font-semibold mt-1">${escapeHtml(course.name)}</h1>
      <div class="text-sm text-slate-600">
        ${escapeHtml(course.city)}, ${escapeHtml(course.state)} ·
        default provider: <b>${escapeHtml(course.defaultProvider)}</b> ·
        booking window: ${course.bookingWindowDays} days ahead,
        opens ${escapeHtml(course.bookingOpensAtLocal)} ${escapeHtml(course.timezone)}
      </div>
      ${subCourses}
      <div class="text-xs text-slate-500 mt-1">Last updated: ${escapeHtml(updated)}</div>
    </div>

    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div class="px-5 py-3 border-b font-semibold">
        Availability (${teeTimes.length} tee times)
      </div>
      ${
        teeTimes.length === 0
          ? `<div class="p-5 text-slate-500 text-sm">No cached availability. The next scrape tick (every 15 min) will populate this.</div>`
          : `
        <div class="overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead class="bg-slate-100 text-left">
              <tr>
                <th class="px-3 py-2">Date</th>
                <th class="px-3 py-2">Time</th>
                <th class="px-3 py-2 text-right">Hot deal</th>
                <th class="px-3 py-2 text-right">Rack</th>
                <th class="px-3 py-2 text-center">Spots</th>
                <th class="px-3 py-2 text-right">Book</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      }
    </div>
  </section>`;

  return renderLayout({
    title: course.name,
    body,
    active: "course",
  });
}