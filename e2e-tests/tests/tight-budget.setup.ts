import { test as setup } from "@playwright/test";
import { ensureTestScenario } from "./shared";

/**
 * Setup for tight-budget scenario tests.
 * This ensures the k3d cluster is switched to the tight-budget scenario
 * before any tests that require it are run.
 */
setup("switch to tight-budget scenario", async ({ page }) => {
  await ensureTestScenario(page, "tight-budget");
});
