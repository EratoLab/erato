import { expect, test, type Locator, type Page } from "@playwright/test";

import { boxOf, LANE } from "../storybook-composer-context-lane/lane-helpers";

import {
  expectLane,
  kind,
  NOTICE,
  noticeOf,
  openWord,
  ratiosOf,
  SHELL,
  spokenText,
  stateAfter,
  storyNames,
  textarea,
  wordLive,
  type NoticeData,
} from "./word-story";

// The Word composer's one-off send prompts (ERMAIN-1026) in the composer's
// notice slot: a Send waiting on a choice, Word handing the document over
// slowly, comments being read, a failed selection read, and the notes the
// last Send left. What each says and offers comes from the add-in's
// wordComposerNotice through the generated story file.

const NOTICE_STORIES = storyNames().filter((story) =>
  Boolean(noticeOf(stateAfter(story))),
);
const ALERT = `${NOTICE} [data-ui="alert"]`;

const regionFor = (page: Page, notice: NoticeData) =>
  page.locator(
    notice.tone === "error"
      ? `${NOTICE} [data-ui="composer-notice-assertive"]`
      : `${NOTICE} [data-ui="composer-notice-polite"]`,
  );
const actionButtons = (alert: Locator) =>
  alert.locator(".text-sm").getByRole("button");
const dismissButton = (alert: Locator) =>
  alert.getByRole("button", { name: "Dismiss" });

test("every Word prompt is a notice story", () => {
  expect(NOTICE_STORIES).toEqual([
    "NoticeChooseComment",
    "NoticePickedGone",
    "NoticeCommentsReadFailed",
    "NoticeSlowCapture",
    "NoticeCommentProgress",
    "NoticeSelectionReadFailed",
    "NoticePreviousCapture",
    "NoticeNotIncluded",
    "NoticeBudget",
  ]);
});

test.describe("every notice", () => {
  for (const story of NOTICE_STORIES) {
    test(`${story}: region, mark, words and actions at 340`, async ({
      page,
    }) => {
      const notice = noticeOf(stateAfter(story))!;
      await openWord(page, story);
      const wrapper = page.locator(NOTICE);
      await expect(wrapper).toHaveAttribute("data-tone", notice.tone);
      // Errors interrupt; the rest wait their turn. Both regions stay mounted.
      const region = regionFor(page, notice);
      await expect(region).toHaveAttribute(
        "role",
        notice.tone === "error" ? "alert" : "status",
      );
      const alert = region.locator('[data-ui="alert"]');
      await expect(alert).toHaveCount(1);
      await expect(page.locator(ALERT)).toHaveCount(1);
      await expect(alert).toContainText(notice.text);

      const icon = alert.locator('[data-ui="composer-notice-icon"]');
      if (notice.busy) {
        await expect(icon.locator('[data-ui="spinner"]')).toHaveCount(1);
        await expect(icon).toHaveAttribute("aria-hidden", "true");
      } else if (notice.tone === "info") {
        await expect(icon).toHaveCount(0);
      } else {
        await expect(icon.locator("svg")).toHaveCount(1);
      }

      const progress = alert.locator('[data-ui="composer-notice-progress"]');
      if (notice.progressLabel) {
        await expect(progress).toHaveText(notice.progressLabel);
        await expect(progress).toHaveAttribute("aria-hidden", "true");
        // A count that ticks is drawn, never read out.
        expect(await spokenText(region)).not.toContain(notice.progressLabel);
      } else {
        await expect(progress).toHaveCount(0);
      }

      await expect(actionButtons(alert)).toHaveText(
        notice.actions.map((action) => action.label),
      );
      await expect(dismissButton(alert)).toHaveCount(
        notice.dismissible ? 1 : 0,
      );

      // Inside the composer box, above the chips and the message field.
      const shell = await boxOf(page.locator(SHELL));
      const box = await boxOf(wrapper);
      expect(box.y).toBeGreaterThanOrEqual(shell.y);
      expect(box.x + box.width).toBeLessThanOrEqual(
        shell.x + shell.width + 0.5,
      );
      const below =
        (await page.locator(LANE).count()) > 0
          ? await boxOf(page.locator(LANE))
          : await boxOf(textarea(page));
      expect(box.y + box.height).toBeLessThanOrEqual(below.y + 0.5);
      for (const button of await alert.getByRole("button").all()) {
        const inner = await boxOf(button);
        expect(inner.x).toBeGreaterThanOrEqual(box.x - 0.5);
        expect(inner.x + inner.width).toBeLessThanOrEqual(
          box.x + box.width + 0.5,
        );
      }
      expect(
        await page.evaluate(() => document.scrollingElement!.scrollWidth),
      ).toBeLessThanOrEqual(340);
      for (const { text, ratio } of await ratiosOf(
        page,
        `${ALERT} .text-sm > div > span`,
      )) {
        expect(ratio, `${story}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("reads at 4.5:1 in dark", async ({ page }) => {
    test.setTimeout(120_000);
    for (const story of NOTICE_STORIES) {
      await openWord(page, story, { theme: "dark" });
      for (const { text, ratio } of await ratiosOf(
        page,
        `${ALERT} .text-sm > div > span`,
      )) {
        expect(ratio, `${story}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

test.describe("answering a notice", () => {
  test("Send without comments answers the waiting Send; focus goes back to the message field", async ({
    page,
  }) => {
    await openWord(page, "NoticeChooseComment");
    await page
      .getByRole("button", { name: "Send without comments" })
      .first()
      .click();
    await expect(page.locator(ALERT)).toHaveCount(0);
    await expect(textarea(page)).toBeFocused();
    await expectLane(
      page,
      stateAfter("NoticeChooseComment", ["notice:send-without-comments"]),
      "after",
    );
  });

  test("Choose comment… opens the picker; a pick answers the waiting Send", async ({
    page,
  }) => {
    await openWord(page, "NoticeChooseComment");
    await page
      .locator(ALERT)
      .getByRole("button", { name: "Choose comment…" })
      .click();
    const picker = page.getByRole("dialog", { name: "Choose a comment" });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: /Tom Becker/ }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.locator(ALERT)).toHaveCount(0);
    await expectLane(
      page,
      stateAfter("NoticeChooseComment", ["picker:t4"]),
      "after the pick",
    );
    await expect(wordLive(page)).toHaveText("Comment by Tom Becker chosen.");
    await expect(textarea(page)).toBeFocused();
  });

  test("Send without document lets the slow Send go", async ({ page }) => {
    await openWord(page, "NoticeSlowCapture");
    await page.getByRole("button", { name: "Send without document" }).click();
    await expect(page.locator(ALERT)).toHaveCount(0);
    await expect(textarea(page)).toBeFocused();
  });

  test("a dismissed note leaves no gap, and focus goes back to the message field", async ({
    page,
  }) => {
    const offset = async () => {
      const shell = await boxOf(page.locator(SHELL));
      const lane = await boxOf(page.locator(LANE));
      return lane.y - shell.y;
    };
    await openWord(page, "DocumentWithMap");
    const without = await offset();
    await openWord(page, "NoticePreviousCapture");
    await dismissButton(page.locator(ALERT)).click();
    await expect(page.locator(ALERT)).toHaveCount(0);
    await expect(textarea(page)).toBeFocused();
    expect(
      await page
        .locator(NOTICE)
        .evaluate((element) => getComputedStyle(element).position),
    ).toBe("absolute");
    expect(await offset()).toBeCloseTo(without, 0);
  });

  test("dismissing a failed selection read keeps the selection's own error", async ({
    page,
  }) => {
    await openWord(page, "NoticeSelectionReadFailed");
    await dismissButton(page.locator(ALERT)).click();
    await expect(page.locator(ALERT)).toHaveCount(0);
    await expectLane(
      page,
      stateAfter("NoticeSelectionReadFailed", ["notice:dismiss"]),
      "after",
    );
    await expect(kind(page, "word.selection")).toHaveAttribute(
      "data-state",
      "error",
    );
  });

  test("a gone pick: Send without comments lets the waiting Send go", async ({
    page,
  }) => {
    await openWord(page, "NoticePickedGone");
    await page
      .locator(ALERT)
      .getByRole("button", { name: "Send without comments" })
      .click();
    await expect(page.locator(ALERT)).toHaveCount(0);
    await expect(textarea(page)).toBeFocused();
    await expectLane(
      page,
      stateAfter("NoticePickedGone", ["notice:send-without-comments"]),
      "after",
    );
  });
});

test("speaks the notice's own words in German", async ({ page }) => {
  await openWord(page, "NoticePreviousCapture", { locale: "de" });
  await expect(dismissButton(page.locator(ALERT))).toHaveCount(0);
  await expect(
    page.locator(ALERT).getByRole("button", { name: "Schließen" }),
  ).toHaveCount(1);
});
