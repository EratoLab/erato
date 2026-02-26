import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { TAG_CI } from "./tags";
import { chatIsReadyToChat, getScenarioData, loginWithEntraId } from "./shared";

const QUESTION = "What headings can you see on page 3?";
const EXPECTED_CORRECT_HEADING = "Introduction";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseScenarioDataFromToml(
  tomlContent: string,
): Record<string, string> | null {
  const scenarioDataMatch = tomlContent.match(
    /SCENARIO_DATA\s*=\s*\{([^}]+)\}/,
  );
  if (!scenarioDataMatch) {
    return null;
  }

  const inlineTableContent = scenarioDataMatch[1];
  const data: Record<string, string> = {};

  const keyValuePairs = inlineTableContent.split(",");
  for (const pair of keyValuePairs) {
    const [key, value] = pair.split("=").map((s) => s.trim());
    if (key && value) {
      data[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return Object.keys(data).length > 0 ? data : null;
}

async function getScenarioDataLocalFallback(
  scenarioName: string,
): Promise<Record<string, string> | null> {
  const autoTomlPath = path.resolve(
    __dirname,
    `../../infrastructure/k3d/erato-local/config/erato.scenario-${scenarioName}.auto.toml`,
  );

  if (!fs.existsSync(autoTomlPath)) {
    return null;
  }

  try {
    const tomlContent = fs.readFileSync(autoTomlPath, "utf-8");
    return parseScenarioDataFromToml(tomlContent);
  } catch {
    return null;
  }
}

async function getScenarioDataWithFallback(
  page: Page,
): Promise<Record<string, string> | null> {
  let scenarioData = await getScenarioData(page);

  if (!scenarioData) {
    const scenarioName = await page.evaluate(() => {
      return (window as { K3D_TEST_SCENARIO?: string }).K3D_TEST_SCENARIO;
    });
    const effectiveScenario = scenarioName || "entra_id";
    scenarioData = await getScenarioDataLocalFallback(effectiveScenario);
  }

  if (scenarioData) {
    await page.addInitScript((data) => {
      (window as { SCENARIO_DATA?: Record<string, string> }).SCENARIO_DATA =
        data;
    }, scenarioData);
  }

  return scenarioData;
}

async function openFolderByName(page: Page, folderName: string) {
  const row = page.locator('[role="row"]', { hasText: folderName }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole("button", { name: /open folder/i }).click();
}

async function selectOneDriveFileByPath(page: Page) {
  // Open source selector and choose OneDrive
  await page
    .getByRole("button", { name: /open menu/i })
    .last()
    .click();
  await page.getByRole("menuitem", { name: /upload from onedrive/i }).click();

  const picker = page.getByRole("dialog", {
    name: /select files from cloud storage/i,
  });
  await expect(picker).toBeVisible({ timeout: 15000 });

  // Open the first available drive (typically personal OneDrive)
  await picker
    .getByRole("button", { name: /open drive/i })
    .first()
    .click();

  // Navigate path: Testfiles > test-files
  await openFolderByName(page, "Testfiles");
  await openFolderByName(page, "test-files");

  // Select file: sample-report-compressed.pdf
  await page
    .getByRole("button", { name: "sample-report-compressed.pdf" })
    .click();

  // Confirm cloud selection
  await picker.getByRole("button", { name: /^select/i }).click();
  await expect(picker).not.toBeVisible({ timeout: 15000 });

  // Confirm file appears in assistant attachments preview
  await expect(page.getByText(/sample-repo/i)).toBeVisible({
    timeout: 15000,
  });
}

async function shareAssistantWithUser(page: Page, assistantName: string) {
  const assistantButton = page.getByRole("button", {
    name: new RegExp(assistantName),
  });
  await expect(assistantButton).toBeVisible({ timeout: 15000 });

  const assistantCard = assistantButton.locator("..");
  await assistantCard
    .getByRole("button", { name: /menu|more|options/i })
    .click();

  await page.getByRole("menuitem", { name: /share/i }).click();

  const sharingDialog = page.getByRole("dialog", { name: /share/i });
  await expect(sharingDialog).toBeVisible({ timeout: 10000 });

  const searchBox = sharingDialog.getByRole("searchbox");
  await searchBox.fill("Demis Gemini");
  await page.waitForTimeout(1500);

  // Pick first selectable user result (search is already narrowed by user2 email)
  const candidate = sharingDialog.locator('input[type="checkbox"]').first();
  await expect(candidate).toBeVisible({ timeout: 10000 });
  await candidate.check();

  await sharingDialog.getByRole("button", { name: "Add" }).click();

  // Close dialog
  const closeButton = page.getByRole("button", { name: /close|done/i });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  } else {
    await page.keyboard.press("Escape");
  }

  await expect(sharingDialog).not.toBeVisible({ timeout: 5000 });
}

test(
  "Entra ID: shared assistant with OneDrive file does not answer page 3 heading correctly",
  { tag: TAG_CI },
  async ({ browser }) => {
    const randomSuffix = Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0");
    const assistantName = `OneDrive Shared Assistant-${randomSuffix}`;

    // User 1: create assistant with OneDrive file and share with user2
    const user1Context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const user1Page = await user1Context.newPage();

    await user1Page.goto("/");
    const scenarioData = await getScenarioDataWithFallback(user1Page);
    expect(scenarioData?.entraid_user1_email).toBeTruthy();
    expect(scenarioData?.entraid_user1_password).toBeTruthy();
    expect(scenarioData?.entraid_user2_email).toBeTruthy();

    await loginWithEntraId(
      user1Page,
      scenarioData!.entraid_user1_email,
      scenarioData!.entraid_user1_password,
    );

    await expect(
      user1Page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible({ timeout: 20000 });

    await user1Page.goto("/assistants/new");
    await expect(
      user1Page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible({ timeout: 10000 });

    await user1Page.getByLabel(/name/i).fill(assistantName);
    await user1Page
      .getByLabel(/description/i)
      .fill("OneDrive-backed assistant for shared access test");
    await user1Page
      .getByLabel(/system prompt/i)
      .fill("You answer strictly from the attached files.");

    await selectOneDriveFileByPath(user1Page);

    await user1Page.getByRole("button", { name: /create assistant/i }).click();
    await expect(
      user1Page.getByText(/assistant created successfully/i),
    ).toBeVisible({ timeout: 15000 });

    await user1Page.waitForURL("/assistants", { timeout: 15000 });

    await shareAssistantWithUser(user1Page, assistantName);

    await user1Context.close();

    // User 2: open shared assistant chat, ask question, and verify answer is NOT the expected heading
    const user2Context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const user2Page = await user2Context.newPage();

    try {
      await user2Page.goto("/");
      await getScenarioDataWithFallback(user2Page);

      await loginWithEntraId(
        user2Page,
        scenarioData!.entraid_user2_email,
        scenarioData!.entraid_user2_password,
      );

      await expect(
        user2Page.getByRole("textbox", { name: "Type a message..." }),
      ).toBeVisible({ timeout: 20000 });

      await user2Page.goto("/assistants");

      const sharedAssistant = user2Page.getByRole("button", {
        name: new RegExp(assistantName),
      });
      await expect(sharedAssistant).toBeVisible({ timeout: 20000 });
      await sharedAssistant.click();

      const textbox = user2Page.getByRole("textbox", {
        name: /type a message/i,
      });
      await expect(textbox).toBeVisible({ timeout: 10000 });

      await textbox.fill(QUESTION);
      await textbox.press("Enter");

      await chatIsReadyToChat(user2Page, {
        expectAssistantResponse: true,
        loadingTimeoutMs: 60000,
      });

      const assistantText = (
        (await user2Page
          .getByTestId("message-assistant")
          .last()
          .textContent()) ?? ""
      ).toLowerCase();

      expect(assistantText).not.toContain(
        EXPECTED_CORRECT_HEADING.toLowerCase(),
      );
    } finally {
      await user2Context.close();
    }
  },
);
