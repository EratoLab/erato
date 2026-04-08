import { expect, test } from "@playwright/test";

import { chatIsReadyToChat, getScenarioData, loginWithEntraId } from "./shared";
import { TAG_CI } from "./tags";

test(
  "Assistant sharing between Entra ID users survives assistant archive",
  { tag: TAG_CI },
  async ({ browser }) => {
    test.setTimeout(180_000);

    let assistantName: string;
    let user2DisplayName: string;
    let sharedChatUrl: string;

    await test.step("User 1 creates an assistant", async () => {
      const context1 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page1 = await context1.newPage();

      try {
        await page1.goto("/");

        const scenarioData = await getScenarioData(page1);
        expect(scenarioData).toBeTruthy();
        expect(scenarioData?.entraid_user1_email).toBeTruthy();
        expect(scenarioData?.entraid_user1_password).toBeTruthy();

        await loginWithEntraId(
          page1,
          scenarioData!.entraid_user1_email,
          scenarioData!.entraid_user1_password,
        );

        await expect(
          page1.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        const randomSuffix = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        assistantName = `Shared Assistant-${randomSuffix}`;

        await page1.goto("/assistants");

        const createButton = page1.getByRole("button", {
          name: /create.*assistant|new.*assistant/i,
        });
        await expect(createButton).toBeVisible();
        await createButton.click();

        await expect(
          page1.getByRole("heading", { name: /create assistant/i }),
        ).toBeVisible();

        await page1.getByLabel(/name/i).fill(assistantName);
        await page1
          .getByLabel(/description/i)
          .fill("An assistant for testing sharing between users");
        await page1
          .getByLabel(/system prompt/i)
          .fill("You are a helpful assistant for testing sharing.");

        await page1.getByRole("button", { name: /create assistant/i }).click();

        await expect(
          page1.getByText(/assistant created successfully/i),
        ).toBeVisible({ timeout: 5000 });
        await page1.waitForURL("/assistants", { timeout: 5000 });
        await expect(
          page1.getByRole("heading", { name: assistantName }),
        ).toBeVisible();
      } finally {
        await context1.close();
      }
    });

    await test.step("User 2 confirms the assistant is not visible before sharing", async () => {
      const context2 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page2 = await context2.newPage();

      try {
        let profileResponse: { name: string } | null = null;
        const profilePromise = page2
          .waitForResponse(
            (resp) =>
              resp.url().includes("/api/v1beta/me/profile") &&
              resp.status() === 200,
            { timeout: 30000 },
          )
          .then(async (resp) => {
            profileResponse = (await resp.json()) as { name: string };
          });

        await page2.goto("/");

        const scenarioData = await getScenarioData(page2);
        expect(scenarioData).toBeTruthy();
        expect(scenarioData?.entraid_user2_email).toBeTruthy();
        expect(scenarioData?.entraid_user2_password).toBeTruthy();

        await loginWithEntraId(
          page2,
          scenarioData!.entraid_user2_email,
          scenarioData!.entraid_user2_password,
        );

        await expect(
          page2.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        await profilePromise;
        expect(profileResponse).not.toBeNull();
        user2DisplayName = profileResponse!.name;

        await page2.goto("/assistants");
        await expect(
          page2.getByRole("heading", { name: assistantName }),
        ).toHaveCount(0);
      } finally {
        await context2.close();
      }
    });

    await test.step("User 1 shares the assistant with User 2", async () => {
      const context1 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page1 = await context1.newPage();

      try {
        await page1.goto("/");

        const scenarioData = await getScenarioData(page1);
        expect(scenarioData).toBeTruthy();

        await loginWithEntraId(
          page1,
          scenarioData!.entraid_user1_email,
          scenarioData!.entraid_user1_password,
        );

        await expect(
          page1.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        await page1.goto("/assistants");

        const assistantButton = page1.getByRole("button", {
          name: new RegExp(assistantName),
        });
        await expect(assistantButton).toBeVisible();

        const assistantCard = assistantButton.locator("..");
        const menuButton = assistantCard.getByRole("button", {
          name: /menu|more|options/i,
        });
        await expect(menuButton).toBeVisible();
        await menuButton.click();

        const shareOption = page1.getByRole("menuitem", { name: /share/i });
        await expect(shareOption).toBeVisible();
        await shareOption.click();

        await expect(page1.getByRole("dialog", { name: /share/i })).toBeVisible(
          {
            timeout: 5000,
          },
        );

        const userSearchInput = page1.getByRole("searchbox");
        await expect(userSearchInput).toBeVisible({ timeout: 5000 });
        await userSearchInput.fill(user2DisplayName);
        await page1.waitForTimeout(1500);

        const allCheckboxes = page1.locator('input[type="checkbox"]');
        const checkboxCount = await allCheckboxes.count();
        let user2Found = false;

        for (let i = 0; i < checkboxCount; i++) {
          const checkbox = allCheckboxes.nth(i);
          const ariaLabel = await checkbox.getAttribute("aria-label");

          if (
            ariaLabel &&
            ariaLabel.toLowerCase().includes(user2DisplayName.toLowerCase())
          ) {
            await checkbox.check();
            user2Found = true;
            break;
          }
        }

        if (!user2Found) {
          const userRows = page1.locator(
            `div:has-text("${user2DisplayName}"):has(input[type="checkbox"])`,
          );
          if ((await userRows.count()) > 0) {
            await userRows
              .first()
              .locator('input[type="checkbox"]')
              .first()
              .check();
            user2Found = true;
          }
        }

        expect(user2Found).toBe(true);

        const sharingDialog = page1.getByRole("dialog", { name: /share/i });
        const addButton = sharingDialog.getByRole("button", { name: "Add" });
        await expect(addButton).toBeVisible({ timeout: 5000 });
        await addButton.click();

        const closeButton = page1.getByRole("button", { name: /close|done/i });
        if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await closeButton.click();
        } else {
          await page1.keyboard.press("Escape");
        }

        await expect(
          page1.getByRole("dialog", { name: /share/i }),
        ).not.toBeVisible({ timeout: 3000 });
      } finally {
        await context1.close();
      }
    });

    await test.step("User 2 sees the shared assistant and starts a chat", async () => {
      const context2 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page2 = await context2.newPage();

      try {
        await page2.goto("/");

        const scenarioData = await getScenarioData(page2);
        expect(scenarioData).toBeTruthy();

        await loginWithEntraId(
          page2,
          scenarioData!.entraid_user2_email,
          scenarioData!.entraid_user2_password,
        );

        await expect(
          page2.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        await page2.goto("/assistants");
        await page2.reload();

        const assistantHeading = page2.getByRole("heading", {
          name: assistantName,
        });
        await expect(assistantHeading).toBeVisible({ timeout: 10000 });

        const assistantButton = page2.getByRole("button", {
          name: new RegExp(assistantName),
        });
        await expect(assistantButton).toBeVisible();
        await assistantButton.click();

        const textbox = page2.getByRole("textbox", { name: /type a message/i });
        await expect(textbox).toBeVisible();
        await textbox.fill("Hello! This is a test message from user 2.");
        await textbox.press("Enter");

        await chatIsReadyToChat(page2, { expectAssistantResponse: true });
        await expect(page2.getByTestId("message-assistant")).toBeVisible();
        await expect(page2).toHaveURL(/\/a\/[^/]+\/[^/]+$/);

        sharedChatUrl = page2.url();
      } finally {
        await context2.close();
      }
    });

    await test.step("User 1 archives the shared assistant", async () => {
      const context1 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page1 = await context1.newPage();

      try {
        await page1.goto("/");

        const scenarioData = await getScenarioData(page1);
        expect(scenarioData).toBeTruthy();

        await loginWithEntraId(
          page1,
          scenarioData!.entraid_user1_email,
          scenarioData!.entraid_user1_password,
        );

        await expect(
          page1.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        await page1.goto("/assistants");

        const assistantButton = page1.getByRole("button", {
          name: new RegExp(assistantName),
        });
        await expect(assistantButton).toBeVisible();

        const assistantCard = assistantButton.locator("..");
        const menuButton = assistantCard.getByRole("button", {
          name: /menu|more|options/i,
        });
        await expect(menuButton).toBeVisible();
        await menuButton.click();

        const archiveOption = page1.getByRole("menuitem", {
          name: /archive|delete|remove/i,
        });
        await expect(archiveOption).toBeVisible();
        await archiveOption.click();

        const confirmButton = page1.getByRole("button", {
          name: /confirm|archive|delete|yes/i,
        });
        if ((await confirmButton.count()) > 0) {
          await confirmButton.click();
        }

        await expect(
          page1.getByRole("heading", { name: assistantName }),
        ).toHaveCount(0, { timeout: 10000 });
      } finally {
        await context1.close();
      }
    });

    await test.step("User 2 can still open the existing chat after archive", async () => {
      const context2 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page2 = await context2.newPage();

      try {
        await page2.goto("/");

        const scenarioData = await getScenarioData(page2);
        expect(scenarioData).toBeTruthy();
        expect(sharedChatUrl).toBeTruthy();

        await loginWithEntraId(
          page2,
          scenarioData!.entraid_user2_email,
          scenarioData!.entraid_user2_password,
        );

        await expect(
          page2.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        await page2.goto(sharedChatUrl);

        await expect(
          page2.getByRole("textbox", { name: /type a message/i }),
        ).toBeVisible({ timeout: 10000 });
        await expect(page2.getByTestId("message-user")).toBeVisible();
        await expect(page2.getByTestId("message-assistant")).toBeVisible();
      } finally {
        await context2.close();
      }
    });

    await test.step("User 2 no longer sees the archived shared assistant in the overview", async () => {
      const context2 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page2 = await context2.newPage();

      try {
        await page2.goto("/");

        const scenarioData = await getScenarioData(page2);
        expect(scenarioData).toBeTruthy();

        await loginWithEntraId(
          page2,
          scenarioData!.entraid_user2_email,
          scenarioData!.entraid_user2_password,
        );

        await expect(
          page2.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        await page2.goto("/assistants");
        await page2.reload();

        await expect(
          page2.getByRole("heading", { name: assistantName }),
        ).toHaveCount(0, { timeout: 10000 });
      } finally {
        await context2.close();
      }
    });
  },
);
