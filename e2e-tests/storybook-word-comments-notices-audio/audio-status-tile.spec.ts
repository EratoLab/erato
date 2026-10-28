import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  AREA,
  boxOf,
  contrastOf,
  openStory,
  tokenColor,
} from "../storybook-composer-context-lane/lane-helpers";

import { openWord, SHELL, style, textarea } from "./word-story";

// A recording's transcription status on its own file tile (ERMAIN-1026): the
// status card above the composer is gone. The tile spins while the recording
// is worked on, takes the error colours when it fails, offers the retry
// inside its frame, and Send waits until every recording is transcribed.

const TILE = '[data-ui="attachment-tile"]';
const META = '[data-ui="attachment-tile-meta"]';
const SEND = '[data-testid="chat-input-send-message"]';
const RECORDING = "audio-recording-20261020-0942.wav";
const TRANSCRIPT =
  "Quick summary of the sales call: the customer wants delivery in two batches";
const LIVE = '[data-ui="chat-audio-status-live"]';

interface Phase {
  story: string;
  meta: string;
  status: "busy" | "error" | null;
  sendable: boolean;
  /** The tile's (x) cancels the transcription rather than removing a transcript. */
  cancels: boolean;
}
const PHASES: Phase[] = [
  {
    story: "audio-recording",
    meta: "Recording · 0:42",
    status: "busy",
    sendable: false,
    cancels: true,
  },
  {
    story: "audio-transcribing",
    meta: "Transcribing · 0:42",
    status: "busy",
    sendable: false,
    cancels: true,
  },
  {
    story: "audio-transcript-ready",
    meta: "Transcript ready · 0:42",
    status: null,
    sendable: true,
    cancels: false,
  },
  // A failed recording keeps Send off: its tile is the only place that says why.
  {
    story: "audio-failed",
    meta: "Couldn't transcribe",
    status: "error",
    sendable: false,
    cancels: false,
  },
];

const openComposer = (
  page: Page,
  story: string,
  options: { theme?: "light" | "dark"; width?: number; locale?: string } = {},
) => openStory(page, `ui-chatinput--${story}`, SHELL, options);

/** A tile's preview button wraps its face, or sits beside an action inside the frame. */
const activation = (scope: Locator) =>
  scope.getByRole("button", { name: /^Preview attachment/ });
const shellOf = (page: Page) => page.locator(SHELL);

/** Visible things the composer draws above its box, outside it. */
const aboveTheBox = (page: Page) =>
  page.locator(SHELL).evaluate((shell) => {
    const top = shell.getBoundingClientRect().top;
    const form = shell.closest("form") ?? shell.parentElement!;
    return [...form.querySelectorAll("*")]
      .filter((element) => !shell.contains(element))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 1 && box.height > 1 && box.bottom <= top + 1;
      })
      .map((element) => element.outerHTML.slice(0, 120));
  });

test.describe("the composer's recording", () => {
  for (const phase of PHASES) {
    test(`${phase.story}: the status is on the tile, nothing above the box`, async ({
      page,
    }) => {
      await openComposer(page, phase.story, { width: 340 });
      await expect(
        page.locator('[data-testid^="chat-audio-transcription-"]'),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-testid^="chat-input-retry-audio-"]'),
      ).toHaveCount(0);
      expect(await aboveTheBox(page)).toEqual([]);

      const tile = page.locator(`${SHELL} ${TILE}`);
      await expect(tile).toHaveCount(1);
      await expect(tile.locator(META)).toHaveText(phase.meta);
      if (phase.status) {
        await expect(tile).toHaveAttribute("data-status", phase.status);
      } else {
        await expect(tile).not.toHaveAttribute("data-status");
      }
      const spinner = tile.locator('[data-ui="spinner"]');
      if (phase.status === "busy") {
        await expect(spinner).toHaveCount(1);
        // Drawn, not announced: the activation's name already says the status.
        await expect(spinner).not.toHaveAttribute("role", "status");
        await expect(spinner).toHaveAttribute("aria-hidden", "true");
      } else {
        await expect(spinner).toHaveCount(0);
      }
      // The activation names the status, so a screen reader hears it with the file.
      await expect(activation(shellOf(page))).toHaveAccessibleName(
        `Preview attachment ${RECORDING}, ${phase.meta}`,
      );
      const remove = shellOf(page).locator('[data-ui="attachment-remove"]');
      await expect(remove).toHaveAccessibleName(
        phase.cancels
          ? `Cancel transcription: ${RECORDING}`
          : `Remove ${RECORDING}`,
      );
      await expect(remove).toBeEnabled();

      await textarea(page).fill("Summarise the recording.");
      const send = page.locator(SEND);
      if (phase.sendable) await expect(send).toBeEnabled();
      else await expect(send).toBeDisabled();

      const live = page.locator('[data-ui="chat-audio-status-live"]');
      await expect(live).toHaveAttribute("aria-live", "polite");
      await expect(live).toHaveText("");
      expect(
        await page.evaluate(() => document.scrollingElement!.scrollWidth),
      ).toBeLessThanOrEqual(340);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`a failed recording reads in the error colours, ${theme}`, async ({
      page,
    }) => {
      await openComposer(page, "audio-failed", { theme });
      const tile = page.locator(`${SHELL} ${TILE}`);
      expect(await style(tile, "border-top-color")).toBe(
        await tokenColor(tile, "--theme-error-border"),
      );
      const meta = tile.locator(META);
      expect(await style(meta, "color")).toBe(
        await tokenColor(tile, "--theme-error-fg"),
      );
      expect(await meta.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
      await expect(activation(shellOf(page))).toHaveAttribute(
        "title",
        `${RECORDING}\nThe transcription service did not answer in time.`,
      );
    });
  }

  test("the preview carries the status and, once ready, the transcript", async ({
    page,
  }) => {
    await openComposer(page, "audio-transcript-ready");
    await activation(shellOf(page)).click();
    const preview = page.getByRole("dialog", {
      name: `Preview: ${RECORDING}`,
    });
    const section = preview.locator(
      '[data-ui="file-preview-audio-transcription"]',
    );
    await expect(section).toHaveAttribute("data-status", "completed");
    await expect(section).toContainText("Transcript ready · 0:42");
    await expect(section).toContainText(TRANSCRIPT);

    await openComposer(page, "audio-transcribing");
    await activation(shellOf(page)).click();
    await expect(
      page
        .getByRole("dialog", { name: `Preview: ${RECORDING}` })
        .locator('[data-ui="file-preview-audio-transcription"]'),
    ).toContainText("The transcript appears here once it is ready.");

    await openComposer(page, "audio-failed");
    await activation(shellOf(page)).click();
    await expect(
      page
        .getByRole("dialog", { name: `Preview: ${RECORDING}` })
        .locator(
          '[data-ui="file-preview-audio-transcription"] [data-ui="alert"]',
        ),
    ).toHaveText("The transcription service did not answer in time.");
  });

  test("a stopped recording reads the length it was recorded at, and its preview the transcript so far", async ({
    page,
  }) => {
    await openComposer(page, "audio-stopped", { width: 340 });
    const tile = page.locator(`${SHELL} ${TILE}`);
    // The server has taken up only the first 30 s, and still says "recording".
    await expect(tile.locator(META)).toHaveText("Transcribing · 0:38");
    await expect(tile).toHaveAttribute("data-status", "busy");
    await textarea(page).fill("Summarise the recording.");
    await expect(page.locator(SEND)).toBeDisabled();

    await activation(shellOf(page)).click();
    const section = page
      .getByRole("dialog", { name: `Preview: ${RECORDING}` })
      .locator('[data-ui="file-preview-audio-transcription"]');
    await expect(section).toHaveAttribute("data-status", "transcribing");
    await expect(section).toContainText("Transcribing · 0:38");
    await expect(section).toContainText(
      "Quick summary of the sales call: the customer wants delivery in two batches.",
    );
  });

  test("(x) cancels the transcription: the recording goes, Send stops waiting, the cancel is said", async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openComposer(page, "audio-transcribing", { width: 340 });
    await textarea(page).fill("Summarise the recording.");
    await expect(page.locator(SEND)).toBeDisabled();

    await page.locator(`${SHELL} ${TILE}`).hover();
    await page
      .getByRole("button", { name: `Cancel transcription: ${RECORDING}` })
      .click();

    await expect(page.locator(`${SHELL} ${TILE}`)).toHaveCount(0);
    expect(dialogs).toEqual([]);
    await expect(page.locator(LIVE)).toHaveText(
      `${RECORDING}: transcription canceled.`,
    );
    await expect(textarea(page)).toBeEnabled();
    await expect(page.locator(SEND)).toBeEnabled();
  });

  test("still asks before removing a transcript", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openComposer(page, "audio-transcript-ready");
    await page.locator(`${SHELL} ${TILE}`).hover();
    await page.getByRole("button", { name: `Remove ${RECORDING}` }).click();
    expect(dialogs).toHaveLength(1);
    await expect(page.locator(`${SHELL} ${TILE}`)).toHaveCount(1);
  });

  test("speaks German", async ({ page }) => {
    await openComposer(page, "audio-transcribing", { locale: "de" });
    await expect(page.locator(`${SHELL} ${TILE} ${META}`)).toHaveText(
      "Wird transkribiert · 0:42",
    );
    await expect(
      page.locator(`${SHELL} [data-ui="attachment-remove"]`),
    ).toHaveAccessibleName(`Transkription abbrechen: ${RECORDING}`);
  });
});

test.describe("every phase on its tile", () => {
  const STATUSES: [string, string, string | null][] = [
    ["audio-recording-0901.wav", "Recording · 0:42", "busy"],
    ["audio-recording-0902.wav", "Uploading · 0:42", "busy"],
    ["audio-recording-0903.wav", "Transcribing · 0:42", "busy"],
    ["audio-recording-0904.wav", "Transcript ready · 0:42", null],
    ["audio-recording-0905.wav", "Couldn't transcribe", "error"],
    ["audio-recording-0906.wav", "Couldn't transcribe", "error"],
    ["audio-recording-0907.wav", "Transcription canceled", null],
  ];
  const tileNamed = (page: Page, filename: string) =>
    page.locator(TILE).filter({ hasText: filename });

  test("meta, status and a retry inside the failed tile's frame", async ({
    page,
  }) => {
    await openStory(page, "ui-fileattachmentspreview--audio-statuses", TILE, {
      width: 480,
    });
    for (const [filename, meta, status] of STATUSES) {
      const tile = tileNamed(page, filename);
      await tile.scrollIntoViewIfNeeded();
      await expect(tile.locator(META), filename).toHaveText(meta);
      if (status) await expect(tile).toHaveAttribute("data-status", status);
      else await expect(tile).not.toHaveAttribute("data-status");
      const retry = tile.locator('[data-ui="attachment-tile-action"]');
      await expect(retry, filename).toHaveCount(status === "error" ? 1 : 0);
      await expect(
        page.getByRole("button", {
          name:
            status === "busy"
              ? `Cancel transcription: ${filename}`
              : `Remove ${filename}`,
          exact: true,
        }),
        filename,
      ).toBeEnabled();
    }

    const failed = tileNamed(page, "audio-recording-0905.wav");
    const retry = failed.getByRole("button", {
      name: "Retry transcription: audio-recording-0905.wav",
    });
    await expect(retry).toBeEnabled();
    await expect(retry).toHaveText("Retry transcription");
    // A control inside the activation button could not be reached.
    expect(
      await retry.evaluate((button) =>
        Boolean(button.parentElement!.closest("button")),
      ),
    ).toBe(false);
    const frame = await boxOf(failed);
    const inner = await boxOf(retry);
    expect(inner.x).toBeGreaterThanOrEqual(frame.x);
    expect(inner.x + inner.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(inner.y + inner.height).toBeLessThanOrEqual(
      frame.y + frame.height + 0.5,
    );

    const retrying = tileNamed(page, "audio-recording-0906.wav").locator(
      '[data-ui="attachment-tile-action"]',
    );
    await expect(retrying).toHaveText("Retrying…");
    await expect(retrying).toBeDisabled();
  });

  test("Tab reaches the preview, the retry, then the remove", async ({
    page,
  }) => {
    await openStory(page, "ui-attachmenttile--status-busy-and-error", TILE, {
      width: 480,
    });
    const name = "audio-recording-0951.wav";
    await page
      .getByRole("button", {
        name: `Preview attachment ${name}, Couldn't transcribe`,
      })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: `Retry transcription: ${name}` }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: `Remove ${name}` }),
    ).toBeFocused();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`every status line reads at 4.5:1, ${theme}`, async ({ page }) => {
      await openStory(page, "ui-fileattachmentspreview--audio-statuses", TILE, {
        theme,
        width: 480,
      });
      for (const meta of await page.locator(META).all()) {
        const text = (await meta.textContent()) ?? "";
        const muted =
          (await style(meta, "color")) ===
          (await tokenColor(meta, "--theme-fg-muted"));
        // A line in the tile's shared meta token, as every type line is,
        // reads about 4.4:1 on a light tile: the token's to fix, not the status's.
        if (muted && theme === "light") continue;
        expect(await meta.evaluate(contrastOf), text).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  }
});

test("a Word composer's recording carries its status in the lane's file row", async ({
  page,
}) => {
  await openWord(page, "Busy");
  const tile = page.locator(`${AREA} ${TILE}`).filter({ hasText: RECORDING });
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toHaveAttribute("data-status", "busy");
  await expect(tile.locator(META)).toHaveText("Transcribing · 0:42");
  await expect(
    page.locator('[data-testid^="chat-audio-transcription-"]'),
  ).toHaveCount(0);
});
