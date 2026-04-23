import { test, expect } from "@playwright/test";
import { login, expectPath, TEST_USERS } from "./helpers";

test.describe("PO Weekly Entry Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_USERS.po.email);
  });

  test("PO can log in and reach the dashboard", async ({ page }) => {
    await expectPath(page, "/dashboard|/weekly");
    // Should see user name in navigation
    await expect(page.getByText(TEST_USERS.po.name)).toBeVisible();
  });

  test("PO can navigate to weekly entry page", async ({ page }) => {
    await page.goto("/weekly");
    await expectPath(page, "/weekly");
    // Should see the weekly review heading with week number
    await expect(page.getByText(/Ma revue/)).toBeVisible();
    await expect(page.getByText(/Deadline lundi 09h00/)).toBeVisible();
  });

  test("PO sees their assigned Key Results on weekly page", async ({
    page,
  }) => {
    await page.goto("/weekly");
    // Should see at least one KR entry form with progress slider
    const sliders = page.locator('input[type="range"]');
    // PO Trading should have KRs assigned from seed
    const count = await sliders.count();
    expect(count).toBeGreaterThan(0);
  });

  test("PO can adjust progress slider and see score update", async ({
    page,
  }) => {
    await page.goto("/weekly");
    const slider = page.locator('input[type="range"]').first();
    await slider.fill("75");
    // Score should reflect the new value
    await expect(page.getByText("75%").first()).toBeVisible();
  });

  test("PO can select a status for a KR", async ({ page }) => {
    await page.goto("/weekly");
    const statusSelect = page.locator("select").first();
    await statusSelect.selectOption("AT_RISK");
    await expect(statusSelect).toHaveValue("AT_RISK");
  });

  test("PO sees blocker field when status is BLOCKED", async ({ page }) => {
    await page.goto("/weekly");
    const statusSelect = page.locator("select").first();
    await statusSelect.selectOption("BLOCKED");
    // Blocker textarea should appear
    await expect(
      page.getByPlaceholder("Décrivez le blocage...").first()
    ).toBeVisible();
    // Action needed field should also appear
    await expect(
      page.getByPlaceholder("De quoi avez-vous besoin ?").first()
    ).toBeVisible();
  });

  test("PO can submit the weekly review", async ({ page }) => {
    await page.goto("/weekly");
    // Fill in at least one entry
    const slider = page.locator('input[type="range"]').first();
    await slider.fill("60");

    // Click submit button
    await page.getByRole("button", { name: /Soumettre la revue/ }).click();

    // Wait for success message
    await expect(page.getByText("Revue soumise avec succès")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("PO can save as draft", async ({ page }) => {
    await page.goto("/weekly");
    const slider = page.locator('input[type="range"]').first();
    await slider.fill("45");

    await page
      .getByRole("button", { name: /Enregistrer brouillon/ })
      .click();

    // Should still show success (draft saves via same API)
    await expect(page.getByText("Revue soumise avec succès")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("PO cannot access admin panel", async ({ page }) => {
    await page.goto("/admin");
    // Should be redirected away from admin (to dashboard)
    await expectPath(page, "/dashboard");
  });
});
