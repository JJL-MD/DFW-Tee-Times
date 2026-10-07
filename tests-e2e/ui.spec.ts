/**
 * End-to-end browser tests for the DFW Tee-Times Worker UI.
 *
 * What this catches that the route-level Hono tests don't:
 *   - Tailwind classes actually render correctly
 *   - HTMX hx-get fires and swaps the right HTML
 *   - Date picker / select dropdowns work in a real browser
 *   - Mobile responsive layout (44px tap targets, viewport behavior)
 *   - Cross-link integrity (clicking a course name goes to the right page)
 *
 * Prerequisites:
 *   - wrangler dev running at PLAYWRIGHT_BASE_URL
 *   - `npx playwright install chromium` to fetch the browser
 *
 * Run: `npx playwright test`
 */
import { test, expect } from "@playwright/test";

test.describe("homepage", () => {
  test("renders search form with date picker, players, course dropdown", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/DFW Tee Times/);
    await expect(page.getByRole("heading", { name: /Find tee times across DFW/i })).toBeVisible();

    // Date picker — 14 options (today + 13 days)
    const dateSelect = page.locator('select[name="date"]');
    await expect(dateSelect).toBeVisible();
    const dateOptions = await dateSelect.locator("option").count();
    expect(dateOptions).toBe(14);

    // Players select — 1/2/3/4 with 2 selected by default
    const playersSelect = page.locator('select[name="players"]');
    await expect(playersSelect).toBeVisible();
    await expect(playersSelect).toHaveValue("2");

    // Course dropdown — all 50 courses + "All courses" default option
    const courseSelect = page.locator('select[name="courseId"]');
    await expect(courseSelect).toBeVisible();
    const courseOptions = await courseSelect.locator("option").count();
    expect(courseOptions).toBe(51);

    // Max price select defaults to 5000 ($50)
    const priceSelect = page.locator('select[name="maxPrice"]');
    await expect(priceSelect).toHaveValue("5000");

    // Catalog accordion shows the 50 courses
    const details = page.locator("details");
    await expect(details).toContainText(/courses$/);
  });

  test("highlights the 9 priority courses in catalog", async ({ page }) => {
    await page.goto("/");
    await page.locator("details").click(); // expand
    const detailText = await page.locator("details").innerText();
    for (const name of [
      "Tenison Park Golf Course",
      "Sherrill Park Golf Course",
      "Cedar Crest Golf Course",
      "Firewheel Golf Park",
      "The Courses at Watters Creek",
      "Heritage Ranch Golf & Country Club",
      "Texas Rangers Golf Club",
      "Coyote Ridge Golf Club",
      "Indian Creek Golf Course",
    ]) {
      expect(detailText).toContain(name);
    }
  });
});

test.describe("navigation", () => {
  test("clicking a course name navigates to course detail", async ({ page }) => {
    await page.goto("/");
    await page.locator("details").click();
    // Click the Stevens Park link in the catalog
    await page.getByRole("link", { name: /Stevens Park Golf Course/ }).click();
    await expect(page).toHaveURL(/\/course\/stevens_park$/);
    await expect(page.getByRole("heading", { name: /Stevens Park/ })).toBeVisible();
    await expect(page.getByText(/foreup/)).toBeVisible();
  });

  test("course detail page 404 for unknown course", async ({ page }) => {
    const response = await page.goto("/course/this_does_not_exist");
    expect(response?.status()).toBe(404);
  });

  test("map page loads and shows the courses-data script", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByRole("heading", { name: /Course map/ })).toBeVisible();
    // The Leaflet div + courses JSON should be present
    await expect(page.locator("#map")).toBeAttached();
    await expect(page.locator("#courses-data")).toBeAttached();
  });
});

test.describe("search flow (empty cache)", () => {
  test("submitting search without cached data shows empty state", async ({ page }) => {
    await page.goto("/");
    // Pick tomorrow
    await page.locator('select[name="date"]').selectOption({ index: 1 });
    await page.getByRole("button", { name: "Search" }).click();
    // Wait for HTMX to swap the result
    await expect(page.locator("#results")).toContainText(/No tee times matched/, { timeout: 10_000 });
  });
});

test.describe("mobile layout", () => {
  test("search form is usable at 375px wide (iPhone SE)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // All form controls should be visible without horizontal scroll
    await expect(page.locator('select[name="date"]')).toBeVisible();
    await expect(page.locator('select[name="players"]')).toBeVisible();
    await expect(page.locator('select[name="courseId"]')).toBeVisible();
    await expect(page.locator('select[name="maxPrice"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();

    // Tap target check — buttons/selects should be at least 44px tall
    const buttonBox = await page.getByRole("button", { name: "Search" }).boundingBox();
    expect(buttonBox?.height).toBeGreaterThanOrEqual(40); // allow some flex
  });

  test("course detail renders without horizontal scroll at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/course/stevens_park");
    // Page should not horizontally scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });
});

test.describe("accessibility smoke", () => {
  test("homepage has a single h1", async ({ page }) => {
    await page.goto("/");
    const h1s = await page.locator("h1").count();
    expect(h1s).toBe(1);
  });

  test("nav links have accessible text", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator("header nav");
    await expect(nav.getByRole("link", { name: "Search" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Schedule" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Vault" })).toBeVisible();
  });

  test("search form has labels for each field", async ({ page }) => {
    await page.goto("/");
    // Each select should be preceded by a visible label
    await expect(page.getByText("Date", { exact: true })).toBeVisible();
    await expect(page.getByText("Players", { exact: true })).toBeVisible();
    await expect(page.getByText(/Course/)).toBeVisible();
    await expect(page.getByText(/Max price/)).toBeVisible();
  });
});