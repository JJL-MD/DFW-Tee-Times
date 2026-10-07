/**
 * Map view — Leaflet + OpenStreetMap tiles. No API key required.
 *
 * Pins colored by cheapest available slot (when results are joined);
 * plain pins when no availability data is loaded yet.
 */
import { renderLayout, escapeHtml } from "./layout";
import type { SeedCourse } from "../seed/dfw-courses";
import { DFW_COURSES } from "../seed/dfw-courses";

export function renderMap(
  highlight?: { courseId: string; cheapestCents: number | null },
): string {
  const courses = DFW_COURSES;

  const body = `
  <section class="space-y-3">
    <div class="bg-white rounded-lg shadow p-5">
      <h1 class="text-xl font-semibold">Course map</h1>
      <p class="text-sm text-slate-600">
        ${courses.length} DFW-area courses. Click a pin for details.
      </p>
    </div>
    <div id="map" class="bg-white rounded-lg shadow" style="height: 600px;"></div>
  </section>

  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="/map.js" defer></script>
  <script id="courses-data" type="application/json">${JSON.stringify(
    courses.map((c) => ({
      id: c.id,
      name: c.name,
      city: c.city,
      lat: c.lat,
      lon: c.lon,
      defaultProvider: c.defaultProvider,
      preferredSubCourse: c.preferredSubCourse ?? null,
    })),
  )}</script>
  ${
    highlight
      ? `<script id="highlight-data" type="application/json">${JSON.stringify(highlight)}</script>`
      : ""
  }
  `;

  return renderLayout({ title: "Course map", body, active: "search" });
}