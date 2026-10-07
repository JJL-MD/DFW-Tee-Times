/* Leaflet map for DFW courses. Loads /courses-data JSON embedded by view. */
(function () {
  function init() {
    const el = document.getElementById("map");
    const dataEl = document.getElementById("courses-data");
    if (!el || !dataEl) return;
    let courses;
    try {
      courses = JSON.parse(dataEl.textContent || "[]");
    } catch (e) {
      console.error("invalid courses data", e);
      return;
    }
    const highlightEl = document.getElementById("highlight-data");
    let highlight = null;
    if (highlightEl) {
      try {
        highlight = JSON.parse(highlightEl.textContent || "null");
      } catch {}
    }

    const map = L.map(el).setView([32.95, -96.85], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 18,
    }).addTo(map);

    for (const c of courses) {
      const marker = L.circleMarker([c.lat, c.lon], {
        radius: 7,
        color: highlight && highlight.courseId === c.id ? "#047857" : "#10b981",
        fillOpacity: 0.85,
        weight: 2,
      }).addTo(map);
      marker.bindPopup(
        `<b>${escapeHtml(c.name)}</b><br>${escapeHtml(c.city)}<br>` +
          `<a href="/course/${encodeURIComponent(c.id)}">Details →</a>` +
          (highlight && highlight.courseId === c.id && highlight.cheapestCents != null
            ? `<br><span style="color:#047857">From $${(highlight.cheapestCents / 100).toFixed(2)}</span>`
            : ""),
      );
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();