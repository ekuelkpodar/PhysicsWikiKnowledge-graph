import { expect, test } from "@playwright/test";

test("mobile graph becomes a searchable list", async ({ page }) => {
  await page.goto("./#/graph");
  await expect(page.getByLabel("Filter people")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Filter people").fill("Einstein");
  await page.getByRole("button", { name: /Albert Einstein/ }).first().click();
  await expect(page.getByTestId("person-panel")).toBeVisible();
});
