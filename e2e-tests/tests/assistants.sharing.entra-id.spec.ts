import { test, expect } from "@playwright/test";
import { loginWithEntraId, getScenarioData, chatIsReadyToChat } from "./shared";
import { TAG_CI } from "./tags";

/**
 * Assistant sharing tests for Entra ID
 * These tests verify that assistants can be shared between users in the same organization
 *
 * NOTE: Tests 6 and 7 (user2 seeing/using shared assistant) currently fail due to a
 * backend integration issue. The sharing flow works correctly - user2's display name
 * is captured from the profile API ("Demis Gemini"), the sharing dialog finds and
 * selects the correct user, and the share grant appears to be created. However,
 * Entra ID users cannot see shared assistants even after sharing.
 *
 * Test progress:
 * ✅ Tests 1-5: Assistant creation, visibility checks, profile API interception,
 *              and sharing dialog user selection all work correctly
 * ❌ Tests 6-7: Shared assistant not visible to Entra ID user (backend integration issue)
 *
 * Backend investigation needed:
 * - Share grants are being created (sharing dialog completes successfully)
 * - User selection is working correctly (selecting "Demis Gemini" by display name)
 * - But shared assistants don't appear in user2's assistant list
 * - Likely issue: subject_id_type or subject_id mismatch between share grants and Entra ID users
 */

test.describe.serial("Assistant Sharing between Entra ID Users", () => {
  let assistantName: string | null = null;
  let user2DisplayName: string | null = null;

  test(
    "User 1 creates an assistant",
    { tag: TAG_CI },
    async ({ browser }) => {
      // Create context for user1
      const context1 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page1 = await context1.newPage();

      try {
        // Navigate to the app
        await page1.goto("/");

        // Get scenario data containing test user credentials
        const scenarioData = await getScenarioData(page1);
        expect(scenarioData).toBeTruthy();
        expect(scenarioData?.entraid_user1_email).toBeTruthy();
        expect(scenarioData?.entraid_user1_password).toBeTruthy();

        console.log(
          `[ASSISTANT_SHARING] Logging in with user1: ${scenarioData!.entraid_user1_email}`,
        );

        // Perform Entra ID login for user1
        await loginWithEntraId(
          page1,
          scenarioData!.entraid_user1_email,
          scenarioData!.entraid_user1_password,
        );

        // Verify successful login
        await expect(
          page1.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        console.log("[ASSISTANT_SHARING] ✅ User 1 logged in successfully");

        // Generate a unique name for the assistant
        const randomSuffix = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        assistantName = `Shared Assistant-${randomSuffix}`;

        // Navigate to assistants page
        await page1.goto("/assistants");
        await page1.waitForTimeout(500);

        // Create the assistant
        const createButton = page1.getByRole("button", {
          name: /create.*assistant|new.*assistant/i,
        });
        await expect(createButton).toBeVisible();
        await createButton.click();

        // Wait for the form to load
        await expect(
          page1.getByRole("heading", { name: /create assistant/i }),
        ).toBeVisible();

        // Fill in basic fields
        await page1.getByLabel(/name/i).fill(assistantName);
        await page1
          .getByLabel(/description/i)
          .fill("An assistant for testing sharing between users");
        await page1
          .getByLabel(/system prompt/i)
          .fill("You are a helpful assistant for testing sharing.");

        // Submit the form
        await page1.getByRole("button", { name: /create assistant/i }).click();

        // Wait for success message and redirect
        await expect(
          page1.getByText(/assistant created successfully/i),
        ).toBeVisible({ timeout: 5000 });

        // Should redirect to assistants list
        await page1.waitForURL("/assistants", { timeout: 5000 });

        // Verify the assistant appears in the list
        await expect(
          page1.getByRole("heading", { name: assistantName }),
        ).toBeVisible();

        console.log(
          `[ASSISTANT_SHARING] ✅ User 1 created assistant: ${assistantName}`,
        );
      } finally {
        await context1.close();
      }
    },
  );

  test(
    "User 2 cannot see the assistant yet",
    { tag: TAG_CI },
    async ({ browser }) => {
      // Create context for user2
      const context2 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page2 = await context2.newPage();

      try {
        // Intercept the profile API call to capture user2's display name
        let profileResponse: any = null;
        const profilePromise = page2.waitForResponse(
          (resp) => resp.url().includes("/api/v1beta/me/profile") && resp.status() === 200,
          { timeout: 30000 }
        ).then(async (resp) => {
          profileResponse = await resp.json();
          return resp;
        });

        // Navigate to the app
        await page2.goto("/");

        // Get scenario data containing test user credentials
        const scenarioData = await getScenarioData(page2);
        expect(scenarioData).toBeTruthy();
        expect(scenarioData?.entraid_user2_email).toBeTruthy();
        expect(scenarioData?.entraid_user2_password).toBeTruthy();

        console.log(
          `[ASSISTANT_SHARING] Logging in with user2: ${scenarioData!.entraid_user2_email}`,
        );

        // Perform Entra ID login for user2
        await loginWithEntraId(
          page2,
          scenarioData!.entraid_user2_email,
          scenarioData!.entraid_user2_password,
        );

        // Verify successful login
        await expect(
          page2.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        console.log("[ASSISTANT_SHARING] ✅ User 2 logged in successfully");

        // Wait for the profile API call to complete and capture user2's display name
        await profilePromise;
        expect(profileResponse).not.toBeNull();
        user2DisplayName = profileResponse.name;
        console.log(
          `[ASSISTANT_SHARING] Captured user2 display name: ${user2DisplayName}`,
        );

        // Navigate to assistants page
        await page2.goto("/assistants");
        await page2.waitForTimeout(500);

        // Verify assistantName is set
        expect(assistantName).not.toBeNull();

        // Verify the assistant is NOT visible to user2
        const assistantHeading = page2.getByRole("heading", {
          name: assistantName!,
        });
        await expect(assistantHeading).not.toBeVisible();

        console.log(
          `[ASSISTANT_SHARING] ✅ Confirmed that user 2 cannot see assistant: ${assistantName}`,
        );
      } finally {
        await context2.close();
      }
    },
  );

  test(
    "User 1 shares the assistant with User 2",
    { tag: TAG_CI },
    async ({ browser }) => {
      // Create context for user1
      const context1 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page1 = await context1.newPage();

      try {
        // Navigate to the app
        await page1.goto("/");

        // Get scenario data containing test user credentials
        const scenarioData = await getScenarioData(page1);
        expect(scenarioData).toBeTruthy();
        expect(scenarioData?.entraid_user1_email).toBeTruthy();
        expect(scenarioData?.entraid_user1_password).toBeTruthy();

        // Perform Entra ID login for user1
        await loginWithEntraId(
          page1,
          scenarioData!.entraid_user1_email,
          scenarioData!.entraid_user1_password,
        );

        // Verify successful login
        await expect(
          page1.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        // Navigate to assistants page
        await page1.goto("/assistants");
        await page1.waitForTimeout(500);

        // Verify assistantName is set
        expect(assistantName).not.toBeNull();

        // Find the assistant card
        const assistantButton = page1.getByRole("button", {
          name: new RegExp(assistantName!),
        });
        await expect(assistantButton).toBeVisible();

        // Find the three dot menu button within the assistant card
        const assistantCard = assistantButton.locator("..");
        const menuButton = assistantCard.getByRole("button", {
          name: /menu|more|options/i,
        });
        await expect(menuButton).toBeVisible();
        await menuButton.click();

        // Click the share option in the dropdown
        const shareOption = page1.getByRole("menuitem", { name: /share/i });
        await expect(shareOption).toBeVisible();
        await shareOption.click();

        // Wait for sharing dialog to appear
        await expect(
          page1.getByRole("dialog", { name: /share/i }),
        ).toBeVisible({ timeout: 5000 });

        console.log("[ASSISTANT_SHARING] ✅ Sharing dialog opened");

        // Verify we have user2's display name from the earlier test
        expect(user2DisplayName).not.toBeNull();
        console.log(
          `[ASSISTANT_SHARING] Using captured user2 display name: ${user2DisplayName}`,
        );

        // Find the search input field
        const userSearchInput = page1.getByRole("searchbox");
        await expect(userSearchInput).toBeVisible({ timeout: 5000 });

        // Type user2's display name to search for them
        await userSearchInput.fill(user2DisplayName!);
        console.log(
          `[ASSISTANT_SHARING] Searching for user: ${user2DisplayName}`,
        );

        // Wait for search results to load
        await page1.waitForTimeout(1500);

        // Try to find user2 by checking for checkboxes in the results
        // The user row will contain display_name and a checkbox
        const allCheckboxes = page1.locator('input[type="checkbox"]');
        const checkboxCount = await allCheckboxes.count();

        console.log(
          `[ASSISTANT_SHARING] Found ${checkboxCount} checkboxes in search results`,
        );

        // Try to find a checkbox with aria-label matching user2's display name
        let user2Found = false;

        // Strategy 1: Look for checkbox with aria-label containing user2's display name
        for (let i = 0; i < checkboxCount; i++) {
          const checkbox = allCheckboxes.nth(i);
          const ariaLabel = await checkbox.getAttribute("aria-label");

          if (
            ariaLabel &&
            ariaLabel.toLowerCase().includes(user2DisplayName!.toLowerCase())
          ) {
            await checkbox.check();
            user2Found = true;
            console.log(
              `[ASSISTANT_SHARING] ✅ Selected user via aria-label: ${ariaLabel}`,
            );
            break;
          }
        }

        // Strategy 2: Look for text containing user2's display name and select the checkbox in that row
        if (!user2Found) {
          const userRows = page1.locator(
            `div:has-text("${user2DisplayName}"):has(input[type="checkbox"])`,
          );
          const userRowCount = await userRows.count();

          console.log(
            `[ASSISTANT_SHARING] Found ${userRowCount} user rows matching display name`,
          );

          if (userRowCount > 0) {
            // Click the first matching user row's checkbox
            const firstCheckbox = userRows.first().locator('input[type="checkbox"]').nth(0);
            await firstCheckbox.check();
            user2Found = true;
            console.log(
              `[ASSISTANT_SHARING] ✅ Selected user via display name: ${user2DisplayName}`,
            );
          }
        }

        if (!user2Found) {
          // Take a screenshot for debugging
          await page1.screenshot({
            path: "test-results/sharing-dialog-no-users.png",
          });
          throw new Error(
            `Could not find user2 (${user2DisplayName}) in sharing dialog. Screenshot saved to test-results/sharing-dialog-no-users.png`,
          );
        }

        // Click the "Add" or "Share" button to grant access
        // The Add button should be within the sharing dialog
        const sharingDialog = page1.getByRole("dialog", { name: /share/i });
        const addButton = sharingDialog.getByRole("button", { name: "Add" });
        await expect(addButton).toBeVisible({ timeout: 5000 });
        await addButton.click();

        // Wait a moment for the share grant to be created
        await page1.waitForTimeout(2000);

        // Check for success message (it's optional, so we just log if we see it)
        const successAlert = sharingDialog.getByText(/access granted|granted successfully/i);
        const alertVisible = await successAlert.isVisible().catch(() => false);

        if (alertVisible) {
          console.log(
            `[ASSISTANT_SHARING] ✅ Success alert visible - sharing confirmed`,
          );
        } else {
          console.log(
            `[ASSISTANT_SHARING] ℹ️ No success alert visible, but proceeding (will verify in next test)`,
          );
        }

        console.log(
          `[ASSISTANT_SHARING] ✅ Completed sharing operation`,
        );

        // Close the sharing dialog
        const closeButton = page1.getByRole("button", { name: /close|done/i });
        if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await closeButton.click();
        } else {
          // Try pressing Escape key
          await page1.keyboard.press("Escape");
        }

        // Wait for dialog to close
        await expect(
          page1.getByRole("dialog", { name: /share/i }),
        ).not.toBeVisible({ timeout: 3000 });

        console.log("[ASSISTANT_SHARING] ✅ Sharing dialog closed");
      } finally {
        await context1.close();
      }
    },
  );

  test(
    "User 2 can now see the shared assistant",
    { tag: TAG_CI },
    async ({ browser }) => {
      // Create context for user2
      const context2 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page2 = await context2.newPage();

      try {
        // Navigate to the app
        await page2.goto("/");

        // Get scenario data containing test user credentials
        const scenarioData = await getScenarioData(page2);
        expect(scenarioData).toBeTruthy();

        // Perform Entra ID login for user2
        await loginWithEntraId(
          page2,
          scenarioData!.entraid_user2_email,
          scenarioData!.entraid_user2_password,
        );

        // Verify successful login
        await expect(
          page2.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        // Navigate to assistants page
        await page2.goto("/assistants");
        await page2.waitForTimeout(500);

        // Verify assistantName is set
        expect(assistantName).not.toBeNull();

        // Reload the page to ensure we get the updated list with shared assistants
        await page2.reload();
        await page2.waitForTimeout(1000);

        // Take a screenshot for debugging
        await page2.screenshot({
          path: `test-results/user2-assistants-after-share-${assistantName}.png`,
        });

        // Debug: Check what assistants are actually on the page
        const allHeadings = await page2.getByRole("heading").allTextContents();
        console.log(
          `[ASSISTANT_SHARING] All assistant headings on page: ${JSON.stringify(allHeadings)}`,
        );

        // Verify the assistant is NOW visible to user2
        const assistantHeading = page2.getByRole("heading", {
          name: assistantName!,
        });
        await expect(assistantHeading).toBeVisible({ timeout: 10000 });

        console.log(
          `[ASSISTANT_SHARING] ✅ User 2 can now see the shared assistant: ${assistantName}`,
        );
      } finally {
        await context2.close();
      }
    },
  );

  test(
    "User 2 starts a chat with the shared assistant",
    { tag: TAG_CI },
    async ({ browser }) => {
      // Create context for user2
      const context2 = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const page2 = await context2.newPage();

      try {
        // Navigate to the app
        await page2.goto("/");

        // Get scenario data containing test user credentials
        const scenarioData = await getScenarioData(page2);
        expect(scenarioData).toBeTruthy();

        // Perform Entra ID login for user2
        await loginWithEntraId(
          page2,
          scenarioData!.entraid_user2_email,
          scenarioData!.entraid_user2_password,
        );

        // Verify successful login
        await expect(
          page2.getByRole("textbox", { name: "Type a message..." }),
        ).toBeVisible({ timeout: 15000 });

        // Navigate to assistants page
        await page2.goto("/assistants");
        await page2.waitForTimeout(500);

        // Verify assistantName is set
        expect(assistantName).not.toBeNull();

        // Find and click the shared assistant
        const assistantButton = page2.getByRole("button", {
          name: new RegExp(assistantName!),
        });
        await expect(assistantButton).toBeVisible();
        await assistantButton.click();

        // Should navigate to assistant chat
        await expect(
          page2.getByRole("textbox", { name: /type a message/i }),
        ).toBeVisible();

        // Verify we're in the assistant's chat context (URL should contain assistant ID)
        expect(page2.url()).toContain("/a/");

        console.log(
          `[ASSISTANT_SHARING] ✅ User 2 started a chat with the shared assistant`,
        );

        // Send a message to the assistant
        const textbox = page2.getByRole("textbox", { name: /type a message/i });
        await textbox.fill("Hello! This is a test message from user 2.");
        await textbox.press("Enter");

        // Wait for assistant response
        await chatIsReadyToChat(page2, { expectAssistantResponse: true });

        // Verify that a response was received
        await expect(page2.getByTestId("message-assistant")).toBeVisible();

        console.log(
          `[ASSISTANT_SHARING] ✅ User 2 successfully received a response from the shared assistant`,
        );
      } finally {
        await context2.close();
      }
    },
  );
});
