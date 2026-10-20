import { expect, test, type Page } from "@playwright/test";

import {
  CHIP,
  LANE,
  live,
  tokenColor,
} from "../storybook-composer-context-lane/lane-helpers";

import {
  CHIP_TEXT,
  control,
  DATA,
  expectFits,
  expectLane,
  isTagged,
  itemOf,
  kind,
  laneItems,
  metaOf,
  NOTICE,
  noticeOf,
  open,
  openWord,
  ratiosOf,
  SHELL,
  shownMeta,
  stateAfter,
  storyNames,
  style,
  tagElement,
  textarea,
  wordLive,
} from "./word-story";

// The Word add-in's comment chips (ERMAIN-1026): one chip for the comment at
// the cursor or the one the user chose, "Cursor is in N comments" as a
// choice, "Open comments (N)" while the document is off, and a passage's or
// the document's comments on the selection or document chip. Every expected
// state comes from the add-in's resolvers through the generated story file.

const COMMENT = "word.comment";
const OPEN_COMMENTS = "word.openComments";
const DOCUMENT = "word.document";
const SELECTION = "word.selection";
const DOCUMENT_NAME = "Supply agreement.docx";

const detailNamed = (page: Page, title: string) =>
  page.getByRole("dialog", { name: title });

test.describe("every story", () => {
  for (const story of storyNames()) {
    test(`${story}: chips, notice and send at 340`, async ({ page }) => {
      const state = stateAfter(story);
      await openWord(page, story);
      const items = laneItems(state);
      if (items.length > 0) {
        await expect(
          page.getByRole("list", { name: "Message context" }),
        ).toHaveCount(1);
      }
      await expectLane(page, state, story);
      // The notice is the composer's own slot, above the lane and inside the box.
      const notice = noticeOf(state);
      const alert = page.locator(`${NOTICE} [data-ui="alert"]`);
      if (notice) {
        await expect(alert, story).toHaveCount(1);
        await expect(alert, story).toContainText(notice.text);
      } else {
        await expect(alert, story).toHaveCount(0);
      }
      // The send preview the chips came from.
      await expect(page.getByTestId("word-story-send"), story).toHaveAttribute(
        "data-carrier",
        DATA.states[state].send.carrier,
      );
      await expectFits(page, 340, story);
      for (const { text, ratio } of await ratiosOf(page, CHIP_TEXT)) {
        expect(ratio, `${story}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  for (const width of [480, 1280]) {
    test(`fits ${width} px`, async ({ page }) => {
      // One test walks every story; the default 30 s is about what that takes.
      test.setTimeout(180_000);
      for (const story of storyNames()) {
        await openWord(page, story, { width });
        await expectFits(page, width, story);
      }
    });
  }

  test("reads at 4.5:1 in dark", async ({ page }) => {
    test.setTimeout(180_000);
    for (const story of storyNames()) {
      await openWord(page, story, { theme: "dark" });
      for (const { text, ratio } of await ratiosOf(page, CHIP_TEXT)) {
        expect(ratio, `${story}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

test.describe("looks", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`a choice reads as a warning, an off chip as dashed, a gone pick as an error, ${theme}`, async ({
      page,
    }) => {
      await openWord(page, "CursorInThreeComments", { theme });
      const attention = kind(page, COMMENT);
      await expect(attention).toHaveAttribute("data-state", "attention");
      expect(await style(attention, "border-top-color")).toBe(
        await tokenColor(attention, "--theme-warning-border"),
      );
      expect(await style(metaOf(attention), "color")).toBe(
        await tokenColor(attention, "--theme-warning-fg"),
      );
      expect(
        await style(
          attention.locator('[data-ui="composer-context-chip-icon"]'),
          "color",
        ),
      ).toBe(await tokenColor(attention, "--theme-warning-fg"));

      for (const [story, name] of [
        ["CursorCommentOff", COMMENT],
        ["CursorInThreeOff", COMMENT],
        ["OpenCommentsNew", OPEN_COMMENTS],
        ["OpenCommentsOffForMessage", OPEN_COMMENTS],
      ] as const) {
        await openWord(page, story, { theme });
        const chip = kind(page, name);
        await expect(chip, story).toHaveAttribute("data-state", "suggested");
        expect(await style(chip, "border-top-style"), story).toBe("dashed");
        expect(await style(chip, "background-color"), story).toBe(
          "rgba(0, 0, 0, 0)",
        );
      }

      // Unchanged but not sent: the muted superseded look.
      await openWord(page, "OpenCommentsReplaced", { theme });
      const replaced = kind(page, OPEN_COMMENTS);
      await expect(replaced).toHaveAttribute("data-state", "superseded");
      expect(await style(metaOf(replaced), "font-style")).toBe("italic");

      await openWord(page, "PickedGone", { theme });
      const gone = kind(page, COMMENT);
      await expect(gone).toHaveAttribute("data-tone", "error");
      expect(await style(gone, "border-top-color")).toBe(
        await tokenColor(gone, "--theme-error-border"),
      );
    });
  }

  test("the chips sit in the composer box, above the message field", async ({
    page,
  }) => {
    for (const width of [340, 480, 1280]) {
      await openWord(page, "Busy", { width });
      const shell = await page.locator(SHELL).boundingBox();
      const lane = await page.locator(LANE).boundingBox();
      const field = await textarea(page).boundingBox();
      expect(lane!.y, `${width}`).toBeGreaterThanOrEqual(shell!.y);
      expect(lane!.y + lane!.height, `${width}`).toBeLessThanOrEqual(field!.y);
      expect(lane!.x + lane!.width).toBeLessThanOrEqual(
        shell!.x + shell!.width,
      );
    }
  });
});

test.describe("the comment at the cursor", () => {
  test("(x) sends the next message without it, + brings it back, by mouse and by key", async ({
    page,
  }) => {
    await openWord(page, "CursorComment");
    const chip = kind(page, COMMENT);
    await control(chip).click();
    const off = stateAfter("CursorComment", ["x:word-comment"]);
    await expectLane(page, off, "after (x)");
    await expect(metaOf(chip)).toHaveText("Off for this message");
    await expect(live(page)).toHaveText(
      "Comments removed for this message. Include again with +",
    );
    await expect(open(chip)).toBeFocused();

    await page.keyboard.press("+");
    await expectLane(page, stateAfter("CursorComment"), "after +");
    await expect(open(chip)).toBeFocused();

    await page.keyboard.press("Delete");
    await expectLane(page, off, "after Delete");
    await expect(open(chip)).toBeFocused();
  });

  test("its detail holds why, where, the thread, what is sent and how long", async ({
    page,
  }) => {
    const item = itemOf(stateAfter("CursorComment"), COMMENT);
    const thread = DATA.threads[item.detail.body.thread!];
    await openWord(page, "CursorComment");
    await open(kind(page, COMMENT)).click();
    const detail = detailNamed(page, item.detail.title);
    await expect(detail).toBeVisible();
    const quote = detail.locator('[data-ui="word-comment-detail-quote"]');
    await expect(
      quote.locator('[data-ui="word-comment-detail-why"]'),
    ).toHaveText("At your cursor");
    await expect(quote).toContainText(thread.quote);
    await expect(
      quote.getByRole("button", { name: "Show in Word" }),
    ).toBeVisible();
    const card = detail.locator('[data-ui="word-comment-detail-thread"]');
    for (const fact of [
      thread.author,
      thread.activity!,
      thread.status,
      thread.replies!,
      thread.text,
    ]) {
      await expect(card).toContainText(fact);
    }
    const sent = detail.locator('[data-ui="word-comment-what-is-sent"]');
    await expect(sent.getByRole("heading")).toHaveText(
      item.detail.body.coverage!.heading,
    );
    await expect(sent.getByRole("listitem")).toHaveText(
      item.detail.body.coverage!.lines,
    );
    await expect(
      detail.locator('[data-ui="word-context-detail-lifetime"]'),
    ).toHaveText(item.detail.body.lifetime);
    // Host choices first, then the (x)'s own words.
    await expect(
      detail
        .locator('[data-ui="composer-context-detail-actions"]')
        .getByRole("button"),
    ).toHaveText([
      ...item.detail.actions.map((action) => action.label),
      item.removeActionLabel!,
    ]);
  });

  test("Show in Word picks the thread, so it stays the target; the detail stays open", async ({
    page,
  }) => {
    await openWord(page, "CursorComment");
    await open(kind(page, COMMENT)).click();
    const detail = detailNamed(page, "Comment by Maya Krüger");
    await detail.getByRole("button", { name: "Show in Word" }).click();
    const after = stateAfter("CursorComment", ["show:t1"]);
    await expect(detail).toBeVisible();
    await expect(
      detail.locator('[data-ui="composer-context-detail-state"]'),
    ).toHaveText(/Included/);
    await expect(
      detail.locator('[data-ui="word-comment-detail-why"]'),
    ).toHaveText("Chosen by you");
    await expect(wordLive(page)).toHaveText(
      DATA.transitions[stateAfter("CursorComment")]!["show:t1"]!.announce!,
    );
    await page.keyboard.press("Escape");
    await expectLane(page, after, "after Show in Word");
  });

  test("Choose comment… swaps the detail for the picker; Escape returns to the chip; a pick is chosen", async ({
    page,
  }) => {
    await openWord(page, "CursorComment");
    await open(kind(page, COMMENT)).click();
    await detailNamed(page, "Comment by Maya Krüger")
      .getByRole("button", { name: "Choose comment…" })
      .click();
    const picker = detailNamed(page, "Choose a comment");
    await expect(picker).toBeVisible();
    await expect(detailNamed(page, "Comment by Maya Krüger")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(open(kind(page, COMMENT))).toBeFocused();

    await open(kind(page, COMMENT)).click();
    await detailNamed(page, "Comment by Maya Krüger")
      .getByRole("button", { name: "Choose comment…" })
      .click();
    await detailNamed(page, "Choose a comment")
      .getByRole("button", { name: /Sara Nowak/ })
      .click();
    await expectLane(
      page,
      stateAfter("CursorComment", ["picker:t5"]),
      "after the pick",
    );
    await expect(wordLive(page)).toHaveText("Comment by Sara Nowak chosen.");
  });

  test("Send this instead on the document sends it, and the comment waits for +", async ({
    page,
  }) => {
    const gesture = "action:word-document:send-instead";
    const action = itemOf(stateAfter("CursorComment"), DOCUMENT).detail
      .actions[0];
    await openWord(page, "CursorComment");
    await open(kind(page, DOCUMENT)).click();
    await detailNamed(page, DOCUMENT_NAME)
      .getByRole("button", { name: "Send this instead" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectLane(page, stateAfter("CursorComment", [gesture]), "after");
    await expect(kind(page, DOCUMENT)).toHaveAttribute(
      "data-state",
      "included",
    );
    await expect(kind(page, COMMENT)).toHaveAttribute(
      "data-state",
      "suggested",
    );
    await expect(open(kind(page, DOCUMENT))).toBeFocused();
    await expect(live(page)).toHaveText(action.announcement!);
  });
});

test.describe("a cursor in several comments", () => {
  test("the choice opens a detail, a card picks, and (x) on the pick brings the choice back on the same chip", async ({
    page,
  }) => {
    await openWord(page, "CursorInThreeComments");
    const chip = page
      .locator(CHIP)
      .filter({ hasText: "Cursor is in 3 comments" });
    await tagElement(chip, "__comment");
    await open(chip).click();
    const detail = detailNamed(page, "Your cursor is in 3 comments");
    await expect(detail).toBeVisible();
    await expect(
      detail.locator('[data-ui="composer-context-detail-state"]'),
    ).toContainText("Needs a choice");
    const choices = detail
      .getByRole("list", { name: "Comments at your cursor" })
      .getByRole("button");
    await expect(choices).toHaveCount(3);
    await choices.nth(2).click();
    await expect(detail).toHaveCount(0);

    const comment = kind(page, COMMENT);
    expect(await isTagged(comment, "__comment")).toBe(true);
    await expectLane(
      page,
      stateAfter("CursorInThreeComments", ["pick:t6"]),
      "after the choice",
    );
    await expect(comment).toHaveAttribute("data-origin", "user");
    await expect(open(comment)).toBeFocused();
    await expect(live(page)).toHaveText("Comment by Paul Martin chosen.");

    await control(comment).click();
    expect(await isTagged(comment, "__comment")).toBe(true);
    await expectLane(page, stateAfter("CursorInThreeComments"), "after (x)");
    await expect(open(comment)).toBeFocused();
    await expect(live(page)).toHaveText("Chosen comment removed.");
  });

  test("with the document off, the chosen comment moves behind Open comments and keeps focus", async ({
    page,
  }) => {
    await openWord(page, "OpenCommentsCursorInThree");
    const comment = kind(page, COMMENT);
    await tagElement(comment, "__moved");
    await open(comment).click();
    await detailNamed(page, "Your cursor is in 3 comments")
      .getByRole("button", { name: /Paul Martin/ })
      .click();
    await expectLane(
      page,
      stateAfter("OpenCommentsCursorInThree", ["pick:t6"]),
      "after",
    );
    expect(
      await page
        .locator(CHIP)
        .evaluateAll((chips) =>
          chips.map((chip) => chip.getAttribute("data-kind")),
        ),
    ).toEqual([DOCUMENT, OPEN_COMMENTS, COMMENT]);
    expect(await isTagged(comment, "__moved")).toBe(true);
    await expect(open(comment)).toBeFocused();
  });

  test("Send waits on the choice; (x) answers that Send, and the next message asks again", async ({
    page,
  }) => {
    await openWord(page, "CursorInThreeComments");
    await textarea(page).fill("Answer the comment here.");
    await textarea(page).press("Enter");
    const waiting = stateAfter("CursorInThreeComments", ["send"]);
    await expectLane(page, waiting, "waiting");
    await expect(page.locator(`${NOTICE} [data-ui="alert"]`)).toContainText(
      noticeOf(waiting)!.text,
    );
    await control(kind(page, COMMENT)).click();
    const answered = stateAfter("CursorInThreeComments", [
      "send",
      "x:word-comment",
    ]);
    await expectLane(page, answered, "answered");
    await expect(page.locator(`${NOTICE} [data-ui="alert"]`)).toHaveCount(0);
    await expect(kind(page, COMMENT)).toHaveAttribute(
      "data-state",
      "attention",
    );
  });
});

test.describe("comments on their parent", () => {
  test("a passage's comment is its chip's meta and a checkbox in its detail", async ({
    page,
  }) => {
    const before = itemOf(stateAfter("PassageWithComment"), SELECTION);
    const after = itemOf(
      stateAfter("PassageWithComment", ["passage-comments:off"]),
      SELECTION,
    );
    await openWord(page, "PassageWithComment");
    const chip = kind(page, SELECTION);
    await expect(metaOf(chip)).toHaveText(before.meta!);
    await open(chip).click();
    const detail = detailNamed(page, "Selected passage");
    const section = detail.locator(
      '[data-ui="word-context-detail-passage-comments"]',
    );
    await expect(section.getByRole("heading")).toHaveText([
      "Comments in this passage",
      "What is sent",
    ]);
    const box = section.getByRole("checkbox", {
      name: "Send the comment in this passage",
    });
    await expect(box).toBeChecked();
    await expect(box).toHaveAccessibleDescription(
      "Off lasts for this message only",
    );
    await box.uncheck();
    await expect(metaOf(chip)).toHaveText(after.meta!);
    await expect(box).not.toBeChecked();
    // Off, the section says what + would bring back, never what is sent.
    await expect(section.getByRole("heading")).toHaveText([
      "Comments in this passage",
      "If included",
    ]);
    await box.check();
    await expect(metaOf(chip)).toHaveText(before.meta!);
  });

  test("the document carries the comment count while its map goes, and lists the map in its detail", async ({
    page,
  }) => {
    const item = itemOf(stateAfter("DocumentWithMap"), DOCUMENT);
    expect(item.meta).toBe("86 ¶ · 12 comments");
    await openWord(page, "DocumentWithMap");
    await expect(metaOf(kind(page, DOCUMENT))).toHaveText(item.meta!);
    await open(kind(page, DOCUMENT)).click();
    const comments = detailNamed(page, DOCUMENT_NAME).locator(
      '[data-ui="word-context-detail-comments"]',
    );
    await expect(comments.getByRole("heading")).toHaveText("Comments");
    await expect(comments.getByRole("listitem")).toHaveText(
      item.detail.body.comments as string[],
    );
  });
});

test.describe("open comments", () => {
  test("shown only while the document is off: + includes them, (x) keeps them off in this chat", async ({
    page,
  }) => {
    await openWord(page, "OpenCommentsNew");
    const chip = kind(page, OPEN_COMMENTS);
    await expect(metaOf(chip)).toHaveText("Not included");
    await open(chip).click();
    const item = itemOf(stateAfter("OpenCommentsNew"), OPEN_COMMENTS);
    const detail = detailNamed(page, item.detail.title);
    const body = detail.locator('[data-ui="word-open-comments-detail"]');
    await expect(body).toContainText(item.detail.body.intro!);
    await expect(
      body.locator('[data-ui="word-comment-what-is-sent"] h3'),
    ).toHaveText("If included");
    await expect(
      detail
        .locator('[data-ui="composer-context-detail-actions"]')
        .getByRole("button"),
    ).toHaveText(["Choose comment…", "Include open comments"]);
    await page.keyboard.press("Escape");

    await control(chip).click();
    await expectLane(
      page,
      stateAfter("OpenCommentsNew", ["+:word-open-comments"]),
      "included",
    );
    await expect(metaOf(chip)).toHaveText("With their replies");
    await control(chip).click();
    await expectLane(
      page,
      stateAfter("OpenCommentsNew", [
        "+:word-open-comments",
        "x:word-open-comments",
      ]),
      "off",
    );
    await expect(metaOf(chip)).toHaveText("Off in this chat");

    // Including the document lists them in its map instead.
    await control(kind(page, DOCUMENT)).click();
    await expect(kind(page, OPEN_COMMENTS)).toHaveCount(0);
  });

  test("locked with the chat: no (x), no Send this instead", async ({
    page,
  }) => {
    const item = itemOf(stateAfter("OpenCommentsLocked"), OPEN_COMMENTS);
    await openWord(page, "OpenCommentsLocked");
    const chip = kind(page, OPEN_COMMENTS);
    await expect(control(chip)).toBeDisabled();
    await expect(control(chip)).toHaveAttribute("title", item.lockReason!);
    await open(chip).click();
    await expect(
      detailNamed(page, item.detail.title).getByRole("button", {
        name: "Send this instead",
      }),
    ).toHaveCount(0);
  });
});

test.describe("a chosen comment that is gone", () => {
  test("reads as an error; (x) ends the pick and the document goes again", async ({
    page,
  }) => {
    const item = itemOf(stateAfter("PickedGone"), COMMENT);
    await openWord(page, "PickedGone");
    const chip = kind(page, COMMENT);
    await expect(metaOf(chip)).toHaveText(shownMeta(item)!);
    await open(chip).click();
    const detail = detailNamed(page, item.detail.title);
    await expect(
      detail.locator('[data-ui="word-context-detail-note"]'),
    ).toHaveText(item.detail.body.notes.map((note) => note.text));
    await page.keyboard.press("Escape");
    await control(chip).click();
    await expectLane(
      page,
      stateAfter("PickedGone", ["x:word-comment"]),
      "after",
    );
    await expect(kind(page, DOCUMENT)).toHaveAttribute(
      "data-state",
      "included",
    );
  });
});

test("speaks the lane's own words in German", async ({ page }) => {
  await openWord(page, "CursorInThreeComments", { locale: "de" });
  const chip = kind(page, COMMENT);
  await expect(open(chip)).toHaveAccessibleName(
    "Cursor is in 3 comments Choose one Ihre Entscheidung ist nötig.",
  );
  await open(chip).click();
  await expect(
    page.locator('[data-ui="composer-context-detail-state"]'),
  ).toContainText("Entscheidung nötig");
});

test("the web composer has no lane and no notice", async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 800 });
  await page.goto("/iframe.html?id=ui-chatinput--default&viewMode=story");
  await expect(page.locator(SHELL)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(LANE)).toHaveCount(0);
  await expect(page.locator(NOTICE)).toHaveCount(0);
});
