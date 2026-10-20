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
const SELECT_LATER_PART =
  "Only the beginning is sent. To work on a later part, select it in Word.";
const DOCUMENT_LIFETIME =
  "Leaving it out lasts for this chat. New chats follow your setting “Include the open document in new chats”.";

interface Expected {
  state: string;
  tone?: "warning" | "error";
  meta: string | null;
  control: string | null;
  locked?: true;
}

interface Story {
  id: string;
  label?: string;
  selection?: Expected;
  document: Expected;
  files?: number;
}

const docIncluded = (meta: string | null, tone?: "warning"): Expected => ({
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
    id: "short-document-name",
    label: "Memo.docx",
    document: docIncluded("86 ¶"),
  },
  { id: "before-first-read", document: docIncluded(null) },
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
      control: "Dismiss document",
    },
  },
  {
    id: "read-error-again",
    document: {
      state: "error",
      tone: "error",
      meta: "Couldn't read the document",
      control: "Dismiss document",
    },
  },
  {
    id: "not-sent-here",
    document: {
      state: "error",
      tone: "error",
      meta: "Can't be sent in this chat",
      control: "Dismiss document",
    },
  },
  {
    id: "not-sent-here-empty",
    document: {
      state: "error",
      tone: "error",
      meta: "Can't be sent in this chat",
      control: "Dismiss document",
    },
  },
  { id: "new-document", document: docIncluded("New document") },
  {
    id: "changed-long-document",
    document: docIncluded("Changed since last send"),
  },
  { id: "beginning-only", document: docIncluded("Beginning only") },
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
  {
    id: "locked-selection-replaces-document",
    selection: selIncluded,
    document: { ...docReplaced("selection"), locked: true },
  },
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
const labelOf = (chip: Locator) =>
  chip.locator('[data-ui="composer-context-chip-label"]');
const notesIn = (detail: Locator) =>
  detail.locator('[data-ui="word-context-detail-note"]');
const lifetimeIn = (detail: Locator) =>
  detail.locator('[data-ui="word-context-detail-lifetime"]');

/** A length token as the element would paint it as a corner. */
const tokenRadius = (locator: Locator, token: string) =>
  locator.evaluate((element, name) => {
    const probe = document.createElement("span");
    probe.style.borderTopRightRadius = `var(${name})`;
    element.appendChild(probe);
    const value = getComputedStyle(probe).borderTopRightRadius;
    probe.remove();
    return value;
  }, token);

const openDetail = async (
  page: Page,
  story: string,
  name: "word.selection" | "word.document",
  title: string,
  options: { theme?: "light" | "dark" } = {},
) => {
  await openWord(page, story, options);
  await open(page, name).click();
  const detail = page.getByRole("dialog", { name: title });
  await expect(detail).toBeVisible();
  return detail;
};

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
  const meta = chip.locator('[data-ui="composer-context-chip-meta"]');
  if (expected.meta === null) {
    await expect(meta, story).toHaveCount(0);
  } else {
    await expect(meta, story).toHaveText(expected.meta);
  }
  const label = await chip
    .locator('[data-ui="composer-context-chip-label"]')
    .innerText();
  await expect(chip.locator(OPEN), story).toHaveAccessibleName(
    [label, expected.meta, STATE_WORD[expected.state]]
      .filter((part) => part !== null)
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
        kind(page, "word.document").locator(
          '[data-ui="composer-context-chip-label"]',
        ),
      ).toHaveText(story.label ?? docName);
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

test.describe("label width", () => {
  test("a short name keeps its own width, so the meta follows it closely", async ({
    page,
  }) => {
    await openWord(page, "short-document-name");
    const chip = kind(page, "word.document");
    const name = labelOf(chip);
    expect(await style(name, "min-width")).toBe("auto");
    const box = await boxOf(name);
    const textWidth = await name.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    });
    expect(box.width - textWidth).toBeLessThanOrEqual(1);
    expect(
      await name.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(false);
    const gap = parseFloat(
      await style(
        chip.locator('[data-ui="composer-context-chip-face"]'),
        "column-gap",
      ),
    );
    const separator = await boxOf(
      chip.locator('[data-ui="composer-context-chip-separator"]'),
    );
    expect(separator.x - (box.x + box.width)).toBeCloseTo(gap, 0);
  });

  test("a longer name keeps the 7em floor before its meta", async ({
    page,
  }) => {
    await openWord(page, "included");
    const name = labelOf(kind(page, "word.document"));
    const fontSize = parseFloat(await style(name, "font-size"));
    expect(parseFloat(await style(name, "min-width"))).toBeCloseTo(
      7 * fontSize,
      0,
    );
  });
});

test.describe("tones", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`a warning keeps the document's glyph and marks a cut passage, error, superseded and suggested looks, ${theme}`, async ({
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
      await openWord(page, "read-error", { theme });
      const errorGlyph = await glyph("word.document");
      const failed = kind(page, "word.document");
      expect(await style(failed, "border-top-color")).toBe(
        await tokenColor(failed, "--theme-error-border"),
      );
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
        if (name === "word.document") {
          expect(await glyph(name), story).toBe(ownGlyph[name]);
        } else {
          // Only the beginning goes, so the warning mark replaces the quote, as in the prototype.
          expect(await glyph(name), story).not.toBe(ownGlyph[name]);
          expect(await glyph(name), story).not.toBe(errorGlyph);
        }
        await expect(chip.locator(OPEN)).toHaveAccessibleName(/Included\.$/);
      }

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
    await expect(notesIn(sheet)).toHaveText([
      "Your selection is sent instead of the document.",
    ]);
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
    // The hint explains the first line, so it sits right under it.
    await expect(coverage.locator("p")).toHaveText([
      "Erato receives the first 120 of 300 paragraphs.",
      SELECT_LATER_PART,
      "Changed since last send: Erato reads it again with this message.",
    ]);
    await expect(coverage.locator("h3")).toHaveText("Coverage");
    for (const index of [1, 2]) {
      const line = coverage.locator("p").nth(index);
      expect(await style(line, "color")).toBe(
        await tokenColor(line, "--theme-fg-secondary"),
      );
      expect(await style(line, "font-size")).toBe("12px");
    }
    await expect(
      sheet.locator('[data-ui="word-context-detail-comments"]'),
    ).toContainText("A list of the 12 comments in the document");
    await expect(lifetimeIn(sheet)).toHaveText(DOCUMENT_LIFETIME);
    await expect(
      sheet.getByRole("button", { name: "Leave out" }),
    ).toBeVisible();
  });

  test("a first paragraph too long on its own sends its beginning, with the hint", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "beginning-only",
      "word.document",
      docName,
    );
    await expect(
      sheet.locator('[data-ui="word-context-detail-coverage"] p'),
    ).toHaveText([
      "Erato receives only the beginning of the first paragraph, because it alone exceeds the send limit.",
      SELECT_LATER_PART,
    ]);
  });

  test("before the first read the detail claims no coverage", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "before-first-read",
      "word.document",
      docName,
    );
    await expect(
      sheet.locator('[data-ui="word-context-detail-coverage"]'),
    ).toHaveCount(0);
    await expect(notesIn(sheet)).toHaveCount(0);
    await expect(lifetimeIn(sheet)).toHaveText(DOCUMENT_LIFETIME);
  });

  test("an off document claims no coverage; a superseded one says what goes if it is sent instead", async ({
    page,
  }) => {
    const off = await openDetail(
      page,
      "document-off",
      "word.document",
      docName,
    );
    await expect(
      off.locator('[data-ui="word-context-detail-coverage"]'),
    ).toHaveCount(0);

    await openWord(page, "interactive");
    const simulate = page.getByRole("group", { name: "Simulate" });
    await simulate.getByRole("button", { name: "Edit the document" }).click();
    await expect(
      kind(page, "word.document").locator(
        '[data-ui="composer-context-chip-meta"]',
      ),
    ).toHaveText("Changed since last send");
    await simulate.getByRole("button", { name: "Select a passage" }).click();
    await open(page, "word.document").click();
    const sheet = page.getByRole("dialog", { name: docName });
    const coverage = sheet.locator('[data-ui="word-context-detail-coverage"]');
    await expect(coverage.locator("h3")).toHaveText("If sent instead");
    await expect(coverage.locator("p")).toHaveText([
      "Erato receives the whole document, 86 paragraphs.",
    ]);
    await expect(sheet).not.toContainText("reads it again");
  });

  test("lasting facts are notes in the document's detail, by tone", async ({
    page,
  }) => {
    for (const [story, tone, text] of [
      ["track-changes", "warning", "Track Changes is on"],
      ["read-only-fallback", "warning", "This file is too large for Erato"],
      ["cannot-edit", "warning", "Word did not supply a complete editable"],
      ["body-only", "info", "Word for the web didn't hand over"],
    ] as const) {
      const sheet = await openDetail(page, story, "word.document", docName);
      const notes = notesIn(sheet);
      await expect(notes, story).toHaveCount(1);
      await expect(notes, story).toHaveAttribute("data-tone", tone);
      await expect(notes, story).toContainText(text);
    }
  });

  test("what goes instead is said in full sentences", async ({ page }) => {
    for (const [story, name, title, text] of [
      [
        "selection-replaces-document",
        "word.document",
        docName,
        "Your selection is sent instead of the document.",
      ],
      [
        "selection-replaces-document",
        "word.selection",
        "Selected passage",
        "Sent instead of the document.",
      ],
      [
        "document-replaced-by-comment",
        "word.document",
        docName,
        "A comment is sent instead of the document.",
      ],
      [
        "replaced-by-comment",
        "word.selection",
        "Selected passage",
        "A comment is sent instead of this passage.",
      ],
    ] as const) {
      const detail = await openDetail(page, story, name, title);
      await expect(notesIn(detail), `${story} ${name}`).toHaveText([text]);
    }
  });

  test("Erato's passage says where it came from", async ({ page }) => {
    const sheet = await openDetail(
      page,
      "erato-passage",
      "word.selection",
      "Passage Erato selected",
    );
    await expect(sheet).toContainText(
      "1 paragraph · Shown by Erato after Show in Word",
    );
  });

  test("a locked superseded document offers nothing to send instead", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "locked-selection-replaces-document",
      "word.document",
      docName,
    );
    await expect(notesIn(sheet).first()).toHaveText(
      "Your selection is sent instead of the document.",
    );
    await expect(
      sheet.getByRole("button", { name: "Send this instead" }),
    ).toHaveCount(0);
  });

  test("an unreadable document offers its error report; one this chat can't send has none", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "read-error",
      "word.document",
      docName,
    );
    await expect(
      sheet.getByRole("button", { name: "Copy error report" }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
    await expect(lifetimeIn(sheet)).toHaveText(DOCUMENT_LIFETIME);

    const other = await openDetail(
      page,
      "not-sent-here",
      "word.document",
      docName,
    );
    await expect(
      other.getByRole("button", { name: "Copy error report" }),
    ).toHaveCount(0);
    await expect(notesIn(other)).toHaveText([
      "This chat can only start new documents, so a document with text is not sent.",
    ]);
    await expect(notesIn(other)).toHaveAttribute("data-tone", "error");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the selected text sits in a tinted box from the theme's tokens, ${theme}`, async ({
      page,
    }) => {
      const sheet = await openDetail(
        page,
        "selection-replaces-document",
        "word.selection",
        "Selected passage",
        { theme },
      );
      const quoteBlock = sheet.locator('[data-ui="word-context-detail-quote"]');
      const fill = await style(quoteBlock, "background-color");
      expect(fill).toBe(await tokenColor(quoteBlock, "--theme-bg-secondary"));
      const behind = await quoteBlock.evaluate((element) => {
        for (
          let node = element.parentElement;
          node;
          node = node.parentElement
        ) {
          const color = getComputedStyle(node).backgroundColor;
          if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent")
            return color;
        }
        return "rgb(255, 255, 255)";
      });
      expect(fill).not.toBe(behind);
      expect(await style(quoteBlock, "border-left-width")).toBe("2px");
      expect(await style(quoteBlock, "border-left-color")).toBe(
        await tokenColor(quoteBlock, "--theme-border"),
      );
      expect(await style(quoteBlock, "border-top-right-radius")).toBe(
        await tokenRadius(quoteBlock, "--theme-radius-control"),
      );
      expect(await style(quoteBlock, "border-top-left-radius")).toBe("0px");
      expect(
        await quoteBlock.evaluate(
          (element, measure) =>
            (new Function(`return (${measure})`)() as (e: Element) => number)(
              element,
            ),
          contrastOf.toString(),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      await expect(lifetimeIn(sheet)).toHaveText(
        "Leaving it out lasts until the selection changes.",
      );
    });
  }

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
    expect((await quoteBlock.innerText()).endsWith("…")).toBe(true);
    await expect(sheet).toContainText(
      "Erato receives the first 9 of 14 paragraphs.",
    );
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
