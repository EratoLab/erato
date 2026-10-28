import { expect, test } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

import { chatIsReadyToChat } from "./shared";
import { TAG_CI } from "./tags";

/**
 * A staged recording carries its transcription status on its own file tile
 * (ERMAIN-1026); the status card above the composer is gone. A plain audio
 * upload stays in progress (only the recorder's chunk pipeline completes), so
 * this checks the in-progress tile, the send gate it holds, and that its
 * remove control cancels the transcription.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RECORDING = "sales-summary-1-3.mp3";
const recordingPath = path.join(
  __dirname,
  "../../backend/erato/tests/integration_tests/test_files/audio_recordings",
  RECORDING,
);

test.describe("Composer audio status", () => {
  test(
    "an uploaded recording shows its status on its tile and holds Send until its transcription is canceled",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);

      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles(recordingPath);

      const tile = page
        .locator('[data-ui="attachment-tile"]')
        .filter({ hasText: RECORDING });
      await expect(tile).toBeVisible({ timeout: 30_000 });
      await expect(tile).toHaveAttribute("data-status", "busy");
      await expect(tile.locator('[data-ui="attachment-tile-meta"]')).toHaveText(
        "Transcribing…",
      );
      await expect(
        page.getByRole("button", {
          name: `Preview attachment ${RECORDING}, Transcribing…`,
        }),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid^="chat-audio-transcription-"]'),
      ).toHaveCount(0);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });
      await textbox.fill("Summarise the recording.");
      const send = page.getByTestId("chat-input-send-message");
      await expect(send).toBeDisabled();

      // A transcription still running has no transcript to lose, so its
      // remove control cancels it without asking first.
      const dialogs: string[] = [];
      page.on("dialog", (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      await tile.hover();
      await page
        .getByRole("button", { name: `Cancel transcription: ${RECORDING}` })
        .click();
      await expect(tile).toHaveCount(0);
      expect(dialogs).toEqual([]);
      await expect(
        page.locator('[data-ui="chat-audio-status-live"]'),
      ).toHaveText(`${RECORDING}: transcription canceled.`);
      await expect(send).toBeEnabled();
    },
  );
});
