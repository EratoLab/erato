import { test as setup } from "@playwright/test";
import { ensureTestScenario } from "./shared";

/**
 * Setup for many-models scenario tests.
 * This ensures the k3d cluster is switched to the many-models scenario
 * before any tests that require it are run.
 */
setup("switch to many-models scenario", async ({ page }) => {
  await ensureTestScenario(page, "many-models");
});
