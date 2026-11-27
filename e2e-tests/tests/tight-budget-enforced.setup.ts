import { test as setup } from "@playwright/test";
import { ensureTestScenario } from "./shared";

setup("switch to the enforced tight-budget scenario", async ({ page }) => {
  await ensureTestScenario(page, "tight-budget-enforced");
});
