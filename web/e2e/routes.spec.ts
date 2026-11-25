import { expect, test, type Page } from "@playwright/test";

// One smoke test per route: it renders, shows its key element, and logs no errors.
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|commons\.wikimedia/.test(m.text()) && errors.push(m.text()));
  return errors;
}

const ROUTES: [string, string, (p: Page) => ReturnType<Page["locator"]>][] = [
  ["/", "story", (p) => p.getByRole("heading", { name: /Family Tree/ }).first()],
  ["/graph", "graph", (p) => p.getByTestId("graph-explorer")],
  ["/trees", "trees", (p) => p.getByTestId("founder-tree")],
  ["/migration", "migration", (p) => p.getByTestId("migration")],
  ["/institutions", "institutions", (p) => p.getByTestId("bump-chart")],
  ["/fields", "fields", (p) => p.getByTestId("alluvial")],
  ["/recognition", "recognition", (p) => p.getByTestId("km-chart")],
  ["/missing", "missing", (p) => p.getByTestId("predictions")],
  ["/quality", "quality", (p) => p.getByTestId("anomalies")],
  ["/ask", "ask", (p) => p.getByText(/needs the local API|Ask the graph/).first()],
  ["/about", "about", (p) => p.getByRole("heading", { name: "How this was made" })],
];

for (const [path, name, el] of ROUTES) {
  test(`route ${name} renders`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`./#${path}`);
    await expect(el(page)).toBeVisible({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test("search opens a person panel and the URL is shareable", async ({ page }) => {
  await page.goto("./#/graph");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder(/Search/).fill("Niels Bohr");
  await page.getByRole("option").first().click();
  await expect(page.getByTestId("person-panel")).toBeVisible();
  expect(page.url()).toMatch(/p=Q\d+/);
  const url = page.url();
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.getByTestId("person-panel")).toBeVisible({ timeout: 20_000 });
});

test("filters are reflected in the URL", async ({ page }) => {
  await page.goto("./#/graph");
  await expect(page.getByTestId("graph-explorer")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("filters-button").click();
  const box = page.getByLabel("Core physicists only");
  await expect(box).toBeVisible();
  // the drawer animates in; retry until the click lands and the URL reflects it
  await expect(async () => {
    await box.check();
    await expect(page).toHaveURL(/core=1/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
});
