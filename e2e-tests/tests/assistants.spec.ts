import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Assistant Management", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to assistants page
    await page.goto("/assistants");
    await page.waitForLoadState("networkidle");
  });

  test("should create an assistant with file upload", async ({ page }) => {
    // Click "Create New" button
    await page.getByRole("button", { name: /create|new/i }).click();
    
    // Wait for the form to load
    await expect(page.getByRole("heading", { name: /create assistant/i })).toBeVisible();

    // Fill in basic fields
    await page.getByLabel(/name/i).fill("Test Assistant with Files");
    await page.getByLabel(/description/i).fill("An assistant for testing file uploads");
    await page.getByLabel(/system prompt/i).fill("You are a helpful assistant that can read uploaded documents.");

    // Upload a file
    const testFilePath = path.join(__dirname, "../test-files/sample-report-compressed.pdf");
    
    // Find and click the file upload button
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for upload to complete
    await expect(page.getByText(/sample-report-compressed\.pdf/i)).toBeVisible({ timeout: 10000 });

    // Submit the form
    await page.getByRole("button", { name: /create assistant/i }).click();

    // Wait for success message and redirect
    await expect(page.getByText(/assistant created successfully/i)).toBeVisible({ timeout: 5000 });
    
    // Should redirect to assistants list
    await page.waitForURL("/assistants", { timeout: 5000 });

    // Verify the assistant appears in the list
    await expect(page.getByText("Test Assistant with Files")).toBeVisible();
  });

  test("should edit an assistant and add files", async ({ page }) => {
    // First, create an assistant without files
    await page.getByRole("button", { name: /create|new/i }).click();
    await page.getByLabel(/name/i).fill("Assistant to Edit");
    await page.getByLabel(/system prompt/i).fill("You are a helpful assistant.");
    await page.getByRole("button", { name: /create assistant/i }).click();
    
    // Wait for redirect
    await page.waitForURL("/assistants", { timeout: 5000 });

    // Find and click edit button for the created assistant
    const assistantCard = page.locator('text="Assistant to Edit"').locator('..');
    await assistantCard.getByRole("button", { name: /edit/i }).click();

    // Wait for edit form
    await expect(page.getByRole("heading", { name: /edit assistant/i })).toBeVisible();

    // Add a file
    const testFilePath = path.join(__dirname, "../test-files/sample-report-compressed.pdf");
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for upload to complete
    await expect(page.getByText(/sample-report-compressed\.pdf/i)).toBeVisible({ timeout: 10000 });

    // Save changes
    await page.getByRole("button", { name: /save changes/i }).click();

    // Wait for success message
    await expect(page.getByText(/assistant updated successfully/i)).toBeVisible({ timeout: 5000 });
  });

  test("should remove uploaded file before saving", async ({ page }) => {
    await page.getByRole("button", { name: /create|new/i }).click();
    
    // Fill basic info
    await page.getByLabel(/name/i).fill("Test File Removal");
    await page.getByLabel(/system prompt/i).fill("Test prompt");

    // Upload a file
    const testFilePath = path.join(__dirname, "../test-files/sample-report-compressed.pdf");
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for file to appear
    await expect(page.getByText(/sample-report-compressed\.pdf/i)).toBeVisible();

    // Remove the file
    await page.getByRole("button", { name: /remove/i }).first().click();

    // File should be removed
    await expect(page.getByText(/sample-report-compressed\.pdf/i)).not.toBeVisible();

    // Should still be able to submit
    await page.getByRole("button", { name: /create assistant/i }).click();
    await expect(page.getByText(/assistant created successfully/i)).toBeVisible();
  });

  test("should show error for file upload failure", async ({ page }) => {
    await page.getByRole("button", { name: /create|new/i }).click();
    
    // Fill basic info
    await page.getByLabel(/name/i).fill("Test Upload Error");
    await page.getByLabel(/system prompt/i).fill("Test prompt");

    // Intercept upload request to simulate error
    await page.route("**/api/v1beta/me/files*", (route) => {
      route.abort("failed");
    });

    // Try to upload a file
    const testFilePath = path.join(__dirname, "../test-files/sample-report-compressed.pdf");
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Should show error message
    await expect(page.getByText(/failed to upload/i)).toBeVisible({ timeout: 5000 });
  });

  test("should use assistant with files in a chat", async ({ page }) => {
    // Create assistant with file
    await page.getByRole("button", { name: /create|new/i }).click();
    await page.getByLabel(/name/i).fill("Chat Test Assistant");
    await page.getByLabel(/system prompt/i).fill("You are a helpful assistant that can read uploaded documents.");
    
    const testFilePath = path.join(__dirname, "../test-files/sample-report-compressed.pdf");
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);
    await expect(page.getByText(/sample-report-compressed\.pdf/i)).toBeVisible();
    
    await page.getByRole("button", { name: /create assistant/i }).click();
    await page.waitForURL("/assistants");

    // Start chat with this assistant
    await page.getByText("Chat Test Assistant").click();

    // Should navigate to assistant chat
    await expect(page.getByRole("textbox", { name: /type a message/i })).toBeVisible();

    // Verify we're in the assistant's chat context (URL should contain assistant ID)
    expect(page.url()).toContain("/a/");
  });
});


