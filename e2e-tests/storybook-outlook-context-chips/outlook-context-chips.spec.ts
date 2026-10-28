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
  tokenColor,
} from "../storybook-composer-context-lane/lane-helpers";

// The Outlook add-in's chips (ERMAIN-1024), as the `Chat/ComposerContextOutlook`
// stories play the add-in's resolvers: compose selection, draft or
// appointment, the open thread, the item's attachments, dropped emails and the
// scheduling mode in the controls row. What each story and flow has to draw
// comes from the add-in itself: its parity test runs the add-in's resolvers on
// the stories' scenarios and writes outlook-chips.expected.json.

const OUTLOOK = "chat-composercontextoutlook";
const SHELL = '[data-ui="chat-input-shell"]';
const CONTROLS = '[data-ui="chat-input-controls"]';
const MODE = '[data-ui="composer-mode-chip"]';
const MODE_LIVE = '[data-ui="composer-mode-live"]';
const MORE = '[data-ui="composer-context-more"][data-expanded="false"] button';

const THREAD = "RE: Q4 vendor contract renewal";
const QUOTE = "“Could you confirm the delivery date by Friday?”";
const FULL = "5 messages · 1.5 MB of 25 MB";
const PARTIAL = "3 of 5 messages · 1.2 MB of 25 MB";
const OFFSITE = "Re: Offsite agenda";
const OFFSITE_META = "Lena Hoffmann • 10/7/2026 · 2/2 attachments";
const BUDGET = "Budget 2027 draft";
const BUDGET_META = "Jonas Weber • 10/12/2026 · 3/3 attachments";
const APPOINTMENT_WHEN = "Fri, Oct 23, 10:00 – 11:00 AM";
const SCHEDULING_DESCRIPTION =
  "Scheduling stays on for an hour after Erato last read your calendar (until 3:40 PM).";
const SENDING_LOCK = "Can't change this while the message is being sent";
const DROPPING_LOCK =
  "Dropped emails can't be cancelled while Erato reads them";
const OFF_ITEM = "Off until you switch mail items";
const FOLLOW_UP = "Not included on follow-up messages";
const NOT_WITH_DROPS = "Not sent with dropped emails";
const SENT_EARLIER = "Sent earlier, not re-sent";

type Kind =
  | "outlook.selection"
  | "outlook.draft"
  | "outlook.appointment"
  | "outlook.thread"
  | "outlook.draftAttachment"
  | "outlook.draftAttachments"
  | "outlook.mailAttachment"
  | "outlook.droppedEmail"
  | "outlook.dropProgress";

interface Expected {
  kind: Kind;
  label: string;
  state: string;
  tone?: "warning" | "error";
  meta: string | null;
  control: string | null;
  locked?: string;
  actions?: string[];
}

interface Story {
  id: string;
  chips: Expected[];
  mode?: string;
  files?: number;
}

/** What the add-in's own resolvers draw for a story or flow (outlookStoryParity.test.ts). */
interface AddinChip {
  kind: Kind;
  origin: "ambient" | "user";
  dismissScope?: "item" | "selection" | "message" | "chat";
  state: string;
  tone?: "warning" | "error";
  label: string;
  meta: string | null;
  control: string | null;
  lockReason?: string | null;
  actions?: { label: string; announcement: string | null }[];
}
interface AddinContext {
  chips: AddinChip[];
  modes: {
    label: string;
    description: string | null;
    endLabel: string;
    endedAnnouncement: string | null;
  }[];
}
const ADDIN = JSON.parse(
  readFileSync(
    new URL("./outlook-chips.expected.json", import.meta.url),
    "utf8",
  ),
) as {
  stories: Record<string, AddinContext>;
  flows: Record<string, AddinContext & { story: string }>;
};

// The lane's own default for a suggested ambient chip the host gives no meta.
const SCOPE_META: Record<string, string> = {
  item: "Off until you switch mail items",
  selection: "Off until the selection changes",
};
const expectedOf = (chip: AddinChip): Expected => ({
  kind: chip.kind,
  label: chip.label,
  state: chip.state,
  ...(chip.tone ? { tone: chip.tone } : {}),
  meta:
    chip.meta ??
    (chip.state === "suggested" &&
    chip.origin === "ambient" &&
    chip.dismissScope
      ? SCOPE_META[chip.dismissScope]
      : null),
  control: chip.control,
  ...(chip.lockReason ? { locked: chip.lockReason } : {}),
  ...(chip.actions
    ? { actions: chip.actions.map((action) => action.label) }
    : {}),
});
const FILES: Record<string, number> = { busy: 3 };
const STORIES: Story[] = Object.entries(ADDIN.stories).map(([id, story]) => ({
  id,
  chips: story.chips.map(expectedOf),
  ...(story.modes[0]?.endedAnnouncement
    ? { mode: story.modes[0].endedAnnouncement }
    : {}),
  ...(FILES[id] ? { files: FILES[id] } : {}),
}));
const flow = (name: string) => {
  const found = ADDIN.flows[name];
  if (!found) throw new Error(`no flow ${name} in outlook-chips.expected.json`);
  return found.chips.map(expectedOf);
};

const STATE_WORD: Record<string, string> = {
  included: "Included.",
  suggested: "Not included.",
  superseded: "Not sent.",
  loading: "Loading.",
  error: "Error.",
  attention: "Needs your choice.",
};

const openOutlook = async (
  page: Page,
  story: string,
  options: { theme?: "light" | "dark"; width?: number; locale?: string } = {},
) => openStory(page, `${OUTLOOK}--${story}`, SHELL, options);

const kind = (page: Page, name: Kind) =>
  page.locator(`${CHIP}[data-kind="${name}"]`);
const chipNamed = (page: Page, label: string) =>
  page.locator(CHIP).filter({
    has: page.locator('[data-ui="composer-context-chip-label"]', {
      hasText: label,
    }),
  });
const open = (chip: Locator) => chip.locator(OPEN);
const metaOf = (chip: Locator) =>
  chip.locator('[data-ui="composer-context-chip-meta"]');
const control = (chip: Locator) =>
  chip.locator(
    '[data-ui="composer-context-remove"], [data-ui="composer-context-restore"]',
  );
const style = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
const notesIn = (detail: Locator) =>
  detail.locator('[data-ui="outlook-context-detail-note"]');
const lifetimeIn = (detail: Locator) =>
  detail.locator('[data-ui="outlook-context-detail-lifetime"]');
const textarea = (page: Page) => page.locator(`${SHELL} textarea`);

const expandLane = async (page: Page) => {
  const more = page.locator(MORE);
  if ((await more.count()) > 0) await more.click();
};

const openDetail = async (
  page: Page,
  story: string,
  chip: (page: Page) => Locator,
  title: string,
) => {
  await openOutlook(page, story);
  await open(chip(page)).click();
  const detail = page.getByRole("dialog", { name: title });
  await expect(detail).toBeVisible();
  return detail;
};

/** Chips at their token height inside the lane, controls inside their chip, no page overflow. */
const expectFits = async (page: Page, width: number, story: string) => {
  if ((await page.locator(CHIP).count()) > 0) {
    const lane = await boxOf(page.locator(LANE));
    for (const item of await page.locator(CHIP).all()) {
      const box = await boxOf(item);
      expect(box.height, story).toBeCloseTo(54, 0);
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
  }
  expect(
    await page.evaluate(() => document.scrollingElement!.scrollWidth),
    story,
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
const MODE_TEXT = `${MODE} [data-ui="composer-mode-chip-label"]`;

const expectChip = async (chip: Locator, expected: Expected, story: string) => {
  await expect(chip, story).toHaveAttribute("data-state", expected.state);
  if (expected.tone) {
    await expect(chip, story).toHaveAttribute("data-tone", expected.tone);
  }
  if (expected.meta === null) {
    await expect(metaOf(chip), story).toHaveCount(0);
  } else {
    await expect(metaOf(chip), story).toHaveText(expected.meta);
  }
  await expect(
    chip.locator('[data-ui="composer-context-chip-label"]'),
    story,
  ).toHaveText(expected.label);
  await expect(open(chip), story).toHaveAccessibleName(
    [expected.label, expected.meta, STATE_WORD[expected.state]]
      .filter((part) => part !== null)
      .concat(expected.locked ? ["Locked."] : [])
      .join(" "),
  );
  const button = control(chip);
  if (expected.control === null) {
    await expect(button, story).toHaveCount(0);
  } else {
    await expect(button, story).toHaveAccessibleName(expected.control);
  }
  if (expected.locked) {
    await expect(chip, story).toHaveAttribute("data-locked", "true");
    if (expected.control !== null) {
      await expect(button, story).toBeDisabled();
      await expect(button, story).toHaveAttribute("title", expected.locked);
    }
  }
};

/** Records every committed frame's chip states, to catch a frame where two chips disagree. */
const recordFrames = (page: Page) =>
  page.evaluate(() => {
    const frames: Record<string, string>[] = [];
    (window as unknown as { __frames: typeof frames }).__frames = frames;
    const snapshot = () => {
      const states: Record<string, string> = {};
      for (const chip of document.querySelectorAll<HTMLElement>(
        '[data-ui="composer-context-chip"]',
      )) {
        states[chip.dataset.kind ?? ""] = chip.dataset.state ?? "";
      }
      if (document.querySelector('[data-ui="composer-mode-chip"]')) {
        states.mode = "on";
      }
      frames.push(states);
    };
    new MutationObserver(snapshot).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
  });
const framesOf = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __frames: Record<string, string>[] }).__frames,
  );

test.describe("every story", () => {
  for (const story of STORIES) {
    test(`${story.id}: order, names and fit at 340`, async ({ page }) => {
      await openOutlook(page, story.id);
      await expandLane(page);
      if (story.chips.length > 0) {
        await expect(
          page.getByRole("list", { name: "Message context" }),
        ).toHaveCount(1);
      }
      const chips = page.locator(CHIP);
      await expect(chips).toHaveCount(story.chips.length);
      // Ambient items first in a fixed order, then the dropped emails in drop order.
      expect(
        await chips.evaluateAll((items) =>
          items.map((item) => item.getAttribute("data-kind")),
        ),
        story.id,
      ).toEqual(story.chips.map((chip) => chip.kind));
      const origins = await chips.evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-origin")),
      );
      const firstUser = origins.indexOf("user");
      if (firstUser >= 0) {
        expect(origins.slice(firstUser), story.id).not.toContain("ambient");
      }
      for (const [index, expected] of story.chips.entries()) {
        await expectChip(chips.nth(index), expected, story.id);
      }
      const quote = kind(page, "outlook.selection").locator(
        '[data-ui="composer-context-chip-label"]',
      );
      if ((await quote.count()) > 0) {
        const text = await quote.innerText();
        expect(Array.from(text.slice(1, -1)).length).toBeLessThanOrEqual(61);
      }
      await expect(page.locator(MODE), story.id).toHaveCount(
        story.mode ? 1 : 0,
      );
      await expect(
        page.locator(`${AREA} [data-ui="attachment-tile"]`),
      ).toHaveCount(story.files ?? 0);
      await expectFits(page, 340, story.id);
      for (const { text, ratio } of await ratiosOf(page, CHIP_TEXT)) {
        expect(ratio, `${story.id}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("fits the 480 px breakpoint", async ({ page }) => {
    // One test walks every story; the default 30 s is about what that takes.
    test.setTimeout(120_000);
    for (const { id } of STORIES) {
      await openOutlook(page, id, { width: 480 });
      await expandLane(page);
      await expectFits(page, 480, id);
    }
  });

  test("reads at 4.5:1 in dark", async ({ page }) => {
    test.setTimeout(120_000);
    for (const { id, mode } of STORIES) {
      await openOutlook(page, id, { theme: "dark" });
      await expandLane(page);
      for (const { text, ratio } of await ratiosOf(page, CHIP_TEXT)) {
        expect(ratio, `${id}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
      if (mode) {
        for (const { text, ratio } of await ratiosOf(page, MODE_TEXT)) {
          expect(ratio, `${id}: ${text}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

const expectLane = async (page: Page, chips: Expected[], label: string) => {
  const items = page.locator(CHIP);
  await expect(items, label).toHaveCount(chips.length);
  for (const [index, expected] of chips.entries()) {
    await expectChip(items.nth(index), expected, label);
  }
};
const press = async (page: Page, chip: Locator, key: string) => {
  await open(chip).focus();
  await page.keyboard.press(key);
};

/** The steps that take a story to each flow's end, as a user would take them. */
const FLOW_STEPS: Record<string, [string, (page: Page) => Promise<void>]> = {
  "ThreadPartial: Delete": [
    "thread-partial",
    (page) => press(page, kind(page, "outlook.thread"), "Delete"),
  ],
  "ThreadError: Delete": [
    "thread-error",
    (page) => press(page, kind(page, "outlook.thread"), "Delete"),
  ],
  "ThreadError: Delete, + loads": [
    "thread-error",
    async (page) => {
      const chip = kind(page, "outlook.thread");
      await press(page, chip, "Delete");
      await press(page, chip, "+");
      await expect(chip).toHaveAttribute("data-state", "included");
    },
  ],
  "ThreadErrorAgain: + fails again": [
    "thread-error-again",
    async (page) => {
      const chip = kind(page, "outlook.thread");
      await press(page, chip, "Delete");
      await press(page, chip, "+");
      await expect(chip).toHaveAttribute("data-state", "loading");
      await expect(chip).toHaveAttribute("data-state", "error");
    },
  ],
  "ThreadSignIn: Sign in loads": [
    "thread-sign-in",
    async (page) => {
      const chip = kind(page, "outlook.thread");
      await open(chip).click();
      await page
        .getByRole("dialog", { name: THREAD })
        .getByRole("button", { name: "Sign in" })
        .click();
      await expect(chip).toHaveAttribute("data-state", "included", {
        timeout: 10_000,
      });
    },
  ],
  "ThreadFollowUp: +": [
    "thread-follow-up",
    (page) => press(page, kind(page, "outlook.thread"), "+"),
  ],
  "ThreadFollowUpError: + loads": [
    "thread-follow-up-error",
    async (page) => {
      const chip = kind(page, "outlook.thread");
      await press(page, chip, "+");
      await expect(chip).toHaveAttribute("data-state", "included");
    },
  ],
  "InteractiveRead: send": [
    "interactive-read",
    (page) =>
      page
        .getByRole("group", { name: "Simulate" })
        .getByRole("button", { name: "Send" })
        .click(),
  ],
  "Drops: Delete the first": [
    "drops",
    (page) => press(page, chipNamed(page, OFFSITE), "Delete"),
  ],
  "Selection: Delete": [
    "selection",
    (page) => press(page, kind(page, "outlook.selection"), "Delete"),
  ],
  "Draft: Delete": [
    "draft",
    (page) => press(page, kind(page, "outlook.draft"), "Delete"),
  ],
  "AttachmentsGroup: untick pricing, Delete": [
    "attachments-group",
    async (page) => {
      const group = kind(page, "outlook.draftAttachments");
      await open(group).click();
      await page
        .getByRole("dialog", { name: "Draft attachments (3)" })
        .getByRole("checkbox", { name: "Include pricing.xlsx" })
        .uncheck();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await press(page, group, "Delete");
    },
  ],
  "Scheduling: End": [
    "scheduling",
    (page) =>
      page
        .locator(MODE)
        .getByRole("button", { name: "End scheduling" })
        .click(),
  ],
};

test.describe("flows land where the add-in lands", () => {
  test("every flow in the add-in's file has its steps here", () => {
    expect(Object.keys(FLOW_STEPS).sort()).toEqual(
      Object.keys(ADDIN.flows).sort(),
    );
  });

  for (const [name, [story, steps]] of Object.entries(FLOW_STEPS)) {
    test(name, async ({ page }) => {
      expect(ADDIN.flows[name]?.story).toBe(story);
      await openOutlook(page, story);
      await steps(page);
      await expectLane(page, flow(name), name);
      await expect(page.locator(MODE), name).toHaveCount(
        ADDIN.flows[name]!.modes.length,
      );
    });
  }
});

test.describe("details", () => {
  // Only these kinds carry detail actions in the add-in.
  const ACTION_KINDS = new Set([
    "outlook.draft",
    "outlook.appointment",
    "outlook.thread",
  ]);
  test("offer exactly the add-in's actions", async ({ page }) => {
    for (const story of STORIES) {
      if (!story.chips.some((chip) => ACTION_KINDS.has(chip.kind))) continue;
      await openOutlook(page, story.id);
      await expandLane(page);
      for (const expected of story.chips) {
        if (!ACTION_KINDS.has(expected.kind)) continue;
        await open(kind(page, expected.kind)).click();
        const sheet = page.getByRole("dialog", { name: expected.label });
        await expect(sheet, story.id).toBeVisible();
        const buttons = await sheet
          .locator('[data-ui="composer-context-detail-actions"] button')
          .allInnerTexts();
        const actions = buttons.slice(
          0,
          buttons.length - (expected.control === null ? 0 : 1),
        );
        expect(actions, `${story.id}: ${expected.label}`).toEqual(
          expected.actions ?? [],
        );
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    }
  });
});

test.describe("tones", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`error, attention, superseded and suggested looks, ${theme}`, async ({
      page,
    }) => {
      for (const [story, label] of [
        ["thread-error", THREAD],
        ["thread-trim-failed", THREAD],
        ["cloud-attachment", "Renewal terms.docx"],
        ["attachments-group-cloud", "Draft attachments (3)"],
        ["drop-trim-failed", OFFSITE],
      ] as const) {
        await openOutlook(page, story, { theme });
        const chip = chipNamed(page, label);
        await expect(chip).toHaveAttribute("data-tone", "error");
        expect(await style(chip, "border-top-color"), story).toBe(
          await tokenColor(chip, "--theme-error-border"),
        );
      }

      await openOutlook(page, "thread-sign-in", { theme });
      const attention = kind(page, "outlook.thread");
      expect(await style(attention, "border-top-color")).toBe(
        await tokenColor(attention, "--theme-warning-border"),
      );

      for (const [story, label] of [
        ["draft-unchanged", "Your draft"],
        ["draft-unchanged", "contract-v3.pdf"],
        ["scheduling", "Your draft"],
        ["selection", "Your draft"],
        ["appointment-selection", "Appointment details"],
        ["attachments-sent-earlier", "Draft attachments (3)"],
        ["attachments-with-drop", "pricing.xlsx"],
        ["mail-attachments-with-drop", "contract-v3.pdf"],
      ] as const) {
        await openOutlook(page, story, { theme });
        const chip = chipNamed(page, label);
        await expect(chip, story).toHaveAttribute("data-state", "superseded");
        expect(await style(chip, "background-color"), story).toBe(
          "rgba(0, 0, 0, 0)",
        );
        expect(await style(metaOf(chip), "font-style"), story).toBe("italic");
      }

      for (const [story, label] of [
        ["thread-off", THREAD],
        ["thread-follow-up", THREAD],
        ["draft-off", "Your draft"],
        ["selection-dismissed", QUOTE],
        ["attachments-group-off", "Draft attachments (3)"],
      ] as const) {
        await openOutlook(page, story, { theme });
        expect(
          await style(chipNamed(page, label), "border-top-style"),
          story,
        ).toBe("dashed");
      }
    });
  }

  test("a thread being loaded spins without a second status", async ({
    page,
  }) => {
    await openOutlook(page, "thread-loading");
    const chip = kind(page, "outlook.thread");
    await expect(chip.locator('[data-ui="spinner"]')).toHaveCount(1);
    await expect(chip.locator('[role="status"]')).toHaveCount(0);
    await expect(control(chip)).toBeEnabled();
  });
});

test.describe("scheduling mode", () => {
  for (const width of [340, 1280]) {
    test(`sits in the controls row after the add control, ${width}`, async ({
      page,
    }) => {
      await openOutlook(page, "scheduling", { width });
      const mode = page.locator(`${CONTROLS} ${MODE}`);
      await expect(mode).toHaveCount(1);
      await expect(page.locator(`${LANE} ${MODE}`)).toHaveCount(0);
      const box = await boxOf(mode);
      expect(box.height).toBeCloseTo(28, 0);
      const add = await boxOf(page.locator(`${CONTROLS} button`).first());
      expect(box.x).toBeGreaterThanOrEqual(add.x + add.width);
      const send = await boxOf(page.getByTestId("chat-input-send-message"));
      expect(box.x + box.width).toBeLessThanOrEqual(send.x);
      await expect(mode).toHaveAttribute("data-mode-id", "outlook.scheduling");
      await expect(mode).toHaveAttribute("title", SCHEDULING_DESCRIPTION);
      await expect(
        page.locator(CONTROLS).getByRole("group", { name: "Scheduling" }),
      ).toHaveCount(1);
      const end = mode.locator('[data-ui="composer-mode-end"]');
      await expect(end).toHaveAccessibleName("End scheduling");
      await expect(end).toHaveAccessibleDescription(SCHEDULING_DESCRIPTION);
      for (const theme of ["light", "dark"] as const) {
        await openOutlook(page, "scheduling", { width, theme });
        for (const { text, ratio } of await ratiosOf(page, MODE_TEXT)) {
          expect(ratio, `${theme}: ${text}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  test("End gives the draft back in the same frame, says so and returns to the composer", async ({
    page,
  }) => {
    await openOutlook(page, "scheduling");
    await recordFrames(page);
    await page
      .locator(MODE)
      .getByRole("button", { name: "End scheduling" })
      .click();
    await expect(page.locator(MODE)).toHaveCount(0);
    await expect(kind(page, "outlook.draft")).toHaveAttribute(
      "data-state",
      "included",
    );
    await expect(metaOf(kind(page, "outlook.draft"))).toHaveText(
      "Reply to Anna Weber",
    );
    await expect(page.locator(MODE_LIVE)).toHaveText(
      "Scheduling ended. Your draft is sent again.",
    );
    await expect(textarea(page)).toBeFocused();
    const frames = await framesOf(page);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.mode === "on" || frame["outlook.draft"] === "included").toBe(
        true,
      );
    }
  });

  test("End scheduling in the draft's detail does the same", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "scheduling",
      (p) => kind(p, "outlook.draft"),
      "Your draft",
    );
    await expect(notesIn(sheet)).toHaveText([
      "Scheduling takes priority, so this message does not carry your draft. End scheduling to send it again.",
    ]);
    await sheet.getByRole("button", { name: "End scheduling" }).click();
    await expect(page.locator(MODE)).toHaveCount(0);
    await expect(kind(page, "outlook.draft")).toHaveAttribute(
      "data-state",
      "included",
    );
    await expect(live(page)).toHaveText(
      "Scheduling ended. Your draft is sent again.",
    );
  });

  test("in read mode it only says scheduling ended", async ({ page }) => {
    await openOutlook(page, "read-scheduling");
    await page
      .locator(MODE)
      .getByRole("button", { name: "End scheduling" })
      .click();
    await expect(page.locator(MODE)).toHaveCount(0);
    await expect(page.locator(MODE_LIVE)).toHaveText("Scheduling ended.");
    await expect(kind(page, "outlook.thread")).toHaveAttribute(
      "data-state",
      "included",
    );
  });

  test("keeps still while a message is being sent", async ({ page }) => {
    await openOutlook(page, "sending");
    const end = page.locator(`${MODE} [data-ui="composer-mode-end"]`);
    await expect(end).toBeDisabled();
    await expect(end).toHaveAttribute("title", SENDING_LOCK);
  });
});

test.describe("read flows", () => {
  test("Delete leaves a partial thread out, + brings the earlier choice back", async ({
    page,
  }) => {
    await openOutlook(page, "thread-partial");
    const chip = kind(page, "outlook.thread");
    await open(chip).focus();
    await page.keyboard.press("Delete");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await expect(metaOf(chip)).toHaveText(OFF_ITEM);
    await expect(live(page)).toHaveText(
      "Email thread removed. Include again with +",
    );
    await expect(open(chip)).toBeFocused();
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(metaOf(chip)).toHaveText(PARTIAL);
    await expect(live(page)).toHaveText(
      "Email thread included. Your earlier choice is back.",
    );
  });

  test("unticking every message leaves nothing chosen; Include every message brings all back", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "thread-included",
      (p) => kind(p, "outlook.thread"),
      THREAD,
    );
    const messages = sheet.getByRole("checkbox", { name: /^Include message / });
    await expect(messages).toHaveCount(5);
    for (const box of await messages.all()) await box.uncheck();
    const chip = kind(page, "outlook.thread");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await expect(metaOf(chip)).toHaveText("Nothing chosen");
    await sheet.getByRole("button", { name: "Include every message" }).click();
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(metaOf(chip)).toHaveText(FULL);
    await expect(live(page)).toHaveText("Email thread included.");
  });

  test("ticking a message of a thread left out brings the thread back", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "thread-off",
      (p) => kind(p, "outlook.thread"),
      THREAD,
    );
    await expect(notesIn(sheet)).toHaveText([
      "The email is not included right now. Your choices below are kept and come back when you include it.",
    ]);
    await sheet
      .getByRole("checkbox", { name: "Include message Tom Fischer" })
      .first()
      .check();
    const chip = kind(page, "outlook.thread");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(metaOf(chip)).toHaveText("4 of 5 messages · 1.2 MB of 25 MB");
  });

  test("an unloadable thread turns off with Delete and loads again with +", async ({
    page,
  }) => {
    await openOutlook(page, "thread-error");
    const chip = kind(page, "outlook.thread");
    await open(chip).focus();
    await page.keyboard.press("Delete");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await expect(control(chip)).toHaveAccessibleName(
      "Try loading the email again",
    );
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "loading");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(metaOf(chip)).toHaveText(FULL);
    await expect(live(page)).toHaveText("Email thread included.");
  });

  test("a + that fails again says where it landed", async ({ page }) => {
    await openOutlook(page, "thread-error-again");
    const chip = kind(page, "outlook.thread");
    await open(chip).focus();
    await page.keyboard.press("Delete");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "loading");
    await expect(chip).toHaveAttribute("data-state", "error");
    await expect(live(page)).toHaveText(
      "Email thread: Couldn't load the email thread",
    );
  });

  test("Try again loads, then says the thread loaded", async ({ page }) => {
    const sheet = await openDetail(
      page,
      "thread-error",
      (p) => kind(p, "outlook.thread"),
      THREAD,
    );
    const note = notesIn(sheet);
    await expect(note).toHaveAttribute("data-tone", "error");
    await expect(note.locator("strong")).toHaveText(
      "Couldn't load the email thread",
    );
    await expect(note).toContainText(
      "You can still send without this email context.",
    );
    await expect(
      sheet.getByRole("checkbox", { name: /^Include message / }),
    ).toHaveCount(0);
    await sheet.getByRole("button", { name: "Try again" }).click();
    const chip = kind(page, "outlook.thread");
    await expect(chip).toHaveAttribute("data-state", "loading");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(live(page)).toHaveText("Email thread loaded.");
  });

  test("a slow sign-in still ends by saying the thread loaded", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "thread-sign-in",
      (p) => kind(p, "outlook.thread"),
      THREAD,
    );
    await expect(notesIn(sheet)).toHaveText([
      "This email wasn't attached because reading it needs a quick sign-in.",
    ]);
    await expect(notesIn(sheet)).toHaveAttribute("data-tone", "warning");
    await sheet.getByRole("button", { name: "Sign in" }).click();
    const chip = kind(page, "outlook.thread");
    await expect(chip).toHaveAttribute("data-state", "loading");
    await expect(metaOf(chip)).toHaveText("Signing in…");
    await expect(control(chip)).toHaveAccessibleName("Leave out the email");
    // The fake sign-in takes longer than the lane waits for an answer that is not loading.
    await expect(chip).toHaveAttribute("data-state", "included", {
      timeout: 10_000,
    });
    await expect(live(page)).toHaveText("Email thread loaded.");
  });

  test("a missing permission asks to allow access", async ({ page }) => {
    const sheet = await openDetail(
      page,
      "thread-consent",
      (p) => kind(p, "outlook.thread"),
      THREAD,
    );
    await expect(notesIn(sheet)).toHaveText([
      "This email wasn't attached because reading its mailbox needs a permission you haven't granted yet.",
    ]);
    await expect(
      sheet.getByRole("button", { name: "Allow access" }),
    ).toBeVisible();
  });

  test("a loading thread can be left out, and the composer stops waiting", async ({
    page,
  }) => {
    await openOutlook(page, "thread-loading");
    const chip = kind(page, "outlook.thread");
    await expect(control(chip)).toBeEnabled();
    await expect(control(chip)).toHaveAccessibleName("Leave out the email");
    await expect(textarea(page)).toBeDisabled();
    await open(chip).focus();
    await page.keyboard.press("Delete");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await expect(textarea(page)).toBeEnabled();
  });

  test("on a follow-up the open email is only suggested; + includes it", async ({
    page,
  }) => {
    await openOutlook(page, "thread-follow-up");
    const chip = kind(page, "outlook.thread");
    await open(chip).focus();
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(metaOf(chip)).toHaveText(FULL);
    await expect(live(page)).toHaveText("Email thread included.");
  });

  test("a trim the bytes refuse is fixed by ticking the part again", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "thread-trim-failed",
      (p) => kind(p, "outlook.thread"),
      THREAD,
    );
    await expect(notesIn(sheet)).toHaveText([
      "Some unticked attachments sit inside a forwarded email and can't be cut out, so a message with this email is not sent. Tick them again, or leave the email out.",
    ]);
    await sheet
      .getByRole("checkbox", { name: "Include legal-review-notes.pdf" })
      .check();
    const chip = kind(page, "outlook.thread");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(metaOf(chip)).toHaveText(FULL);
  });

  test("Delete removes a dropped email outright and moves to the next", async ({
    page,
  }) => {
    await openOutlook(page, "drops");
    await open(chipNamed(page, OFFSITE)).focus();
    await page.keyboard.press("Delete");
    await expect(chipNamed(page, OFFSITE)).toHaveCount(0);
    await expect(live(page)).toHaveText(`${OFFSITE} removed.`);
    await expect(open(chipNamed(page, BUDGET))).toBeFocused();
    await expect(kind(page, "outlook.thread")).toHaveAttribute(
      "data-state",
      "included",
    );
  });

  test("a dropped email's detail: the body always goes, attachments are a checklist", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "drops",
      (p) => chipNamed(p, OFFSITE),
      OFFSITE,
    );
    await expect(sheet.getByRole("checkbox")).toHaveCount(2);
    await expect(
      sheet.getByRole("checkbox", { name: /Email body/ }),
    ).toHaveCount(0);
    await expect(sheet).toContainText("Email body");
    await expect(sheet).toContainText("Email · 41 KB · Always sent");
    await sheet
      .getByRole("checkbox", { name: "Include venue-map.png" })
      .uncheck();
    await expect(metaOf(chipNamed(page, OFFSITE))).toHaveText(
      "Lena Hoffmann • 10/7/2026 · 1/2 attachments",
    );
    await expect(sheet.getByRole("button", { name: "Remove" })).toBeVisible();
  });

  test("drop progress keeps still while the other chips stay live", async ({
    page,
  }) => {
    await openOutlook(page, "dropping");
    const progress = kind(page, "outlook.dropProgress");
    await expect(control(progress)).toHaveCount(0);
    await expect(progress).toHaveAttribute("data-locked", "true");
    await expect(progress.locator('[data-ui="spinner"]')).toHaveCount(1);
    await open(progress).focus();
    await page.keyboard.press("Delete");
    await expect(live(page)).toHaveText(DROPPING_LOCK);
    await expect(progress).toHaveCount(1);
    const threadChip = kind(page, "outlook.thread");
    await open(threadChip).focus();
    await page.keyboard.press("Delete");
    await expect(threadChip).toHaveAttribute("data-state", "suggested");
  });

  test("dropped emails arrive after one progress chip", async ({ page }) => {
    await openOutlook(page, "interactive-read");
    await page
      .getByRole("group", { name: "Simulate" })
      .getByRole("button", { name: "Drop 2 emails" })
      .click();
    const progress = kind(page, "outlook.dropProgress");
    await expect(progress).toHaveCount(1);
    await expect(textarea(page)).toBeDisabled();
    await expect(progress).toHaveCount(0, { timeout: 10_000 });
    await expect(kind(page, "outlook.droppedEmail")).toHaveCount(2);
    await expect(textarea(page)).toBeEnabled();
  });

  test("after a send the thread is in the chat and has no chip", async ({
    page,
  }) => {
    await openOutlook(page, "interactive-read");
    await page
      .getByRole("group", { name: "Simulate" })
      .getByRole("button", { name: "Send" })
      .click();
    await expect(kind(page, "outlook.thread")).toHaveCount(0);
  });
});

test.describe("compose flows", () => {
  test("dismissing the selection gives the draft back in the same frame", async ({
    page,
  }) => {
    await openOutlook(page, "selection");
    await recordFrames(page);
    const sel = kind(page, "outlook.selection");
    await open(sel).focus();
    await page.keyboard.press("Delete");
    await expect(sel).toHaveAttribute("data-state", "suggested");
    await expect(metaOf(sel)).toHaveText("Off until the selection changes");
    await expect(kind(page, "outlook.draft")).toHaveAttribute(
      "data-state",
      "included",
    );
    await expect(live(page)).toHaveText(
      "Selection removed. Include again with +",
    );
    const frames = await framesOf(page);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(
        frame["outlook.selection"] === "suggested" &&
          frame["outlook.draft"] === "superseded",
      ).toBe(false);
    }
    await page.keyboard.press("+");
    await expect(sel).toHaveAttribute("data-state", "included");
    await expect(kind(page, "outlook.draft")).toHaveAttribute(
      "data-state",
      "superseded",
    );
  });

  for (const [story, draftKind, title, announcement] of [
    [
      "selection",
      "outlook.draft",
      "Your draft",
      "Draft included. Your selection is off until it changes.",
    ],
    [
      "appointment-selection",
      "outlook.appointment",
      "Appointment details",
      "Appointment details included. Your selection is off until it changes.",
    ],
  ] as const) {
    test(`Send this instead on ${story} keeps focus on its chip and says so`, async ({
      page,
    }) => {
      await openOutlook(page, story);
      const chip = kind(page, draftKind);
      await open(chip).focus();
      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog", { name: title });
      await expect(sheet).toBeVisible();
      await expect(notesIn(sheet)).toHaveCount(1);
      await sheet.getByRole("button", { name: "Send this instead" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(chip).toHaveAttribute("data-state", "included");
      await expect(kind(page, "outlook.selection")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      await expect(open(chip)).toBeFocused();
      await expect(live(page)).toHaveText(announcement);
    });
  }

  test("Delete leaves the draft out until the mail item changes, + takes it back", async ({
    page,
  }) => {
    await openOutlook(page, "draft");
    const chip = kind(page, "outlook.draft");
    await open(chip).focus();
    await page.keyboard.press("Delete");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await expect(metaOf(chip)).toHaveText(OFF_ITEM);
    await expect(live(page)).toHaveText("Draft removed. Include again with +");
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(metaOf(chip)).toHaveText("Reply to Anna Weber");
    await expect(live(page)).toHaveText("Draft included.");
  });

  test("the group's checklist, Delete and + keep the earlier ticks", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "attachments-group",
      (p) => kind(p, "outlook.draftAttachments"),
      "Draft attachments (3)",
    );
    const group = kind(page, "outlook.draftAttachments");
    await sheet
      .getByRole("checkbox", { name: "Include pricing.xlsx" })
      .uncheck();
    await expect(metaOf(group)).toHaveText("2 of 3 · 702 KB");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await open(group).focus();
    await page.keyboard.press("Delete");
    await expect(group).toHaveAttribute("data-state", "suggested");
    await expect(metaOf(group)).toHaveText(OFF_ITEM);
    await page.keyboard.press("+");
    await expect(group).toHaveAttribute("data-state", "included");
    await expect(metaOf(group)).toHaveText("2 of 3 · 702 KB");
    await expect(live(page)).toHaveText("Draft attachments included.");
  });

  test("a group with nothing ticked comes back whole with +", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "attachments-group",
      (p) => kind(p, "outlook.draftAttachments"),
      "Draft attachments (3)",
    );
    for (const box of await sheet.getByRole("checkbox").all()) {
      await box.uncheck();
    }
    const group = kind(page, "outlook.draftAttachments");
    await expect(group).toHaveAttribute("data-state", "suggested");
    await expect(metaOf(group)).toHaveText("Nothing chosen");
    await sheet
      .getByRole("button", { name: "Include draft attachments" })
      .click();
    await expect(group).toHaveAttribute("data-state", "included");
    await expect(metaOf(group)).toHaveText("3 of 3 · 738 KB");
  });

  test("on a follow-up + sends an unsent attachment with this message", async ({
    page,
  }) => {
    await openOutlook(page, "attachments-follow-up");
    const chip = chipNamed(page, "pricing.xlsx");
    await open(chip).click();
    const sheet = page.getByRole("dialog", { name: "pricing.xlsx" });
    await expect(notesIn(sheet)).toHaveText([
      "Attachments go with the first message only. Include it to send it with this one.",
    ]);
    await page.keyboard.press("Escape");
    await open(chip).focus();
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "included");
    await expect(metaOf(chip)).toHaveText("Draft attachment · 36 KB");
  });

  test("a cloud file's x leaves it out; + shows again why it can't go", async ({
    page,
  }) => {
    await openOutlook(page, "cloud-attachment");
    const chip = chipNamed(page, "Renewal terms.docx");
    await open(chip).focus();
    await page.keyboard.press("Delete");
    await expect(chip).toHaveAttribute("data-state", "suggested");
    await expect(control(chip)).toHaveAccessibleName(
      "Include Renewal terms.docx",
    );
    await page.keyboard.press("+");
    await expect(chip).toHaveAttribute("data-state", "error");
    await expect(live(page)).toHaveText(
      "Renewal terms.docx: Cloud file · can't be sent",
    );
  });

  test("the appointment's detail lists what the next send reads", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "appointment",
      (p) => kind(p, "outlook.appointment"),
      "Appointment details",
    );
    const fields = sheet.locator('[data-ui="outlook-context-detail-fields"]');
    await expect(fields.locator("dt")).toHaveText([
      "Subject",
      "When",
      "Where",
      "Attendees",
    ]);
    await expect(fields.locator("dd")).toHaveText([
      "Steering committee: vendor renewal",
      "Fri, Oct 23, 2026, 10:00 – 11:00 AM",
      "Room 4.12 and Teams",
      "Anna Weber, Tom Fischer, Priya Raman",
    ]);
    await expect(
      sheet.locator('[data-ui="outlook-context-detail-quote"]'),
    ).toHaveCount(0);
  });

  test("while sending every control is disabled with the reason, and details still open", async ({
    page,
  }) => {
    await openOutlook(page, "sending");
    for (const item of await page.locator(CHIP).all()) {
      const button = control(item);
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("title", SENDING_LOCK);
    }
    const chip = kind(page, "outlook.draft");
    await open(chip).focus();
    await page.keyboard.press("Delete");
    await expect(live(page)).toHaveText(SENDING_LOCK);
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Your draft" });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "End scheduling" }),
    ).toHaveCount(0);
  });
});

test.describe("detail", () => {
  test("the thread checklist scrolls inside the sheet with its actions in view", async ({
    page,
  }) => {
    await openOutlook(page, "thread-included");
    await page.setViewportSize({ width: 340, height: 560 });
    await open(kind(page, "outlook.thread")).click();
    const sheet = page.getByRole("dialog", { name: THREAD });
    await expect(sheet).toHaveAttribute("data-placement", "bottom");
    await expect(sheet).toContainText(
      "Untick what Erato should not read. Attachments count toward the 25 MB limit.",
    );
    await expect(lifetimeIn(sheet)).toHaveText(
      "Leaving the email out lasts until you switch mail items. Including it again restores these ticks.",
    );
    const leaveOut = await boxOf(
      sheet.getByRole("button", { name: "Leave out" }),
    );
    expect(leaveOut.y + leaveOut.height).toBeLessThanOrEqual(560);
    const sheetBox = await boxOf(sheet);
    expect(sheetBox.y).toBeGreaterThanOrEqual(0);
    const scrolls = await sheet.evaluate(
      (element) =>
        [...element.querySelectorAll<HTMLElement>("*")].filter(
          (node) =>
            ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight + 1,
        ).length,
    );
    expect(scrolls).toBeGreaterThan(0);
  });

  test("the draft's text is a focusable, named box; the reply context is shown, not sent", async ({
    page,
  }) => {
    const sheet = await openDetail(
      page,
      "draft",
      (p) => kind(p, "outlook.draft"),
      "Your draft",
    );
    const quote = sheet.locator('[data-ui="outlook-context-detail-quote"]');
    await expect(quote).toHaveAccessibleName("Draft text");
    await expect(quote).toHaveAttribute("tabindex", "0");
    await quote.focus();
    await expect(quote).toBeFocused();
    await expect(
      sheet.locator('[data-ui="outlook-context-detail-fields"] dt'),
    ).toHaveText(["To", "Cc", "Reply to"]);
    await expect(sheet).toContainText(
      "The reply context is shown here only. It reaches Erato through your draft and is never sent on its own.",
    );
    await expect(lifetimeIn(sheet)).toHaveText(
      "Leaving it out lasts until you switch mail items.",
    );
  });

  test("notes say why a chip is not sent, by tone", async ({ page }) => {
    for (const [story, label, title, tone, text] of [
      [
        "draft-unchanged",
        "Your draft",
        "Your draft",
        "info",
        "Erato already has this version from an earlier message",
      ],
      [
        "selection",
        "Your draft",
        "Your draft",
        "info",
        "Your selection is sent instead of your draft.",
      ],
      [
        "selection",
        QUOTE,
        "Selected text",
        "info",
        "Sent instead of your draft, so Erato rewrites only this text.",
      ],
      [
        "attachments-with-drop",
        "contract-v3.pdf",
        "contract-v3.pdf",
        "info",
        "Your draft's attachments are not sent while dropped emails are attached.",
      ],
      [
        "mail-attachments-with-drop",
        "contract-v3.pdf",
        "contract-v3.pdf",
        "info",
        "This email's attachments are not sent while dropped emails are attached.",
      ],
      [
        "cloud-attachment",
        "Renewal terms.docx",
        "Renewal terms.docx",
        "error",
        "This is a link to a cloud file, which Outlook can't hand over, so it is not sent.",
      ],
      [
        "thread-follow-up",
        THREAD,
        THREAD,
        "info",
        "The email is not included right now.",
      ],
      [
        "drop-trim-failed",
        OFFSITE,
        OFFSITE,
        "error",
        "Some unticked attachments sit inside a forwarded email",
      ],
    ] as const) {
      const sheet = await openDetail(
        page,
        story,
        (p) => chipNamed(p, label),
        title,
      );
      const notes = notesIn(sheet);
      await expect(notes, story).toHaveCount(1);
      await expect(notes, story).toHaveAttribute("data-tone", tone);
      await expect(notes, story).toContainText(text);
    }
  });

  test("anchors a popover to its chip on the wide app", async ({ page }) => {
    await openOutlook(page, "thread-included", { width: 1280 });
    const chip = kind(page, "outlook.thread");
    await open(chip).click();
    const dialog = page.getByRole("dialog", { name: THREAD });
    await expect(dialog).toHaveAttribute("data-placement", "popover");
    const chipBox = await boxOf(chip);
    const box = await boxOf(dialog);
    const gap =
      box.y < chipBox.y
        ? chipBox.y - (box.y + box.height)
        : box.y - (chipBox.y + chipBox.height);
    expect(gap).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(12);
    expect(Math.abs(box.x - chipBox.x)).toBeLessThanOrEqual(1);
    await expect(
      dialog.getByRole("checkbox", { name: /^Include message / }),
    ).toHaveCount(5);
  });
});

test("speaks the lane's own words in German", async ({ page }) => {
  await openOutlook(page, "busy", { locale: "de" });
  await expect(
    page.getByRole("list", { name: "Kontext der Nachricht" }),
  ).toBeVisible();
  await expect(open(kind(page, "outlook.draft"))).toHaveAccessibleName(
    "Your draft Replaced by selection Wird nicht gesendet.",
  );
});

test("the web composer draws no mode chip", async ({ page }) => {
  await openStory(page, "ui-chatinput--default", SHELL);
  await expect(page.locator(MODE)).toHaveCount(0);
  await expect(page.locator(MODE_LIVE)).toHaveCount(0);
});
