import { test, expect } from '@playwright/test';

test('Can login', async ({ page }) => {
  await page.goto("/");

  await page.getByRole('button', { name: 'Sign in with Dex' }).click();
  await page.waitForURL((url) => url.pathname.includes("auth"));
  // await page.getByRole('textbox', { name: 'email address' }).click();
  await page.getByRole('textbox', { name: 'email address' }).fill('admin@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('admin');
  await page.getByRole('textbox', { name: 'Password' }).press('Enter');
  await page.getByRole('button', { name: 'Grant Access' }).click();

  await expect(page.getByRole('textbox', { name: 'Type a message...' })).toBeVisible();
});