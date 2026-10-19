import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  AREA,
  boxOf,
  CHIP,
  contrastOf,
  LANE,
  live,
  OPEN,
  openStory,
  tokenColor,
} from "../storybook-composer-context-lane/lane-helpers";

// The Word add-in's selection and document chips (ERMAIN-1023), as the
// `Chat/ComposerContextWord` stories play the add-in's resolver.

const WORD = "chat-composercontextword";
const docName = "Supply agreement.docx";
const quote = "“The Supplier shall deliver the Goods no later than the deliv…”";
const eratoQuote =
  "“The Buyer may audit the Supplier's records once per contract…”";
const LOCK_REASON =
  "Can't change this while the chat is archived or a task is running";

interface Expected {
  state: string;
  tone?: "warning" | "error";
  meta: string;
  control: string | null;
  locked?: true;
}

interface Story {
  id: string;
  selection?: Expected;
  document: Expected;
  files?: number;
}

const docIncluded = (meta: string, tone?: "warning"): Expected => ({
  state: "included",
  meta,
  control: "Don't include this document",
  ...(tone ? { tone } : {}),
});
const docReplaced = (by: "selection" | "comment"): Expected => ({
  state: "superseded",
  meta: `Replaced by ${by}`,
  control: "Don't include this document",
});
const selIncluded: Expected = {
  state: "included",
  meta: "Selected passage · 2 ¶",
  control: "Dismiss selection",
};

const STORIES: Story[] = [
  { id: "included", document: docIncluded("86 ¶") },
  {
    id: "document-off",
    document: {
      state: "suggested",
      meta: "Off in this chat",
      control: "Include this document",
    },
  },
  {
    id: "reading",
    document: {
      state: "loading",
      meta: "Reading document…",
      control: "Don't include this document",
    },
  },
  {
    id: "read-error",
    document: {
      state: "error",
      tone: "error",
      meta: "Couldn't read the document",
      control: "Dismiss",
    },
  },
  {
    id: "read-error-again",
    document: {
      state: "error",
      tone: "error",
      meta: "Couldn't read the document",
      control: "Dismiss",
    },
  },
  {
    id: "not-sent-here",
    document: {
      state: "error",
      tone: "error",
      meta: "Can't be sent in this chat",
      control: "Dismiss",
    },
  },
  {
    id: "not-sent-here-empty",
    document: {
      state: "error",
      tone: "error",
      meta: "Can't be sent in this chat",
      control: "Dismiss",
    },
  },
  { id: "new-document", document: docIncluded("New document") },
  {
    id: "changed-long-document",
    document: docIncluded("Changed since last send"),
  },
  {
    id: "track-changes",
    document: docIncluded("Track Changes on · 86 ¶", "warning"),
  },
  { id: "read-in-parts", document: docIncluded("Read in parts · 1,590 ¶") },
  { id: "body-only", document: docIncluded("Body only · 86 ¶") },
  {
    id: "read-only-fallback",
    document: docIncluded("Read only · First 453 of 1,590 ¶", "warning"),
  },
  { id: "cannot-edit", document: docIncluded("Can't edit · 86 ¶", "warning") },
  { id: "locked", document: { ...docIncluded("86 ¶"), locked: true } },
  { id: "document-replaced-by-comment", document: docReplaced("comment") },
  {
    id: "selection-replaces-document",
    selection: selIncluded,
    document: docReplaced("selection"),
  },
  {
    id: "selection-dismissed",
    selection: {
      state: "suggested",
      meta: "Off until the selection changes",
      control: "Include selection",
    },
    document: docIncluded("86 ¶"),
  },
  {
    id: "erato-passage",
    selection: {
      state: "suggested",
      meta: "Shown by Erato · 1 ¶",
      control: "Use this selection",
    },
    document: docIncluded("86 ¶"),
  },
  {
    id: "too-long-selection",
    selection: {
      state: "included",
      tone: "warning",
      meta: "Too long · beginning only",
      control: "Dismiss selection",
    },
    document: docReplaced("selection"),
  },
  {
    id: "selection-read-failed",
    selection: {
      state: "error",
      tone: "error",
      meta: "Couldn't read · send again",
      control: "Dismiss selection",
    },
    document: docReplaced("selection"),
  },
  {
    id: "replaced-by-comment",
    selection: {
      state: "superseded",
      meta: "Replaced by comment",
      control: "Dismiss selection",
    },
    document: docReplaced("comment"),
  },
  {
    id: "busy",
    selection: selIncluded,
    document: docReplaced("selection"),
    files: 5,
  },
  { id: "interactive", document: docIncluded("86 ¶") },
];

const STATE_WORD: Record<string, string> = {
  included: "Included.",
  suggested: "Not included.",
  superseded: "Not sent.",
  loading: "Loading.",
  error: "Error.",
};

const openWord = (
  page: Page,
  story: string,
  options: { theme?: "light" | "dark"; width?: number; locale?: string } = {},
) => openStory(page, `${WORD}--${story}`, LANE, options);

const kind = (page: Page, name: "word.selection" | "word.document") =>
  page.locator(`${CHIP}[data-kind="${name}"]`);
const open = (page: Page, name: "word.selection" | "word.document") =>
  kind(page, name).locator(OPEN);
const control = (chip: Locator) =>
  chip.locator(
    '[data-ui="composer-context-remove"], [data-ui="composer-context-restore"]',
  );
const style = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );

/** Chips at their token height inside the lane, controls inside their chip, no page overflow. */
const expectFits = async (page: Page, width: number, story: string) => {
  const lane = await boxOf(page.locator(LANE));
  for (const item of await page.locator(CHIP).all()) {
    const box = await boxOf(item);
    expect(box.height, story).toBeCloseTo(32, 0);
    expect(box.x, story).toBeGreaterThanOrEqual(lane.x - 0.5);
    expect(box.x + box.width, story).toBeLessThanOrEqual(
      lane.x + lane.width + 0.5,
    );
    const button = control(item);
    if ((await button.count()) > 0) {
      const inner = await boxOf(button);
      expect(inner.x, story).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(inner.x + inner.width, story).toBeLessThanOrEqual(
        box.x + box.width + 0.5,
      );
    }
    for (const part of ["label", "meta"]) {
      const text = item.locator(`[data-ui="composer-context-chip-${part}"]`);
      if ((await text.count()) === 0) continue;
      expect(await style(text, "text-overflow"), story).toBe("ellipsis");
    }
  }
  expect(
    await page.evaluate(() => document.scrollingElement!.scrollWidth),
    story,
  ).toBeLessThanOrEqual(width);
};

const ratiosOf = (page: Page) =>
  page
    .locator(
      `${CHIP} [data-ui="composer-context-chip-label"], ${CHIP} [data-ui="composer-context-chip-meta"]`,
    )
    .evaluateAll((elements, measure) => {
      const contrast = new Function(`return (${measure})`)() as (
        element: Element,
      ) => number;
      return elements.map((element) => ({
        text: element.textContent ?? "",
        ratio: contrast(element),
      }));
    }, contrastOf.toString());

const expectChip = async (
  page: Page,
  name: "word.selection" | "word.document",
  expected: Expected,
  story: string,
) => {
  const chip = kind(page, name);
  await expect(chip, story).toHaveAttribute("data-state", expected.state);
  if (expected.tone) {
    await expect(chip, story).toHaveAttribute("data-tone", expected.tone);
  }
  await expect(
    chip.locator('[data-ui="composer-context-chip-meta"]'),
    story,
  ).toHaveText(expected.meta);
  const label = await chip
    .locator('[data-ui="composer-context-chip-label"]')
    .innerText();
  await expect(chip.locator(OPEN), story).toHaveAccessibleName(
    [label, expected.meta, STATE_WORD[expected.state]]
      .concat(expected.locked ? ["Locked."] : [])
      .join(" "),
  );
  const button = control(chip);
  if (expected.control === null) {
    await expect(button).toHaveCount(0);
  } else {
    await expect(button, story).toHaveAccessibleName(expected.control);
  }
  if (expected.locked) {
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", LOCK_REASON);
  }
};

test.describe("every story", () => {
  for (const story of STORIES) {
    test(`${story.id}: order, names and fit at 340`, async ({ page }) => {
      await openWord(page, story.id);
      const lane = page.getByRole("list", { name: "Message context" });
      await expect(lane).toHaveCount(1);
      const kinds = await page
        .locator(CHIP)
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute("data-kind")),
        );
      expect(kinds).toEqual(
        story.selection
          ? ["word.selection", "word.document"]
          : ["word.document"],
      );
      for (const item of await page.locator(CHIP).all()) {
        expect(
          await item.evaluate(
            (element) => element.getAttribute("role") === "listitem",
          ),
        ).toBe(true);
      }
      if (story.selection) {
        await expectChip(page, "word.selection", story.selection, story.id);
        const label = await kind(page, "word.selection")
          .locator('[data-ui="composer-context-chip-label"]')
          .innerText();
        expect(Array.from(label.slice(1, -1)).length).toBeLessThanOrEqual(61);
      }
      await expectChip(page, "word.document", story.document, story.id);
      await expect(
        page.locator(`${AREA} [data-ui="attachment-tile"]`),
      ).toHaveCount(story.files ?? 0);
      await expectFits(page, 340, story.id);
      for (const { text, ratio } of await ratiosOf(page)) {
        expect(ratio, `${story.id}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("fits the 480 px breakpoint", async ({ page }) => {
    for (const { id } of STORIES) {
      await openWord(page, id, { width: 480 });
      await expectFits(page, 480, id);
    }
  });

  test("reads at 4.5:1 in dark", async ({ page }) => {
    for (const { id } of STORIES) {
      await openWord(page, id, { theme: "dark" });
      for (const { text, ratio } of await ratiosOf(page)) {
        expect(ratio, `${id}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

test.describe("tones", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`warning keeps the item's glyph, error, superseded and suggested looks, ${theme}`, async ({
      page,
    }) => {
      const glyph = (name: "word.selection" | "word.document") =>
        kind(page, name)
          .locator('[data-ui="composer-context-chip-icon"]')
          .innerHTML();
      await openWord(page, "selection-replaces-document", { theme });
      const ownGlyph = {
        "word.selection": await glyph("word.selection"),
        "word.document": await glyph("word.document"),
      };
      for (const [story, name] of [
        ["track-changes", "word.document"],
        ["read-only-fallback", "word.document"],
        ["cannot-edit", "word.document"],
        ["too-long-selection", "word.selection"],
      ] as const) {
        await openWord(page, story, { theme });
        const chip = kind(page, name);
        await expect(chip).toHaveAttribute("data-tone", "warning");
        expect(await style(chip, "border-top-color"), story).toBe(
          await tokenColor(chip, "--theme-warning-border"),
        );
        expect(await glyph(name), story).toBe(ownGlyph[name]);
        await expect(chip.locator(OPEN)).toHaveAccessibleName(/Included\.$/);
      }

      await openWord(page, "read-error", { theme });
      const failed = kind(page, "word.document");
      expect(await style(failed, "border-top-color")).toBe(
        await tokenColor(failed, "--theme-error-border"),
      );

      await openWord(page, "selection-replaces-document", { theme });
      const superseded = kind(page, "word.document");
      expect(await style(superseded, "background-color")).toBe(
        "rgba(0, 0, 0, 0)",
      );
      expect(
        await style(
          superseded.locator('[data-ui="composer-context-chip-meta"]'),
          "font-style",
        ),
      ).toBe("italic");

      await openWord(page, "document-off", { theme });
      expect(await style(kind(page, "word.document"), "border-top-style")).toBe(
        "dashed",
      );
    });
  }

  test("a document being read spins without a second status", async ({
    page,
  }) => {
    await openWord(page, "reading");
    const chip = kind(page, "word.document");
    await expect(chip.locator('[data-ui="spinner"]')).toHaveCount(1);
    await expect(chip.locator('[role="status"]')).toHaveCount(0);
    await expect(control(chip)).toBeEnabled();
  });
});

test.describe("flows", () => {
  test("dismissing the selection gives the document back, + takes it again", async ({
    page,
  }) => {
    await openWord(page, "selection-replaces-document");
    await open(page, "word.selection").focus();
    await page.keyboard.press("Delete");
    await expect(kind(page, "word.selection")).toHaveAttribute(
      "data-state",
      "suggested",
    );
    await expect(
      kind(page, "word.selection").locator(
        '[data-ui="composer-context-chip-meta"]',
      ),
    ).toHaveText("Off until the selection changes");
    await expect(kind(page, "word.document")).toHaveAttribute(
      "data-state",
      "included",
    );
    await expect(live(page)).toHaveText(
      "Selection removed. Include again with +",
    );
    await expect(open(page, "word.selection")).toBeFocused();

    await page.keyboard.press("+");
    await expect(kind(page, "word.selection")).toHaveAttribute(
      "data-state",
      "included",
    );
    await expect(kind(page, "word.document")).toHaveAttribute(
      "data-state",
      "superseded",
    );
    await expect(live(page)).toHaveText(
      "Selection included. It is sent instead of the document.",
    );
  });

  test("+ on Erato's passage sends it instead of the document", async ({
    page,
  }) => {
    await openWord(page, "erato-passage");
    await expect(
      kind(page, "word.selection").locator(
        '[data-ui="composer-context-chip-label"]',
      ),
    ).toHaveText(eratoQuote);
    await open(page, "word.selection").focus();
    await page.keyboard.press("+");
    await expect(kind(page, "word.selection")).toHaveAttribute(
      "data-state",
      "included",
    );
    await expect(kind(page, "word.document")).toHaveAttribute(
      "data-state",
      "superseded",
    );
    await expect(live(page)).toHaveText(
      "Selection included. It is sent instead of the document.",
    );
  });

  test("Send this instead closes the sheet, keeps focus on the document and says so", async ({
    page,
  }) => {
    await openWord(page, "selection-replaces-document");
    await open(page, "word.document").focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: docName });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(
      "Your selection is sent instead of the document",
    );
    await sheet.getByRole("button", { name: "Send this instead" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(kind(page, "word.document")).toHaveAttribute(
      "data-state",
      "included",
    );
    await expect(kind(page, "word.selection")).toHaveAttribute(
      "data-state",
      "suggested",
    );
    await expect(open(page, "word.document")).toBeFocused();
    await expect(live(page)).toHaveText(
      "Document included. Your selection is off until it changes.",
    );
  });

  test("an unreadable document turns off with Delete and reads again with +", async ({
    page,
  }) => {
    await openWord(page, "read-error");
    const chip = kind(page, "word.document");
    await open(page, "word.document").focus();
    await page.keyboard.press("Delete");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await expect(
      chip.locator('[data-ui="composer-context-chip-meta"]'),
    ).toHaveText("Off in this chat");
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "loading");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(live(page)).toHaveText("Document included.");
  });

  test("a + that fails again says where it landed", async ({ page }) => {
    await openWord(page, "read-error-again");
    const chip = kind(page, "word.document");
    await open(page, "word.document").focus();
    await page.keyboard.press("Delete");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "loading");
    await expect(chip).toHaveAttribute("data-state", "error");
    await expect(live(page)).toHaveText("Document: Couldn't read the document");
  });

  test("Try again loads, then says the document was read", async ({ page }) => {
    await openWord(page, "read-error");
    await open(page, "word.document").click();
    const sheet = page.getByRole("dialog", { name: docName });
    await expect(sheet).toContainText(
      "Word did not hand over this document, so it is not sent. Try again, or leave it out.",
    );
    await sheet.getByRole("button", { name: "Try again" }).click();
    const chip = kind(page, "word.document");
    await expect(chip).toHaveAttribute("data-state", "loading");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(live(page)).toHaveText("Document read.");
  });

  test("Try again that fails again says so", async ({ page }) => {
    await openWord(page, "read-error-again");
    await open(page, "word.document").click();
    await page
      .getByRole("dialog", { name: docName })
      .getByRole("button", { name: "Try again" })
      .click();
    await expect(kind(page, "word.document")).toHaveAttribute(
      "data-state",
      "error",
    );
    await expect(live(page)).toHaveText("Document: Couldn't read the document");
  });

  test("a locked document says why, and still opens its detail", async ({
    page,
  }) => {
    await openWord(page, "locked");
    await open(page, "word.document").focus();
    await page.keyboard.press("Delete");
    await expect(live(page)).toHaveText(LOCK_REASON);
    await expect(kind(page, "word.document")).toHaveAttribute(
      "data-state",
      "included",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: docName })).toBeVisible();
  });
});

test.describe("detail", () => {
  test("the document's sheet holds its coverage, comments and lifetime", async ({
    page,
  }) => {
    await openWord(page, "changed-long-document");
    await open(page, "word.document").click();
    const sheet = page.getByRole("dialog", { name: docName });
    await expect(sheet).toHaveAttribute("data-ui", "modal-shell");
    const coverage = sheet.locator('[data-ui="word-context-detail-coverage"]');
    await expect(coverage).toContainText(
      "Erato receives the first 120 of 300 paragraphs.",
    );
    await expect(coverage).toContainText(
      "Changed since last send: Erato reads it again with this message.",
    );
    await expect(coverage).toContainText(
      "Only the beginning is sent. To work on a later part, select it in Word.",
    );
    await expect(
      sheet.locator('[data-ui="word-context-detail-comments"]'),
    ).toContainText("A list of the 12 comments in the document");
    await expect(sheet).toContainText("Leaving it out lasts for this chat.");
    await expect(
      sheet.getByRole("button", { name: "Leave out" }),
    ).toBeVisible();
  });

  test("a long passage scrolls inside the sheet, focusable, with the actions in view", async ({
    page,
  }) => {
    await openWord(page, "too-long-selection");
    await page.setViewportSize({ width: 340, height: 560 });
    await open(page, "word.selection").click();
    const sheet = page.getByRole("dialog", { name: "Selected passage" });
    const quoteBlock = sheet.locator('[data-ui="word-context-detail-quote"]');
    await expect(quoteBlock).toHaveAccessibleName("Selected text");
    await expect(quoteBlock).toHaveAttribute("tabindex", "0");
    expect(
      await quoteBlock.evaluate(
        (element) => element.scrollHeight > element.clientHeight + 1,
      ),
    ).toBe(true);
    await expect(
      sheet.locator(
        '[data-ui="word-context-detail-note"][data-tone="warning"]',
      ),
    ).toContainText("Too long to send in full. Only the beginning is sent.");
    const leaveOut = await boxOf(
      sheet.getByRole("button", { name: "Leave out" }),
    );
    expect(leaveOut.y + leaveOut.height).toBeLessThanOrEqual(560);
    await quoteBlock.focus();
    await expect(quoteBlock).toBeFocused();
  });

  test("anchors a popover to its chip on the wide app", async ({ page }) => {
    await openWord(page, "selection-replaces-document", { width: 1280 });
    await open(page, "word.document").click();
    const dialog = page.getByRole("dialog", { name: docName });
    await expect(dialog).toHaveAttribute("data-placement", "popover");
    const chipBox = await boxOf(kind(page, "word.document"));
    const box = await boxOf(dialog);
    // Above the chip when there is room, below it otherwise.
    const gap =
      box.y < chipBox.y
        ? chipBox.y - (box.y + box.height)
        : box.y - (chipBox.y + chipBox.height);
    expect(gap).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(12);
    expect(Math.abs(box.x - chipBox.x)).toBeLessThanOrEqual(1);
    await expect(
      dialog.getByRole("button", { name: "Send this instead" }),
    ).toBeVisible();
  });
});

test("speaks the lane's own words in German", async ({ page }) => {
  await openWord(page, "busy", { locale: "de" });
  await expect(
    page.getByRole("list", { name: "Kontext der Nachricht" }),
  ).toBeVisible();
  await expect(open(page, "word.document")).toHaveAccessibleName(
    `${docName} Replaced by selection Wird nicht gesendet.`,
  );
  await expect(
    kind(page, "word.selection").locator(
      '[data-ui="composer-context-chip-label"]',
    ),
  ).toHaveText(quote);
});
