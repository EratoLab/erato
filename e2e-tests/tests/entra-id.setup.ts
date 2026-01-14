import { test as setup } from "@playwright/test";
import { ensureTestScenario } from "./shared";

/**
 * Setup for entra_id scenario tests.
 * This ensures the k3d cluster is switched to the entra_id scenario
 * before any tests that require it are run.
 *
 * Note: This uses the entra_id authenticated state from entra_id.auth.setup.ts
 */
setup("switch to entra_id scenario", async ({ page }) => {
  await ensureTestScenario(page, "entra_id");
});
