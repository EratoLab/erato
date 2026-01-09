import { test as setup } from "@playwright/test";
import { ensureTestScenario } from "./shared";

/**
 * Setup for assistants scenario tests.
 * This ensures the k3d cluster is switched to the assistants scenario
 * before any tests that require it are run.
 */
setup("switch to assistants scenario", async ({ page }) => {
  await ensureTestScenario(page, "assistants");
});
