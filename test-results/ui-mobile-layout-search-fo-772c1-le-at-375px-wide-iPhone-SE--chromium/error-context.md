# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui.spec.ts >> mobile layout >> search form is usable at 375px wide (iPhone SE)
- Location: tests-e2e/ui.spec.ts:109:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8788/
Call log:
  - navigating to "http://127.0.0.1:8788/", waiting until "load"

```

# Test source

```ts
  11  |  * Prerequisites:
  12  |  *   - wrangler dev running at PLAYWRIGHT_BASE_URL
  13  |  *   - `npx playwright install chromium` to fetch the browser
  14  |  *
  15  |  * Run: `npx playwright test`
  16  |  */
  17  | import { test, expect } from "@playwright/test";
  18  | 
  19  | test.describe("homepage", () => {
  20  |   test("renders search form with date picker, players, course dropdown", async ({ page }) => {
  21  |     await page.goto("/");
  22  | 
  23  |     await expect(page).toHaveTitle(/DFW Tee Times/);
  24  |     await expect(page.getByRole("heading", { name: /Find tee times across DFW/i })).toBeVisible();
  25  | 
  26  |     // Date picker — 14 options (today + 13 days)
  27  |     const dateSelect = page.locator('select[name="date"]');
  28  |     await expect(dateSelect).toBeVisible();
  29  |     const dateOptions = await dateSelect.locator("option").count();
  30  |     expect(dateOptions).toBe(14);
  31  | 
  32  |     // Players select — 1/2/3/4 with 2 selected by default
  33  |     const playersSelect = page.locator('select[name="players"]');
  34  |     await expect(playersSelect).toBeVisible();
  35  |     await expect(playersSelect).toHaveValue("2");
  36  | 
  37  |     // Course dropdown — all 50 courses + "All courses" default option
  38  |     const courseSelect = page.locator('select[name="courseId"]');
  39  |     await expect(courseSelect).toBeVisible();
  40  |     const courseOptions = await courseSelect.locator("option").count();
  41  |     expect(courseOptions).toBe(51);
  42  | 
  43  |     // Max price select defaults to 5000 ($50)
  44  |     const priceSelect = page.locator('select[name="maxPrice"]');
  45  |     await expect(priceSelect).toHaveValue("5000");
  46  | 
  47  |     // Catalog accordion shows the 50 courses
  48  |     const details = page.locator("details");
  49  |     await expect(details).toContainText(/courses$/);
  50  |   });
  51  | 
  52  |   test("highlights the 9 priority courses in catalog", async ({ page }) => {
  53  |     await page.goto("/");
  54  |     await page.locator("details").click(); // expand
  55  |     const detailText = await page.locator("details").innerText();
  56  |     for (const name of [
  57  |       "Tenison Park Golf Course",
  58  |       "Sherrill Park Golf Course",
  59  |       "Cedar Crest Golf Course",
  60  |       "Firewheel Golf Park",
  61  |       "The Courses at Watters Creek",
  62  |       "Heritage Ranch Golf & Country Club",
  63  |       "Texas Rangers Golf Club",
  64  |       "Coyote Ridge Golf Club",
  65  |       "Indian Creek Golf Course",
  66  |     ]) {
  67  |       expect(detailText).toContain(name);
  68  |     }
  69  |   });
  70  | });
  71  | 
  72  | test.describe("navigation", () => {
  73  |   test("clicking a course name navigates to course detail", async ({ page }) => {
  74  |     await page.goto("/");
  75  |     await page.locator("details").click();
  76  |     // Click the Stevens Park link in the catalog
  77  |     await page.getByRole("link", { name: /Stevens Park Golf Course/ }).click();
  78  |     await expect(page).toHaveURL(/\/course\/stevens_park$/);
  79  |     await expect(page.getByRole("heading", { name: /Stevens Park/ })).toBeVisible();
  80  |     await expect(page.getByText(/foreup/)).toBeVisible();
  81  |   });
  82  | 
  83  |   test("course detail page 404 for unknown course", async ({ page }) => {
  84  |     const response = await page.goto("/course/this_does_not_exist");
  85  |     expect(response?.status()).toBe(404);
  86  |   });
  87  | 
  88  |   test("map page loads and shows the courses-data script", async ({ page }) => {
  89  |     await page.goto("/map");
  90  |     await expect(page.getByRole("heading", { name: /Course map/ })).toBeVisible();
  91  |     // The Leaflet div + courses JSON should be present
  92  |     await expect(page.locator("#map")).toBeAttached();
  93  |     await expect(page.locator("#courses-data")).toBeAttached();
  94  |   });
  95  | });
  96  | 
  97  | test.describe("search flow (empty cache)", () => {
  98  |   test("submitting search without cached data shows empty state", async ({ page }) => {
  99  |     await page.goto("/");
  100 |     // Pick tomorrow
  101 |     await page.locator('select[name="date"]').selectOption({ index: 1 });
  102 |     await page.getByRole("button", { name: "Search" }).click();
  103 |     // Wait for HTMX to swap the result
  104 |     await expect(page.locator("#results")).toContainText(/No tee times matched/, { timeout: 10_000 });
  105 |   });
  106 | });
  107 | 
  108 | test.describe("mobile layout", () => {
  109 |   test("search form is usable at 375px wide (iPhone SE)", async ({ page }) => {
  110 |     await page.setViewportSize({ width: 375, height: 667 });
> 111 |     await page.goto("/");
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8788/
  112 | 
  113 |     // All form controls should be visible without horizontal scroll
  114 |     await expect(page.locator('select[name="date"]')).toBeVisible();
  115 |     await expect(page.locator('select[name="players"]')).toBeVisible();
  116 |     await expect(page.locator('select[name="courseId"]')).toBeVisible();
  117 |     await expect(page.locator('select[name="maxPrice"]')).toBeVisible();
  118 |     await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  119 | 
  120 |     // Tap target check — buttons/selects should be at least 44px tall
  121 |     const buttonBox = await page.getByRole("button", { name: "Search" }).boundingBox();
  122 |     expect(buttonBox?.height).toBeGreaterThanOrEqual(40); // allow some flex
  123 |   });
  124 | 
  125 |   test("course detail renders without horizontal scroll at 375px", async ({ page }) => {
  126 |     await page.setViewportSize({ width: 375, height: 667 });
  127 |     await page.goto("/course/stevens_park");
  128 |     // Page should not horizontally scroll
  129 |     const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  130 |     const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  131 |     expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  132 |   });
  133 | });
  134 | 
  135 | test.describe("accessibility smoke", () => {
  136 |   test("homepage has a single h1", async ({ page }) => {
  137 |     await page.goto("/");
  138 |     const h1s = await page.locator("h1").count();
  139 |     expect(h1s).toBe(1);
  140 |   });
  141 | 
  142 |   test("nav links have accessible text", async ({ page }) => {
  143 |     await page.goto("/");
  144 |     const nav = page.locator("header nav");
  145 |     await expect(nav.getByRole("link", { name: "Search" })).toBeVisible();
  146 |     await expect(nav.getByRole("link", { name: "Schedule" })).toBeVisible();
  147 |     await expect(nav.getByRole("link", { name: "Vault" })).toBeVisible();
  148 |   });
  149 | 
  150 |   test("search form has labels for each field", async ({ page }) => {
  151 |     await page.goto("/");
  152 |     // Each select should be preceded by a visible label
  153 |     await expect(page.getByText("Date", { exact: true })).toBeVisible();
  154 |     await expect(page.getByText("Players", { exact: true })).toBeVisible();
  155 |     await expect(page.getByText(/Course/)).toBeVisible();
  156 |     await expect(page.getByText(/Max price/)).toBeVisible();
  157 |   });
  158 | });
```