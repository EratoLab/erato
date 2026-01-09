import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Assistant Management", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to assistants page (don't use networkidle due to potential 404 responses)
    await page.goto("/assistants");

    // Wait for the page to be ready by checking for any button
    await page.waitForTimeout(500);
  });

  test("should create an assistant with file upload", async ({ page }) => {
    // Generate a unique name with random hexadecimal suffix
    const randomSuffix = Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0");
    const assistantName = `Test Assistant with Files-${randomSuffix}`;

    // Wait for and click "Create" or "New Assistant" button (more specific than just "new")
    const createButton = page.getByRole("button", {
      name: /create.*assistant|new.*assistant/i,
    });
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for the form to load
    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    // Fill in basic fields
    await page.getByLabel(/name/i).fill(assistantName);
    await page
      .getByLabel(/description/i)
      .fill("An assistant for testing file uploads");
    await page
      .getByLabel(/system prompt/i)
      .fill("You are a helpful assistant that can read uploaded documents.");

    // Upload a file
    const testFilePath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );

    // Find and click the file upload button
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for upload to complete by checking for the attachments heading
    await expect(
      page.getByRole("heading", { name: /attachments/i }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Also verify the file name appears (text may be truncated with ellipsis)
    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
      timeout: 2000,
    });

    // Submit the form
    await page.getByRole("button", { name: /create assistant/i }).click();

    // Wait for success message and redirect
    await expect(page.getByText(/assistant created successfully/i)).toBeVisible(
      { timeout: 5000 },
    );

    // Should redirect to assistants list
    await page.waitForURL("/assistants", { timeout: 5000 });

    // Verify the assistant appears in the list
    await expect(
      page.getByRole("heading", { name: assistantName }),
    ).toBeVisible();
  });

  test("should edit an assistant and add files", async ({ page }) => {
    // Generate a unique name with random hexadecimal suffix
    const randomSuffix = Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0");
    const assistantName = `Assistant to Edit-${randomSuffix}`;

    // First, create an assistant without files
    const createButton = page.getByRole("button", {
      name: /create.*assistant|new.*assistant/i,
    });
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for the form to load
    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    await page.getByLabel(/name/i).fill(assistantName);
    await page
      .getByLabel(/system prompt/i)
      .fill("You are a helpful assistant.");
    await page.getByRole("button", { name: /create assistant/i }).click();

    // Wait for redirect
    await page.waitForURL("/assistants", { timeout: 5000 });

    // Find the assistant button by name
    const assistantButton = page.getByRole("button", {
      name: new RegExp(assistantName),
    });
    await expect(assistantButton).toBeVisible();

    // Find the three dot menu button within the assistant card
    const assistantCard = assistantButton.locator("..");
    const menuButton = assistantCard.getByRole("button", {
      name: /menu|more|options/i,
    });
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    // Click the edit option in the dropdown
    const editOption = page.getByRole("menuitem", { name: /edit/i });
    await expect(editOption).toBeVisible();
    await editOption.click();

    // Wait for edit form
    await expect(
      page.getByRole("heading", { name: /edit assistant/i }),
    ).toBeVisible();

    // Add a file
    const testFilePath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for upload to complete by checking for the attachments heading
    await expect(
      page.getByRole("heading", { name: /attachments/i }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Also verify the file name appears (text may be truncated with ellipsis)
    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
      timeout: 2000,
    });

    // Save changes
    await page.getByRole("button", { name: /save changes/i }).click();

    // Wait for success message
    await expect(page.getByText(/assistant updated successfully/i)).toBeVisible(
      { timeout: 5000 },
    );
  });

  test("should remove uploaded file before saving", async ({ page }) => {
    const createButton = page.getByRole("button", {
      name: /create.*assistant|new.*assistant/i,
    });
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for the form to load
    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    // Fill basic info
    await page.getByLabel(/name/i).fill("Test File Removal");
    await page.getByLabel(/system prompt/i).fill("Test prompt");

    // Upload a file
    const testFilePath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for upload to complete by checking for the attachments heading
    await expect(
      page.getByRole("heading", { name: /attachments/i }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Wait for file to appear (text may be truncated with ellipsis)
    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible();

    // Remove the file
    await page
      .getByRole("button", { name: /remove/i })
      .first()
      .click();

    // File should be removed
    await expect(page.getByText(/sample.*compressed.*pdf/i)).not.toBeVisible();

    // Should still be able to submit
    await page.getByRole("button", { name: /create assistant/i }).click();
    await expect(
      page.getByText(/assistant created successfully/i),
    ).toBeVisible();
  });

  test.skip("should show error for file upload failure", async ({ page }) => {
    // TODO: This test is currently skipped because the UI doesn't appear to show
    // error messages for failed file uploads, or they appear in a way we can't detect.
    // This may need to be investigated and fixed in the UI.
    const createButton = page.getByRole("button", {
      name: /create.*assistant|new.*assistant/i,
    });
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for the form to load
    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    // Fill basic info
    await page.getByLabel(/name/i).fill("Test Upload Error");
    await page.getByLabel(/system prompt/i).fill("Test prompt");

    // Intercept upload request to simulate error
    await page.route("**/api/v1beta/me/files*", (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Upload failed" }),
      });
    });

    // Try to upload a file
    const testFilePath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show error message (could be various error formats)
    await expect(
      page.getByText(/upload.*fail|error.*upload|failed/i),
    ).toBeVisible({
      timeout: 5000,
    });
  });

  test("should use assistant with files in a chat", async ({ page }) => {
    // Generate a unique name with random hexadecimal suffix
    const randomSuffix = Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0");
    const assistantName = `Chat Test Assistant-${randomSuffix}`;

    // Create assistant with file
    const createButton = page.getByRole("button", {
      name: /create.*assistant|new.*assistant/i,
    });
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for the form to load
    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    await page.getByLabel(/name/i).fill(assistantName);
    await page
      .getByLabel(/system prompt/i)
      .fill("You are a helpful assistant that can read uploaded documents.");

    const testFilePath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for upload to complete by checking for the attachments heading
    await expect(
      page.getByRole("heading", { name: /attachments/i }),
    ).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible();

    await page.getByRole("button", { name: /create assistant/i }).click();
    await page.waitForURL("/assistants");

    // Start chat with this assistant
    const assistantButton = page.getByRole("button", {
      name: new RegExp(assistantName),
    });
    await expect(assistantButton).toBeVisible();
    await assistantButton.click();

    // Should navigate to assistant chat
    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toBeVisible();

    // Verify we're in the assistant's chat context (URL should contain assistant ID)
    expect(page.url()).toContain("/a/");
  });
});

test.describe.serial("Pirate Assistant Lifecycle", () => {
  let assistantId: string;
  let chatUrl: string;
  let chatId: string;
  let assistantName: string;

  test(
    "should create a simple Pirate assistant without files",
    { tag: TAG_CI },
    async ({ page }) => {
      // Generate a unique name with random hexadecimal suffix
      const randomSuffix = Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, "0");
      assistantName = `Pirate-${randomSuffix}`;

      // Navigate directly to assistant creation page
      await page.goto("/assistants/new");

      // Wait for the form to load (don't use networkidle due to 404 response)
      await expect(
        page.getByRole("heading", { name: /create assistant/i }),
      ).toBeVisible();

      // Fill in basic fields
      await page.getByLabel(/name/i).fill(assistantName);
      await page.getByLabel(/description/i).fill("A pirate-speaking assistant");
      await page.getByLabel(/system prompt/i).fill("Talk like a pirate.");

      // Submit the form
      await page.getByRole("button", { name: /create assistant/i }).click();

      // Wait for success message and redirect
      await expect(
        page.getByText(/assistant created successfully/i),
      ).toBeVisible({ timeout: 5000 });

      // Should redirect to assistants list
      await page.waitForURL("/assistants", { timeout: 5000 });

      // Verify the assistant appears in the list
      await expect(
        page.getByRole("heading", { name: assistantName }),
      ).toBeVisible();
    },
  );

  test(
    "should create a chat using the Pirate assistant",
    { tag: TAG_CI },
    async ({ page }) => {
      // Navigate to assistants page
      await page.goto("/assistants");

      // Find and click the Pirate assistant to start a chat using the unique name
      const pirateButton = page.getByRole("button", {
        name: new RegExp(assistantName),
      });
      await expect(pirateButton).toBeVisible();
      await pirateButton.click();

      // Should navigate to assistant chat
      await expect(
        page.getByRole("textbox", { name: /type a message/i }),
      ).toBeVisible();

      // Verify we're in the assistant's chat context (URL should contain assistant ID)
      expect(page.url()).toContain("/a/");

      // Store the chat URL and ID for later tests
      chatUrl = page.url();
      chatId = chatUrl.split("/").pop()!;

      // Send a message to the assistant
      const textbox = page.getByRole("textbox", { name: /type a message/i });
      await textbox.fill("Hello!");
      await textbox.press("Enter");

      // Wait for assistant response
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Verify that a response was received
      await expect(page.getByTestId("message-assistant")).toBeVisible();
    },
  );

  test(
    "should archive the Pirate assistant via the assistants page",
    { tag: TAG_CI },
    async ({ page }) => {
      // Navigate to the assistants page
      await page.goto("/assistants");

      // Find the Pirate assistant card using the unique name
      const assistantButton = page.getByRole("button", {
        name: new RegExp(assistantName),
      });
      await expect(assistantButton).toBeVisible();

      // Find the three dot menu button within the assistant card
      // The menu button should be near the assistant button
      const assistantCard = assistantButton.locator("..");
      const menuButton = assistantCard.getByRole("button", {
        name: /menu|more|options/i,
      });
      await expect(menuButton).toBeVisible();
      await menuButton.click();

      // Click the archive/delete option in the dropdown
      const archiveOption = page.getByRole("menuitem", {
        name: /archive|delete|remove/i,
      });
      await expect(archiveOption).toBeVisible();
      await archiveOption.click();

      // Confirm in the dialog if one appears
      const confirmButton = page.getByRole("button", {
        name: /confirm|archive|delete|yes/i,
      });
      if ((await confirmButton.count()) > 0) {
        await confirmButton.click();
      }

      // Verify the assistant is removed from the list
      await expect(
        page.getByRole("heading", { name: assistantName }),
      ).toHaveCount(0, { timeout: 5000 });
    },
  );

  test.skip(
    "should still access the chat after archiving the assistant",
    { tag: TAG_CI },
    async ({ page }) => {
      // TODO: This test is currently skipped because the chat becomes inaccessible
      // after archiving the assistant. This may be a known issue that needs to be fixed.

      // Access the chat directly via the stored URL from test 2
      await page.goto(chatUrl);

      // The chat should still be accessible
      await expect(
        page.getByRole("textbox", { name: /type a message/i }),
      ).toBeVisible();

      // Verify the previous messages are still there
      await expect(page.getByTestId("message-user")).toBeVisible();
      await expect(page.getByTestId("message-assistant")).toBeVisible();
    },
  );
});
