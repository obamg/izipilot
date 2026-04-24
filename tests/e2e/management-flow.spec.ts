import { test, expect } from "@playwright/test";
import { login, expectPath, TEST_USERS } from "./helpers";

test.describe("Management / CEO Flow", () => {
  test.describe("CEO", () => {
    test.beforeEach(async ({ page }) => {
      await login(page, TEST_USERS.ceo.email);
    });

    test("CEO can log in and reach the dashboard", async ({ page }) => {
      await expectPath(page, "/dashboard");
      await expect(page.getByText(TEST_USERS.ceo.name)).toBeVisible();
    });

    test("CEO sees dashboard KPIs", async ({ page }) => {
      await page.goto("/dashboard");
      // Should see KPI cards with OKR status info
      await expect(page.getByText(/Objectif/i).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    test("CEO can navigate to synthesis page", async ({ page }) => {
      await page.goto("/synthesis");
      await expectPath(page, "/synthesis");
      // Should see synthesis/management view content
      await expect(page.getByText(/Synth/i).first()).toBeVisible();
    });

    test("CEO can navigate to alerts page", async ({ page }) => {
      await page.goto("/alerts");
      await expectPath(page, "/alerts");
      await expect(page.getByText(/Alert/i).first()).toBeVisible();
    });

    test("CEO can navigate to history page", async ({ page }) => {
      await page.goto("/history");
      await expectPath(page, "/history");
    });

    test("CEO can access admin panel", async ({ page }) => {
      await page.goto("/admin");
      await expectPath(page, "/admin");
      // Should see admin overview page
      await expect(page.getByText(/Administration/i).first()).toBeVisible();
    });

    test("CEO can access admin users page", async ({ page }) => {
      await page.goto("/admin/users");
      await expectPath(page, "/admin/users");
      // Should see user management content
      await expect(page.getByText(/Utilisateur/i).first()).toBeVisible();
    });

    test("CEO can access admin departments page", async ({ page }) => {
      await page.goto("/admin/departments");
      await expectPath(page, "/admin/departments");
      await expect(page.getByText(/D\u00e9partement/i).first()).toBeVisible();
    });

    test("CEO can access admin products page", async ({ page }) => {
      await page.goto("/admin/products");
      await expectPath(page, "/admin/products");
      await expect(page.getByText(/Produit/i).first()).toBeVisible();
    });

    test("CEO can access admin OKRs page", async ({ page }) => {
      await page.goto("/admin/okrs");
      await expectPath(page, "/admin/okrs");
      await expect(
        page.getByText(/Objectifs & Key Results/i).first()
      ).toBeVisible();
    });

    test("CEO can access admin organization page", async ({ page }) => {
      await page.goto("/admin/organization");
      await expectPath(page, "/admin/organization");
      await expect(page.getByText(/Organisation/i).first()).toBeVisible();
    });
  });

  test.describe("Management", () => {
    test.beforeEach(async ({ page }) => {
      await login(page, TEST_USERS.management.email);
    });

    test("Management can log in and reach dashboard", async ({ page }) => {
      await expectPath(page, "/dashboard");
      await expect(
        page.getByText(TEST_USERS.management.name)
      ).toBeVisible();
    });

    test("Management can view synthesis", async ({ page }) => {
      await page.goto("/synthesis");
      await expectPath(page, "/synthesis");
      await expect(page.getByText(/Synth/i).first()).toBeVisible();
    });

    test("Management can view alerts", async ({ page }) => {
      await page.goto("/alerts");
      await expectPath(page, "/alerts");
    });

    test("Management cannot access admin panel", async ({ page }) => {
      await page.goto("/admin");
      // Should be redirected to dashboard (only CEO has admin access)
      await expectPath(page, "/dashboard");
    });
  });

  // Viewer tests removed — no viewer users in seed
});

test.describe("Authentication", () => {
  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expectPath(page, "/login");
  });

  test("invalid credentials show error message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("wrong@example.com");
    await page.getByLabel("Mot de passe").fill("wrongpassword");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(
      page.getByText("Email ou mot de passe incorrect")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("login page shows IziPilot branding", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Pilot")).toBeVisible();
    await expect(
      page.getByText("L'exécution au rythme de vos ambitions")
    ).toBeVisible();
  });
});
