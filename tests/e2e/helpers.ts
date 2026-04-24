import { type Page, expect } from "@playwright/test";

/**
 * Log in to IziPilot with the given credentials.
 * Waits for redirect to dashboard (or callbackUrl) after login.
 */
export async function login(
  page: Page,
  email: string,
  password: string = "password123"
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  // Wait for navigation away from login
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 15_000,
  });
}

/**
 * Assert that the page has navigated to the expected path.
 */
export async function expectPath(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(path));
}

/**
 * Test credentials from seed data.
 */
export const TEST_USERS = {
  ceo: { email: "direction@izichange.com", name: "Directeur Général" },
  management: {
    email: "comitedirection@izichange.com",
    name: "Directeur Opérations",
  },
  po: { email: "geres@izichange.com", name: "PO Trading" },
} as const;
