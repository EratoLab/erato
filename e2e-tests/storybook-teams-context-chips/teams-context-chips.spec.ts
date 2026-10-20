import { readFileSync } from "node:fs";

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
} from "../storybook-composer-context-lane/lane-helpers";

// The Teams tab's transcript as one composer context item (ERMAIN-1025), as
// the `Chat/ComposerContextTeams` stories play the add-in's picker records
// and composer bridge around the library's own chip hook. What each story and
// flow has to draw comes from the add-in itself: its parity test runs the
// add-in's send preview and the chip hook on the stories' scenarios and
// writes teams-chips.expected.json.

const TEAMS = "chat-composercontextteams";
const SHELL = '[data-ui="chat-input-shell"]';
const FILES = '[data-ui="composer-staged-files"]';
const TILE = '[data-ui="attachment-tile"]';
const REMOVE = '[data-ui="composer-context-remove"]';
const DETAIL = '[data-ui="teams-transcript-detail"]';
const SECTION = '[data-ui="teams-transcript-section"]';
const FILE_REMOVE = '[data-ui="attachment-remove"]';

interface AddinChip {
  kind: "teams.transcript";
  origin: "user";
  state: "included" | "loading";
  label: string;
  meta: string | null;
  spokenLabel: string | null;
  control: string | null;
  removeAction: string | null;
  removed: string | null;
  detailTitle: string | null;
  actions: string[];
  claims: string[];
}
interface AddinComposer {
  composerLocked: boolean;
  chips: AddinChip[];
  sendFileIds: string[];
}
const ADDIN = JSON.parse(
  readFileSync(new URL("./teams-chips.expected.json", import.meta.url), "utf8"),
) as {
  stories: Record<string, AddinComposer>;
  flows: Record<string, AddinComposer & { story: string }>;
};
const story = (id: string) => {
  const found = ADDIN.stories[id];
  if (!found) throw new Error(`no story ${id} in teams-chips.expected.json`);
  return found;
};
const flow = (name: string) => {
  const found = ADDIN.flows[name];
  if (!found) throw new Error(`no flow ${name} in teams-chips.expected.json`);
  return found;
};
const STORIES = Object.entries(ADDIN.stories);

const STATE_WORD: Record<string, string> = {
  included: "Included.",
  loading: "Loading.",
};

const openTeams = (
  page: Page,
  id: string,
  options: { theme?: "light" | "dark"; width?: number; locale?: string } = {},
) => openStory(page, `${TEAMS}--${id}`, SHELL, options);

const transcripts = (page: Page) =>
  page.locator(`${CHIP}[data-kind="teams.transcript"]`);
const open = (chip: Locator) => chip.locator(OPEN);
const labelOf = (chip: Locator) =>
  chip.locator('[data-ui="composer-context-chip-label"]');
const metaOf = (chip: Locator) =>
  chip.locator('[data-ui="composer-context-chip-meta"]');
const textarea = (page: Page) => page.locator(`${SHELL} textarea`);
const tiles = (page: Page) => page.locator(`${AREA} ${FILES} ${TILE}`);
const announcer = (page: Page) => page.getByTestId("teams-composer-announcer");
const detailLive = (page: Page) =>
  page.locator('[data-ui="teams-transcript-detail-live"]');
const style = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );

/** Sends what the composer holds; the story's log names the file ids it carried. */
const sendAndRead = async (page: Page) => {
  await textarea(page).fill("What did we decide about the roadmap order?");
  await textarea(page).press("Enter");
  const entry = page.getByTestId("send-log").locator("li").first();
  await expect(entry).toBeVisible();
  return entry.innerText();
};
const sentLine = (ids: string[]) =>
  `Sent: ${ids.length > 0 ? ids.join(", ") : "no files"}`;

const expectChip = async (
  chip: Locator,
  expected: AddinChip,
  locked: boolean,
  label: string,
) => {
  await expect(chip, label).toHaveAttribute("data-kind", expected.kind);
  await expect(chip, label).toHaveAttribute("data-origin", expected.origin);
  await expect(chip, label).toHaveAttribute("data-state", expected.state);
  await expect(labelOf(chip), label).toHaveText(expected.label);
  if (expected.meta === null) {
    await expect(metaOf(chip), label).toHaveCount(0);
  } else {
    await expect(metaOf(chip), label).toHaveText(expected.meta);
  }
  await expect(open(chip), label).toHaveAccessibleName(
    [expected.label, expected.meta, STATE_WORD[expected.state]]
      .filter((part) => part !== null)
      .concat(locked ? ["Locked."] : [])
      .join(" "),
  );
  await expect(open(chip), label).toHaveAttribute("aria-haspopup", "dialog");
  const remove = chip.locator(REMOVE);
  await expect(remove, label).toHaveAccessibleName(expected.control ?? "");
  // Always drawn, never behind hover; a locked one dims but stays.
  await expect(remove, label).toBeVisible();
  if (locked) {
    await expect(chip, label).toHaveAttribute("data-locked", "true");
    await expect(remove, label).toBeDisabled();
  } else {
    await expect(remove, label).toBeEnabled();
    expect(Number(await style(remove, "opacity")), label).toBe(1);
  }
};

const expectLane = async (
  page: Page,
  expected: AddinComposer,
  label: string,
) => {
  const chips = transcripts(page);
  await expect(chips, label).toHaveCount(expected.chips.length);
  await expect(page.locator(CHIP), label).toHaveCount(expected.chips.length);
  for (const [index, chip] of expected.chips.entries()) {
    await expectChip(chips.nth(index), chip, expected.composerLocked, label);
  }
  // What the chips claim never shows in the file row; the rest always does.
  const claimed = new Set(expected.chips.flatMap((chip) => chip.claims));
  const userFiles = expected.sendFileIds.filter((id) => !claimed.has(id));
  await expect(tiles(page), label).toHaveCount(userFiles.length);
  for (const name of await tiles(page).allInnerTexts()) {
    expect(name, label).not.toMatch(/teams-|^Image/);
  }
};

/** Chips at their token height inside the lane, x inside its chip, no page overflow. */
const expectFits = async (page: Page, width: number, label: string) => {
  const lane = await boxOf(page.locator(LANE));
  const shell = await boxOf(page.locator(SHELL));
  const input = await boxOf(textarea(page));
  const boxes = [];
  for (const item of await transcripts(page).all()) {
    const box = await boxOf(item);
    boxes.push(box);
    expect(box.height, label).toBeCloseTo(32, 0);
    expect(box.x, label).toBeGreaterThanOrEqual(lane.x - 0.5);
    expect(box.x + box.width, label).toBeLessThanOrEqual(
      lane.x + lane.width + 0.5,
    );
    // Inside the composer box, above the message field.
    expect(box.y, label).toBeGreaterThanOrEqual(shell.y);
    expect(box.y + box.height, label).toBeLessThanOrEqual(input.y + 0.5);
    const remove = await boxOf(item.locator(REMOVE));
    expect(remove.x, label).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(remove.x + remove.width, label).toBeLessThanOrEqual(
      box.x + box.width + 0.5,
    );
    for (const part of [labelOf(item), metaOf(item)]) {
      expect(await style(part, "text-overflow"), label).toBe("ellipsis");
    }
  }
  // Two transcripts wrap rather than overlap.
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5;
      expect(apart, label).toBe(true);
    }
  }
  expect(
    await page.evaluate(() => document.scrollingElement!.scrollWidth),
    label,
  ).toBeLessThanOrEqual(width);
};

const ratiosOf = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements, measure) => {
    const contrast = new Function(`return (${measure})`)() as (
      element: Element,
    ) => number;
    return elements.map((element) => ({
      text: element.textContent ?? "",
      ratio: contrast(element),
    }));
  }, contrastOf.toString());
const CHIP_TEXT = `${CHIP} [data-ui="composer-context-chip-label"], ${CHIP} [data-ui="composer-context-chip-meta"]`;
// The detail's own text. The file rows are the shared AttachmentTile, the same
// tile as the composer's file row, and are not measured here.
const DETAIL_TEXT = `${DETAIL} h3, ${DETAIL} p, ${DETAIL} [data-ui="teams-transcript-picked"] span`;

const openDetail = async (page: Page, chip: Locator = transcripts(page)) => {
  await open(chip).click();
  const detail = page.getByRole("dialog", { name: "Teams transcript" });
  await expect(detail).toBeVisible();
  return detail;
};

/** Every committed frame's chips and file row, to catch a frame that disagrees. */
const recordFrames = (page: Page) =>
  page.evaluate(() => {
    const frames: { chips: number; files: string[] }[] = [];
    (window as unknown as { __frames: typeof frames }).__frames = frames;
    new MutationObserver(() => {
      frames.push({
        chips: document.querySelectorAll(
          '[data-ui="composer-context-chip"][data-kind="teams.transcript"]',
        ).length,
        files: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-ui="composer-staged-files"] [data-ui="attachment-tile"]',
          ),
        ].map((tile) => tile.innerText),
      });
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
const framesOf = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __frames: { chips: number; files: string[] }[] })
        .__frames,
  );

test.describe("every story", () => {
  // The walks below open every story in one test.
  test.describe.configure({ timeout: 120_000 });

  for (const [id, expected] of STORIES) {
    test(`${id}: the add-in's chips, names, files and fit at 340`, async ({
      page,
    }) => {
      await openTeams(page, id);
      await expect(
        page.getByRole("list", { name: "Message context" }),
      ).toHaveCount(1);
      await expectLane(page, expected, id);
      await expectFits(page, 340, id);
      for (const { text, ratio } of await ratiosOf(page, CHIP_TEXT)) {
        expect(ratio, `${id}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
      // The composer-wide Teams preview this replaces is gone.
      await expect(
        page.getByRole("region", { name: "Teams conversation preview" }),
      ).toHaveCount(0);
      if (expected.composerLocked) return;
      // The hard rule: a send carries exactly what the chips claim plus the
      // file row, and leaves no chip behind.
      expect(await sendAndRead(page), id).toBe(sentLine(expected.sendFileIds));
      await expect(transcripts(page), id).toHaveCount(0);
    });
  }

  for (const width of [480, 1280]) {
    test(`fits at ${width} px`, async ({ page }) => {
      for (const [id] of STORIES) {
        await openTeams(page, id, { width });
        await expectFits(page, width, id);
      }
    });
  }

  test("reads at 4.5:1 in dark", async ({ page }) => {
    for (const [id] of STORIES) {
      await openTeams(page, id, { theme: "dark" });
      for (const { text, ratio } of await ratiosOf(page, CHIP_TEXT)) {
        expect(ratio, `${id}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("every detail offers exactly the add-in's actions, then Remove", async ({
    page,
  }) => {
    for (const [id, expected] of STORIES) {
      await openTeams(page, id);
      for (const [index, chip] of expected.chips.entries()) {
        const detail = await openDetail(page, transcripts(page).nth(index));
        await expect(detail, id).toHaveAttribute("data-placement", "bottom");
        const buttons = detail.locator(
          '[data-ui="composer-context-detail-actions"] button',
        );
        await expect(buttons, id).toHaveText([
          ...chip.actions,
          chip.removeAction ?? "",
        ]);
        if (chip.actions.length > 0) {
          await expect(buttons.first(), id).toHaveAttribute(
            "data-variant",
            "primary",
          );
        }
        await page.keyboard.press("Escape");
        await expect(detail, id).toHaveCount(0);
        await expect(open(transcripts(page).nth(index)), id).toBeFocused();
      }
    }
  });
});

test.describe("removal", () => {
  test("x removes the transcript and every file it brought", async ({
    page,
  }) => {
    await openTeams(page, "three");
    const expected = story("three");
    await transcripts(page).locator(REMOVE).click();
    await expect(transcripts(page)).toHaveCount(0);
    await expect(live(page)).toHaveText(expected.chips[0].removed ?? "");
    await expect(textarea(page)).toBeFocused();
    expect(await sendAndRead(page)).toBe(sentLine([]));
  });

  test("Delete on the chip leaves the user's own files staged", async ({
    page,
  }) => {
    await openTeams(page, "with-files");
    const expected = story("with-files");
    await open(transcripts(page)).focus();
    await page.keyboard.press("Delete");
    await expect(transcripts(page)).toHaveCount(0);
    await expect(live(page)).toHaveText(expected.chips[0].removed ?? "");
    // Files are not lane stops: focus goes to the message box.
    await expect(textarea(page)).toBeFocused();
    await expect(tiles(page)).toHaveText([
      /holiday\.pdf/,
      /budget-notes\.docx/,
      /team-photo\.png/,
    ]);
    const claimed = new Set(expected.chips[0].claims);
    expect(await sendAndRead(page)).toBe(
      sentLine(expected.sendFileIds.filter((id) => !claimed.has(id))),
    );
  });

  test("Delete on the first of two transcripts moves to the second", async ({
    page,
  }) => {
    await openTeams(page, "two-transcripts");
    const [first, second] = story("two-transcripts").chips;
    await open(transcripts(page).first()).focus();
    await page.keyboard.press("Delete");
    await expect(transcripts(page)).toHaveCount(1);
    await expect(labelOf(transcripts(page))).toHaveText(second.label);
    await expect(open(transcripts(page))).toBeFocused();
    await expect(live(page)).toHaveText(first.removed ?? "");
    expect(await sendAndRead(page)).toBe(sentLine(second.claims));
  });

  test("Remove all removes only the user's files; the transcript stays", async ({
    page,
  }) => {
    await openTeams(page, "with-files");
    const after = flow("userFilesRemoved");
    expect(after.story).toBe("with-files");
    // Named for what it takes: only the files shown, not the chip's.
    await page.getByRole("button", { name: "Remove all: 3 files" }).click();
    await expectLane(page, after, "after Remove all");
    expect(await sendAndRead(page)).toBe(sentLine(after.sendFileIds));
  });

  test("a locked composer locks the chip, says why and disables the detail's removes", async ({
    page,
  }) => {
    await openTeams(page, "locked");
    const chip = transcripts(page);
    await expect(chip.locator(REMOVE)).toBeDisabled();
    await open(chip).focus();
    await page.keyboard.press("Delete");
    await expect(live(page)).toHaveText("Teams transcript is locked.");
    await expect(chip).toHaveCount(1);
    const detail = await openDetail(page);
    const removes = detail.locator(`${DETAIL} ${FILE_REMOVE}`);
    await expect(removes).toHaveCount(3);
    for (const remove of await removes.all()) {
      await expect(remove).toBeDisabled();
      // Disabled, still drawn.
      await expect(remove).toBeVisible();
    }
    await expect(
      detail.getByRole("button", { name: "Remove transcript" }),
    ).toBeDisabled();
  });
});

test.describe("detail", () => {
  test("the sheet lists each conversation, the picked messages and the shared files", async ({
    page,
  }) => {
    await openTeams(page, "three");
    const detail = await openDetail(page);
    await expect(detail).toHaveAttribute("data-placement", "bottom");
    await expect(
      detail.locator('[data-ui="composer-context-detail-meta"]'),
    ).toHaveText(/Included\s*3 conversations · 240 messages/);
    await expect(detail.locator(DETAIL)).toHaveAttribute(
      "data-view",
      "sections",
    );
    await expect(detail.locator(DETAIL)).toContainText(
      "One file covers all 3 conversations",
    );
    const sections = detail.locator(SECTION);
    await expect(sections.locator("h3")).toHaveText([
      "Product sync",
      "Design review · Platform Team",
      "Grace Hopper",
    ]);
    await expect(sections.nth(0)).toHaveAttribute("data-kind", "chat");
    await expect(sections.nth(1)).toHaveAttribute("data-kind", "channel");
    await expect(sections.nth(2)).toHaveAttribute("data-selection", "messages");
    await expect(sections.nth(0)).toContainText(
      "120 messages · Oct 1, 2026 – Oct 14, 2026",
    );
    await expect(sections.nth(0)).toContainText("All messages · Chat");
    await expect(sections.nth(1)).toContainText("All messages · Channel");
    await expect(sections.nth(2)).toContainText("Selected messages · Chat");
    // Every section has a named way into its conversation.
    const ways = detail.locator(
      '[data-ui="teams-transcript-open-conversation"]',
    );
    await expect(ways).toHaveCount(3);
    for (const [index, title] of [
      "Product sync",
      "Design review · Platform Team",
      "Grace Hopper",
    ].entries()) {
      await expect(ways.nth(index)).toHaveAccessibleName(
        `Open conversation: ${title}`,
      );
      // The visible text is part of the name (WCAG 2.5.3).
      await expect(ways.nth(index)).toHaveText("Open conversation");
    }
    // The viewer reads as "You", times as written (UTC).
    const picked = sections
      .nth(2)
      .locator('[data-ui="teams-transcript-picked"] li');
    await expect(picked).toHaveCount(4);
    await expect(picked.nth(0)).toContainText("Grace Hopper");
    await expect(picked.nth(0)).toContainText("Oct 10, 2026");
    await expect(picked.nth(0)).toContainText(
      "The vendor wants a decision on the support tier",
    );
    await expect(picked.nth(1)).toContainText("You");
    // Files under the conversation that shared them, named as Teams named them.
    await expect(
      detail.getByRole("list", { name: "Shared files in Product sync" }),
    ).toBeVisible();
    await expect(
      detail.locator(`${DETAIL} [data-ui="teams-transcript-files"] li`),
    ).toHaveCount(3);
    for (const [name, meta] of [
      ["roadmap-q1.pdf", "PDF · 1.1 MB"],
      ["dashboard-screenshot.png", "PNG · 240 KB"],
      ["wireframes-v2.pdf", "PDF · 3.4 MB"],
    ]) {
      await expect(
        detail.getByRole("button", {
          name: `Preview attachment ${name}, ${meta}`,
        }),
      ).toBeVisible();
      const remove = detail.getByRole("button", { name: `Remove ${name}` });
      // Visible without hover, inside its row.
      await expect(remove).toBeVisible();
      expect(Number(await style(remove, "opacity"))).toBe(1);
      const row = detail
        .locator(`${DETAIL} [data-ui="teams-transcript-files"] li`)
        .filter({ hasText: name });
      const rowBox = await boxOf(row);
      const removeBox = await boxOf(remove);
      expect(removeBox.x).toBeGreaterThanOrEqual(rowBox.x - 0.5);
      expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(
        rowBox.x + rowBox.width + 0.5,
      );
      expect(removeBox.y).toBeGreaterThanOrEqual(rowBox.y - 0.5);
      expect(removeBox.y + removeBox.height).toBeLessThanOrEqual(
        rowBox.y + rowBox.height + 0.5,
      );
    }
    // Minted upload names never show.
    await expect(detail).not.toContainText("teams-file-");
    await expect(detail).not.toContainText("teams-img-");
    for (const { text, ratio } of await ratiosOf(page, DETAIL_TEXT)) {
      expect(ratio, text).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollWidth),
    ).toBeLessThanOrEqual(340);
  });

  test("the sheet body scrolls with its actions in view", async ({ page }) => {
    await openTeams(page, "three");
    await page.setViewportSize({ width: 340, height: 560 });
    const detail = await openDetail(page);
    const edit = await boxOf(
      detail.getByRole("button", { name: "Edit selection" }),
    );
    expect(edit.y + edit.height).toBeLessThanOrEqual(560);
    const scrolls = await detail.evaluate(
      (element) =>
        [...element.querySelectorAll<HTMLElement>("*")].filter(
          (node) =>
            ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight + 1,
        ).length,
    );
    expect(scrolls).toBeGreaterThan(0);
  });

  test("one conversation has no 'covers all' line", async ({ page }) => {
    await openTeams(page, "one");
    const detail = await openDetail(page);
    await expect(detail.locator(SECTION)).toHaveCount(1);
    await expect(detail.locator(DETAIL)).not.toContainText("One file covers");
  });

  test("a partial conversation says so, with what could not be loaded", async ({
    page,
  }) => {
    await openTeams(page, "partial-and-skipped");
    const detail = await openDetail(page);
    await expect(detail.locator(SECTION)).toContainText(
      "Part of the conversation · 2 could not be loaded · Chat",
    );
    await expect(detail.locator(SECTION)).toContainText("100 messages · ");
    await detail
      .getByRole("button", { name: "Open conversation: Product sync" })
      .click();
    await expect(detail.locator(DETAIL)).toContainText(
      "Only part of this conversation is included.",
    );
    await expect(detail.locator(DETAIL)).toContainText(
      "2 messages could not be loaded.",
    );
  });

  test("a pasted image in a picked message is a file row named Image", async ({
    page,
  }) => {
    await openTeams(page, "picked-with-image");
    const detail = await openDetail(page);
    await expect(
      detail.locator('[data-ui="teams-transcript-picked"] li'),
    ).toHaveCount(4);
    await expect(
      detail.getByRole("button", { name: "Preview attachment Image, 180 KB" }),
    ).toBeVisible();
    const remove = detail.getByRole("button", { name: "Remove Image" });
    await expect(remove).toBeVisible();
    expect(Number(await style(remove, "opacity"))).toBe(1);
  });

  test("an unreadable transcript still says it is sent and lists its files", async ({
    page,
  }) => {
    await openTeams(page, "unreadable");
    const detail = await openDetail(page);
    await expect(detail.locator(DETAIL)).toHaveAttribute(
      "data-view",
      "unreadable",
    );
    await expect(detail.locator(DETAIL)).toContainText(
      "This transcript is still sent, but its conversations can't be shown here.",
    );
    await expect(
      detail.getByRole("button", {
        name: /^Remove (roadmap-q1\.pdf|dashboard-screenshot\.png)$/,
      }),
    ).toHaveCount(2);
  });

  test("Open conversation swaps the view in place; back returns focus", async ({
    page,
  }) => {
    await openTeams(page, "three");
    const detail = await openDetail(page);
    await detail
      .getByRole("button", { name: "Open conversation: Product sync" })
      .click();
    await expect(detail.locator(DETAIL)).toHaveAttribute(
      "data-view",
      "conversation",
    );
    const back = detail.getByRole("button", { name: "All conversations" });
    await expect(back).toBeFocused();
    await expect(detail.locator(DETAIL)).toContainText(
      "Ada Lovelace, Grace Hopper, Alan Turing, Sam Lee",
    );
    await expect(
      detail.getByRole("button", { name: "Open in Teams" }),
    ).toHaveCount(120);
    // Still the one dialog: the conversation lives inside the detail.
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await back.click();
    await expect(detail.locator(DETAIL)).toHaveAttribute(
      "data-view",
      "sections",
    );
    await expect(
      detail.getByRole("button", { name: "Open conversation: Product sync" }),
    ).toBeFocused();
  });

  for (const width of [340, 1280]) {
    test(`a file previews over the detail and Escape closes only the preview, ${width}`, async ({
      page,
    }) => {
      await openTeams(page, "three", { width });
      const detail = await openDetail(page);
      await expect(detail).toHaveAttribute(
        "data-placement",
        width === 340 ? "bottom" : "popover",
      );
      const row = detail.getByRole("button", {
        name: "Preview attachment roadmap-q1.pdf, PDF · 1.1 MB",
      });
      await row.click();
      const preview = page.getByRole("dialog", {
        name: "Preview: roadmap-q1.pdf",
      });
      await expect(preview).toBeVisible();
      // A click inside the stacked preview leaves the detail open.
      await preview.getByText("Preview: roadmap-q1.pdf").click();
      await expect(detail).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(detail).toBeVisible();
      await expect(row).toBeFocused();
    });
  }

  test("a file removed in the detail leaves the send, and the chip stays", async ({
    page,
  }) => {
    await openTeams(page, "three");
    const after = flow("roadmapRemoved");
    expect(after.story).toBe("three");
    const detail = await openDetail(page);
    await detail.getByRole("button", { name: "Remove roadmap-q1.pdf" }).click();
    await expect(
      detail.getByRole("button", { name: /roadmap-q1\.pdf/ }),
    ).toHaveCount(0);
    await expect(detailLive(page)).toHaveText("roadmap-q1.pdf removed.");
    await expect(
      detail.getByRole("button", { name: "Remove dashboard-screenshot.png" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expectLane(page, after, "after removing roadmap-q1.pdf");
    expect(await sendAndRead(page)).toBe(sentLine(after.sendFileIds));
  });

  test("the last file of a section hands focus to its conversation", async ({
    page,
  }) => {
    await openTeams(page, "three");
    const detail = await openDetail(page);
    await detail
      .getByRole("button", { name: "Remove wireframes-v2.pdf" })
      .click();
    await expect(
      detail.getByRole("button", {
        name: "Open conversation: Design review · Platform Team",
      }),
    ).toBeFocused();
  });

  test("anchors a popover to its chip in the full-width tab", async ({
    page,
  }) => {
    await openTeams(page, "three", { width: 1280 });
    const chip = transcripts(page);
    const detail = await openDetail(page);
    await expect(detail).toHaveAttribute("data-placement", "popover");
    const chipBox = await boxOf(chip);
    const box = await boxOf(detail);
    const gap =
      box.y < chipBox.y
        ? chipBox.y - (box.y + box.height)
        : box.y - (chipBox.y + chipBox.height);
    expect(gap).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(12);
    expect(Math.abs(box.x - chipBox.x)).toBeLessThanOrEqual(1);
    const width = await detail.evaluate((element) => {
      const probe = document.createElement("div");
      probe.style.width = "var(--theme-layout-composer-context-detail-width)";
      element.appendChild(probe);
      const resolved = probe.getBoundingClientRect().width;
      probe.remove();
      return resolved;
    });
    expect(width).toBeGreaterThan(0);
    expect(box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    // The conversation scrolls inside the popover, which stays in the viewport.
    await detail
      .getByRole("button", { name: "Open conversation: Product sync" })
      .click();
    const inside = await boxOf(detail);
    expect(inside.y).toBeGreaterThanOrEqual(0);
    expect(inside.y + inside.height).toBeLessThanOrEqual(800);
    const scrolls = await detail.evaluate(
      (element) =>
        [...element.querySelectorAll<HTMLElement>("*")].filter(
          (node) =>
            ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight + 1,
        ).length,
    );
    expect(scrolls).toBeGreaterThan(0);
  });

  test("detail text reads at 4.5:1 in dark", async ({ page }) => {
    await openTeams(page, "three", { theme: "dark" });
    await openDetail(page);
    for (const { text, ratio } of await ratiosOf(page, DETAIL_TEXT)) {
      expect(ratio, text).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("reading and editing", () => {
  test("a transcript still being read spins with its x live, then names itself in place", async ({
    page,
  }) => {
    await openTeams(page, "reading");
    const chip = transcripts(page);
    await expectChip(chip, story("reading").chips[0], false, "reading");
    await chip.evaluate((element) => element.setAttribute("data-probe", ""));
    await page.getByRole("button", { name: "Finish reading" }).click();
    await expectChip(chip, story("three").chips[0], false, "read");
    await expect(page.locator(`${CHIP}[data-probe]`)).toHaveCount(1);
  });

  test("Edit selection: Update with fewer conversations updates the chip in place", async ({
    page,
  }) => {
    await openTeams(page, "interactive");
    const after = flow("updateWithoutDesign");
    expect(after.story).toBe("interactive");
    const chip = transcripts(page);
    await chip.evaluate((element) => element.setAttribute("data-probe", ""));
    const detail = await openDetail(page);
    await detail.getByRole("button", { name: "Edit selection" }).click();
    await expect(detail).toHaveCount(0);
    const picker = page.getByRole("dialog", { name: "Teams chats" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("checkbox")).toHaveCount(4);
    for (const name of [
      "Product sync",
      "Design review · Platform Team",
      "Grace Hopper",
    ]) {
      await expect(picker.getByRole("checkbox", { name })).toBeChecked();
    }
    await expect(
      picker.getByRole("checkbox", { name: "Budget 2027" }),
    ).not.toBeChecked();
    await picker
      .getByRole("checkbox", { name: "Design review · Platform Team" })
      .uncheck();
    await recordFrames(page);
    await picker.getByRole("button", { name: "Update" }).click();
    await expect(picker).toHaveCount(0);
    await expectLane(page, after, "after Update");
    // The same chip, never gone for a frame, and focus back on it.
    await expect(page.locator(`${CHIP}[data-probe]`)).toHaveCount(1);
    await expect(open(chip)).toBeFocused();
    await expect(announcer(page)).toHaveText("Teams transcript updated.");
    const frames = await framesOf(page);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.chips).toBe(1);
      expect(frame.files).toEqual([]);
    }
    expect(await sendAndRead(page)).toBe(sentLine(after.sendFileIds));
  });

  test("Edit selection: Update with nothing ticked removes the transcript", async ({
    page,
  }) => {
    await openTeams(page, "interactive");
    const detail = await openDetail(page);
    await detail.getByRole("button", { name: "Edit selection" }).click();
    const picker = page.getByRole("dialog", { name: "Teams chats" });
    for (const box of await picker.getByRole("checkbox").all()) {
      await box.uncheck();
    }
    await expect(page.getByTestId("teams-story-picker-hint")).toHaveText(
      "Nothing selected: Update removes the transcript.",
    );
    await picker.getByRole("button", { name: "Update" }).click();
    await expect(picker).toHaveCount(0);
    await expect(transcripts(page)).toHaveCount(0);
    await expect(announcer(page)).toHaveText("Teams transcript removed.");
    await expect(textarea(page)).toBeFocused();
    expect(await sendAndRead(page)).toBe(sentLine([]));
  });

  test("Edit selection: Cancel changes nothing and returns to the chip", async ({
    page,
  }) => {
    await openTeams(page, "interactive");
    const detail = await openDetail(page);
    await detail.getByRole("button", { name: "Edit selection" }).click();
    const picker = page.getByRole("dialog", { name: "Teams chats" });
    await picker.getByRole("checkbox", { name: "Grace Hopper" }).uncheck();
    await picker.getByRole("button", { name: "Cancel" }).click();
    await expect(picker).toHaveCount(0);
    await expectLane(page, story("interactive"), "after Cancel");
    await expect(open(transcripts(page))).toBeFocused();
  });

  test("the chip follows the composer's files across a chat switch", async ({
    page,
  }) => {
    await openTeams(page, "interactive");
    await page.getByRole("button", { name: "Switch to another chat" }).click();
    await expect(transcripts(page)).toHaveCount(0);
    await expect(tiles(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Back to this chat" }).click();
    await expectLane(page, story("interactive"), "back in the chat");
    expect(await sendAndRead(page)).toBe(
      sentLine(story("interactive").sendFileIds),
    );
  });
});

test("speaks German in the chip, the detail and the conversation", async ({
  page,
}) => {
  await openTeams(page, "three", { locale: "de" });
  const chip = transcripts(page);
  await expect(metaOf(chip)).toHaveText("3 Unterhaltungen · 240 Nachrichten");
  await expect(chip.locator(REMOVE)).toHaveAccessibleName(
    "Teams-Transkript entfernen",
  );
  await open(chip).click();
  const detail = page.getByRole("dialog", { name: "Teams-Transkript" });
  await expect(
    detail.getByRole("button", { name: "Auswahl bearbeiten" }),
  ).toBeVisible();
  await expect(detail.locator(SECTION).first()).toContainText(
    "1. Okt. 2026 – 14. Okt. 2026",
  );
  await detail
    .getByRole("button", { name: "Unterhaltung öffnen: Product sync" })
    .click();
  await expect(
    detail.getByRole("button", { name: "Alle Unterhaltungen" }),
  ).toBeFocused();
  await expect(detail.locator(DETAIL)).toContainText("Okt.");
});

test("the web composer is unchanged: no lane, the file row as before", async ({
  page,
}) => {
  await openStory(page, "ui-chatinput--default", SHELL);
  await expect(page.locator(CHIP)).toHaveCount(0);
  await expect(page.locator(LANE)).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Teams conversation preview" }),
  ).toHaveCount(0);
});
