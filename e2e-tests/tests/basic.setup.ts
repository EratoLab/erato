import { test as setup } from "@playwright/test";
import { ensureTestScenario } from "./shared";

/**
 * Setup for basic scenario tests.
 * This ensures the k3d cluster is switched to the basic scenario
 * before any tests that require it are run.
 */
setup("switch to basic scenario", async ({ page }) => {
  await ensureTestScenario(page, "basic");
});
