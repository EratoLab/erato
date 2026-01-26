import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { login } from "./shared";

test(
  "Session expiry detection: logout in one tab triggers redirect in another",
  { tag: TAG_CI },
  async ({ browser }) => {
    // Create a context with authentication
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });

    // Tab 1: Login
    const page1 = await context.newPage();
    await page1.goto("/");
    await login(page1, "admin@example.com");

    // Verify tab 1 is ready to chat
    await expect(
      page1.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible();

    console.log("[SESSION_EXPIRY] Tab 1 is ready to chat");

    // Tab 2: Open with the same session (same context = shared cookies)
    const page2 = await context.newPage();
    await page2.goto("/");

    // Verify tab 2 is also ready to chat (should be logged in automatically)
    await expect(
      page2.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible();

    console.log("[SESSION_EXPIRY] Tab 2 is ready to chat with same session");

    // Logout on tab 1
    await page1.bringToFront();
    await page1.getByRole("button", { name: "expand sidebar" }).click();
    await page1.locator("button").filter({ hasText: "A" }).click();
    await page1.getByRole("menuitem", { name: "Sign out" }).click();

    // Verify tab 1 is at login page
    await expect(
      page1.getByRole("button", { name: "Sign in with" }),
    ).toBeVisible();

    console.log("[SESSION_EXPIRY] Tab 1 logged out successfully");

    // Focus tab 2 by bringing it to front
    await page2.bringToFront();

    // Set up a promise to wait for the navigation/reload that happens after session expiry
    const navigationPromise = page2.waitForURL(() => true, { timeout: 10000 });

    // Simulate the page being hidden first, then becoming visible
    // This matches the real-world scenario of a user switching tabs
    await page2.evaluate(() => {
      // First simulate the page being hidden
      Object.defineProperty(document, "visibilityState", {
        writable: true,
        configurable: true,
        value: "hidden",
      });
      Object.defineProperty(document, "hidden", {
        writable: true,
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event("visibilitychange"));
    });

    // Small delay to ensure the hidden state is processed
    await page2.waitForTimeout(100);

    // Now simulate the page becoming visible (user returning to the tab)
    await page2.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        writable: true,
        configurable: true,
        value: "visible",
      });
      Object.defineProperty(document, "hidden", {
        writable: true,
        configurable: true,
        value: false,
      });

      // Dispatch both events that React Query's focus manager listens to
      window.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    console.log(
      "[SESSION_EXPIRY] Tab 2 focused with visibility change, waiting for redirect",
    );

    // Wait for the page to reload (which happens in useProfileApi when it detects 401/403)
    await navigationPromise;

    // Wait for tab 2 to be redirected to login page
    // The useProfileApi hook should detect the 401/403 and reload the page
    await expect(
      page2.getByRole("button", { name: "Sign in with" }),
    ).toBeVisible({ timeout: 10000 });

    console.log("[SESSION_EXPIRY] Tab 2 successfully redirected to login page");

    await context.close();
  },
);
