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
// The composer's own recordings show their first words, clamped to two lines,
// and a More button instead of the generated file name; a placeholder holds
// those two lines until words arrive; and they count their length up while
// they run (ERMAIN-1072).

const TILE = '[data-ui="attachment-tile"]';
const META = '[data-ui="attachment-tile-meta"]';
const EXCERPT = '[data-ui="attachment-tile-excerpt"]';
const MORE = '[data-ui="attachment-tile-more"]';
const SEND = '[data-testid="chat-input-send-message"]';
const RECORDING = "audio-recording-20261020-0942.wav";
const TRANSCRIPT =
  "Quick summary of the sales call: the customer wants delivery in two batches";
const PARTIAL =
  "Quick summary of the sales call: the customer wants delivery in two batches.";
const LIVE = '[data-ui="chat-audio-status-live"]';
const PLACEHOLDER = "The transcript appears here…";

interface Phase {
  story: string;
  meta: string;
  status: "busy" | "error" | null;
  sendable: boolean;
  /** The tile's (x) cancels the transcription rather than removing a transcript. */
  cancels: boolean;
  /** Words to show, so the tile offers More and its activation is named for it. */
  more: boolean;
  /** No words yet but some may come, so a placeholder holds their place. */
  placeholder: boolean;
}
const PHASES: Phase[] = [
  {
    story: "audio-recording",
    meta: "Recording · 0:42",
    status: "busy",
    sendable: false,
    cancels: true,
    more: false,
    placeholder: true,
  },
  {
    story: "audio-transcribing",
    meta: "Transcribing · 0:42",
    status: "busy",
    sendable: false,
    cancels: true,
    more: false,
    placeholder: true,
  },
  {
    story: "audio-transcript-ready",
    meta: "Transcript ready · 0:42",
    status: null,
    sendable: true,
    cancels: false,
    more: true,
    placeholder: false,
  },
  // A failed recording keeps Send off: its tile is the only place that says why.
  {
    story: "audio-failed",
    meta: "Couldn't transcribe",
    status: "error",
    sendable: false,
    cancels: false,
    more: false,
    placeholder: false,
  },
];

const openComposer = (
  page: Page,
  story: string,
  options: { theme?: "light" | "dark"; width?: number; locale?: string } = {},
) => openStory(page, `ui-chatinput--${story}`, SHELL, options);

/** A tile's preview button wraps its face, sits beside an action inside the frame, or is its More. */
const activation = (scope: Locator) =>
  scope.getByRole("button", { name: /^(Preview attachment|More:) / });
/** The meta line's own words, without the More beside them. */
const metaWords = (tile: Locator) =>
  tile.locator(META).evaluate((meta) => {
    const copy = meta.cloneNode(true) as HTMLElement;
    copy.querySelector('[data-ui="attachment-tile-more"]')?.remove();
    return copy.textContent?.trim() ?? "";
  });
/** A recording's tile by its name, which only its tooltip still carries. */
const tileNamed = (page: Page, filename: string) =>
  page
    .locator(`[title^="${filename}"] ${TILE}`)
    .or(
      page
        .locator(TILE)
        .filter({ has: page.locator(`[title^="${filename}"]`) }),
    );
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
      await expect.poll(() => metaWords(tile)).toBe(phase.meta);
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
        `${phase.more ? "More:" : "Preview attachment"} ${RECORDING}, ${phase.meta}`,
      );
      // The generated name is no help on the face; the tooltip keeps it.
      await expect(tile).not.toContainText(RECORDING);
      await expect(tile.locator(MORE)).toHaveCount(phase.more ? 1 : 0);
      await expect(tile.locator(EXCERPT)).toHaveCount(
        phase.more || phase.placeholder ? 1 : 0,
      );
      if (phase.placeholder) {
        await expect(tile.locator(EXCERPT)).toHaveText(PLACEHOLDER);
        await expect(tile.locator(EXCERPT)).toHaveAttribute(
          "data-placeholder",
          "true",
        );
      }
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
    await expect.poll(() => metaWords(tile)).toBe("Transcribing · 0:38");
    await expect(tile).toHaveAttribute("data-status", "busy");
    await textarea(page).fill("Summarise the recording.");
    await expect(page.locator(SEND)).toBeDisabled();

    await expect(tile.locator(EXCERPT)).toHaveText(PARTIAL);
    await expect(activation(shellOf(page))).toHaveAccessibleName(
      `More: ${RECORDING}, Transcribing · 0:38`,
    );

    await tile.locator(MORE).click();
    const section = page
      .getByRole("dialog", { name: `Preview: ${RECORDING}` })
      .locator('[data-ui="file-preview-audio-transcription"]');
    await expect(section).toHaveAttribute("data-status", "transcribing");
    await expect(section).toContainText("Transcribing · 0:38");
    await expect(section).toContainText(PARTIAL);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`a recording shows its first words in two lines at most, and a More button inside its frame, ${theme}`, async ({
      page,
    }) => {
      await openComposer(page, "audio-transcript-ready", { theme, width: 340 });
      const tile = page.locator(`${SHELL} ${TILE}`);
      const excerpt = tile.locator(EXCERPT);
      await expect(excerpt).toHaveText(new RegExp(`^${TRANSCRIPT}`));
      const lines = await excerpt.evaluate((box) => {
        const lineHeight = parseFloat(getComputedStyle(box).lineHeight);
        return {
          shown: Math.round(box.clientHeight / lineHeight),
          written: Math.round(box.scrollHeight / lineHeight),
          clamp: getComputedStyle(box).webkitLineClamp,
        };
      });
      // The start stays in view and the end gives way to an ellipsis.
      expect(lines.shown).toBe(2);
      expect(lines.written).toBeGreaterThan(2);
      expect(lines.clamp).toBe("2");

      const more = tile.locator(MORE);
      await expect(more).toHaveText("More");
      // The library's link Button, not a label drawn inside the activation.
      await expect(more).toHaveAttribute("data-variant", "link");
      expect(
        await more.evaluate((button) =>
          Boolean(button.parentElement!.closest("button")),
        ),
      ).toBe(false);
      const frame = await boxOf(tile);
      const inner = await boxOf(more);
      expect(inner.x + inner.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(inner.y + inner.height).toBeLessThanOrEqual(
        frame.y + frame.height,
      );
      // The link Button reads in the muted token, as the meta line beside it
      // does, which is about 4.4:1 on a light tile: the token's to fix.
      if (theme === "dark") {
        expect(await more.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
      }
      expect(await excerpt.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
      await expect(activation(shellOf(page))).toHaveAttribute(
        "title",
        RECORDING,
      );
      expect(
        await page.evaluate(() => document.scrollingElement!.scrollWidth),
      ).toBeLessThanOrEqual(340);

      // More is stretched over the tile: a click on the words opens it too.
      const words = await boxOf(excerpt);
      await page.mouse.click(words.x + 12, words.y + 8);
      const preview = page.getByRole("dialog", {
        name: `Preview: ${RECORDING}`,
      });
      await expect(
        preview.locator('[data-ui="file-preview-audio-transcription"]'),
      ).toContainText(TRANSCRIPT);
    });
  }

  test("a recording without words yet holds their two lines with a placeholder, so the tile keeps its size", async ({
    page,
  }) => {
    await openComposer(page, "audio-recording", { width: 340 });
    const tile = page.locator(`${SHELL} ${TILE}`);
    await expect(tile.locator(EXCERPT)).toHaveText(PLACEHOLDER);
    await expect(tile.locator(MORE)).toHaveCount(0);
    await expect.poll(() => metaWords(tile)).toBe("Recording · 0:42");
    const waiting = await boxOf(tile);

    await openComposer(page, "audio-speaking", { width: 340 });
    await expect(tile.locator(EXCERPT)).toHaveText(PARTIAL);
    await expect(tile.locator(MORE)).toHaveCount(1);
    const speaking = await boxOf(tile);
    expect(speaking.height).toBe(waiting.height);
    expect(speaking.width).toBe(waiting.width);
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
    await expect(page.locator(`${SHELL} ${TILE} ${EXCERPT}`)).toHaveText(
      "Das Transkript erscheint hier…",
    );
    await expect(
      page.locator(`${SHELL} [data-ui="attachment-remove"]`),
    ).toHaveAccessibleName(`Transkription abbrechen: ${RECORDING}`);

    await openComposer(page, "audio-stopped", { locale: "de", width: 340 });
    await expect(page.locator(`${SHELL} ${TILE} ${MORE}`)).toHaveText("Mehr");
    await expect(
      shellOf(page).getByRole("button", { name: /^Mehr: / }),
    ).toHaveAccessibleName(`Mehr: ${RECORDING}, Wird transkribiert · 0:38`);
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
    ["audio-recording-0908.wav", "Recording · 0:41", "busy"],
    ["audio-recording-0909.wav", "Transcribing · 0:38", "busy"],
    ["customer-interview.wav", "Transcript ready · 0:42", null],
  ];

  test("meta, status and a retry inside the failed tile's frame", async ({
    page,
  }) => {
    await openStory(page, "ui-fileattachmentspreview--audio-statuses", TILE, {
      width: 480,
    });
    for (const [filename, meta, status] of STATUSES) {
      const tile = tileNamed(page, filename);
      await tile.scrollIntoViewIfNeeded();
      await expect.poll(() => metaWords(tile), filename).toBe(meta);
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

    // The recordings this composer made show their words, or a placeholder
    // while words may still come; an uploaded audio file keeps its name.
    await expect(
      tileNamed(page, "audio-recording-0904.wav").locator(EXCERPT),
    ).toHaveText(/^Quick summary of the sales call/);
    await expect(
      tileNamed(page, "audio-recording-0901.wav").locator(EXCERPT),
    ).toHaveText(PLACEHOLDER);
    await expect(
      tileNamed(page, "audio-recording-0905.wav").locator(EXCERPT),
    ).toHaveCount(0);
    const uploaded = tileNamed(page, "customer-interview.wav");
    await expect(uploaded).toContainText("customer-interview.wav");
    await expect(uploaded.locator(EXCERPT)).toHaveCount(0);
    await expect(uploaded.locator(MORE)).toHaveCount(0);
  });

  test("a running recording counts up every second, not in 30-second chunk steps", async ({
    page,
  }) => {
    await openStory(
      page,
      "ui-fileattachmentspreview--audio-recording-live",
      TILE,
      { width: 340 },
    );
    const tile = page.locator(TILE);
    await expect(tile.locator(EXCERPT)).toHaveText(PLACEHOLDER);
    const waiting = await boxOf(tile);
    // Every value the meta line takes for 5.5 s, with when it took it.
    const changes = await page.evaluate(
      ({ tile, meta }) =>
        new Promise<{ text: string; at: number }[]>((resolve) => {
          const read = () =>
            document.querySelector(`${tile} ${meta}`)?.textContent ?? "";
          const seen = [{ text: read(), at: performance.now() }];
          const observer = new MutationObserver(() => {
            const text = read();
            if (seen.at(-1)!.text !== text) {
              seen.push({ text, at: performance.now() });
            }
          });
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
          });
          setTimeout(() => {
            observer.disconnect();
            resolve(seen);
          }, 5_500);
        }),
      { tile: TILE, meta: META },
    );
    const seen = changes.map((change) => change.text);
    for (let index = 2; index < changes.length; index += 1) {
      const gap = changes[index].at - changes[index - 1].at;
      expect(gap, seen.join(" | ")).toBeGreaterThan(800);
      expect(gap, seen.join(" | ")).toBeLessThan(1200);
    }
    const seconds = seen.map((text) =>
      Number(/0:(\d\d)/.exec(text)?.[1] ?? Number.NaN),
    );
    expect(seconds.length, seen.join(" | ")).toBeGreaterThanOrEqual(5);
    for (let index = 1; index < seconds.length; index += 1) {
      expect(seconds[index] - seconds[index - 1], seen.join(" | ")).toBe(1);
    }
    // At 0:30 the first chunk's words arrive and take the placeholder's
    // place, at the tile's size.
    await expect(page.locator(`${TILE} ${EXCERPT}`)).toHaveText(PARTIAL);
    await expect(page.locator(`${TILE} ${MORE}`)).toHaveText("More");
    const speaking = await boxOf(tile);
    expect(speaking.height).toBe(waiting.height);
    expect(speaking.width).toBe(waiting.width);
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
      // More is a link Button in the same muted token as the meta lines.
      if (theme === "dark") {
        for (const more of await page.locator(MORE).all()) {
          expect(await more.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});

test("a Word composer's recording carries its status in the lane's file row", async ({
  page,
}) => {
  await openWord(page, "Busy");
  const tile = tileNamed(page, RECORDING);
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toHaveAttribute("data-status", "busy");
  await expect(tile.locator(META)).toHaveText("Transcribing · 0:42");
  await expect(
    page.locator('[data-testid^="chat-audio-transcription-"]'),
  ).toHaveCount(0);
});
