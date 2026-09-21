import { test as setup } from "@playwright/test";
import { ensureTestScenario } from "./shared";

/**
 * Setup for approvals scenario tests.
 * This ensures the k3d cluster is switched to the approvals scenario
 * before any tests that require it are run.
 */
setup("switch to approvals scenario", async ({ page }) => {
  await ensureTestScenario(page, "approvals");
});
