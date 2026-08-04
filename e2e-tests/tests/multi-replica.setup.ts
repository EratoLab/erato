import { test as setup } from "@playwright/test";
import { ensureTestScenario } from "./shared";

/**
 * Deploy the dedicated shared-streaming scenario before its tests. The
 * scenario switch also sets backend.replicaCount=3 and enables mock-LLM.
 */
setup("switch to multi-replica scenario", async ({ page }) => {
  await ensureTestScenario(page, "multi-replica");
});
