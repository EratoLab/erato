import { expect, test, type Page } from "@playwright/test";

import {
  openStory,
  tokenColor,
} from "../storybook-composer-context-lane/lane-helpers";
import { PARITY } from "./parity-helpers";

const SHELL = '[data-ui="chat-input-shell"]';
const CHIP = '[data-ui="composer-context-chip"]';

const openGate = (page: Page, story: string, locale?: string) =>
  openStory(page, `${PARITY}--${story}`, SHELL, { locale });

const textarea = (page: Page) => page.locator(`${SHELL} textarea`);
const send = (page: Page) => page.getByTestId("chat-input-send-message");

const placeholderColor = (page: Page) =>
  textarea(page).evaluate(
    (element) => getComputedStyle(element, "::placeholder").color,
  );

// The composer refuses what the server would: uploads an item's estimate
// stands for count with the staged files, per file against the upload size
// and together against the per-message count.
test.describe("The composer's send gate on context items", () => {
  test("an email over the upload size blocks Send until its chip leaves", async ({
    page,
  }) => {
    await openGate(page, "send-gate-size");
    await expect(textarea(page)).toHaveAttribute(
      "placeholder",
      "Cannot send: Re: Offsite agenda.eml exceeds the 50 MB limit. Remove it to send.",
    );
    expect(await placeholderColor(page)).toBe(
      await tokenColor(page.locator(SHELL), "--theme-error-fg"),
    );
    await expect(send(page)).toBeDisabled();
    await expect(send(page)).toHaveAccessibleName(
      "Cannot send: File size limit exceeded",
    );

    await page
      .locator(`${CHIP}[data-kind="outlook.drop"]`)
      .getByRole("button", { name: /^Remove/ })
      .click();
    await expect(page.locator(CHIP)).toHaveCount(0);
    await expect(textarea(page)).toHaveAttribute(
      "placeholder",
      "Type a message...",
    );
    expect(await placeholderColor(page)).toBe(
      await tokenColor(page.locator(SHELL), "--theme-fg-muted"),
    );
    await textarea(page).fill("Summarise the agenda.");
    await expect(send(page)).toBeEnabled();
    await expect(send(page)).toHaveAccessibleName("Send message");
  });

  test("emails and staged files past the count block Send until one leaves", async ({
    page,
  }) => {
    await openGate(page, "send-gate-count");
    await expect(textarea(page)).toHaveAttribute(
      "placeholder",
      "Cannot send: a message can carry at most 3 files. Remove some to send.",
    );
    await expect(send(page)).toBeDisabled();
    await expect(send(page)).toHaveAccessibleName(
      "Cannot send: File count limit exceeded",
    );

    await page
      .getByRole("button", { name: /Remove contract-v3\.pdf/ })
      .first()
      .click();
    await expect(textarea(page)).toHaveAttribute(
      "placeholder",
      "Type a message...",
    );
    await textarea(page).fill("Compare the offers.");
    await expect(send(page)).toBeEnabled();
  });

  test("German placeholder", async ({ page }) => {
    await openGate(page, "send-gate-size", "de");
    await expect(textarea(page)).toHaveAttribute(
      "placeholder",
      "Senden nicht möglich: Re: Offsite agenda.eml überschreitet das Limit von 50 MB. Entfernen Sie die Datei, um zu senden.",
    );
  });
});
