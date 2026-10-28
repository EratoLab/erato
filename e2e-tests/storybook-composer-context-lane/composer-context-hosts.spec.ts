import { expect, test, type Page } from "@playwright/test";

import {
  AREA,
  boxOf,
  chip,
  CHIP,
  contrastOf,
  LANE,
  live,
  OPEN,
  openButton,
  openStory,
} from "./lane-helpers";

// Each host's context as the target prototype (P-ERMAIN-89) draws it, fed to
// the real lane as data. The expected chips are the prototype's own: kind,
// state, tone, origin, the open button's name, the (x)/(+) name and whether
// a detail opens. Files stay 54 px tiles beside the lane, so the prototype's
// file chips are left out.

const HOSTS = "chat-composercontexthosts";

interface ExpectedChip {
  kind: string;
  state: string;
  tone: "neutral" | "warning" | "error";
  origin: "ambient" | "user";
  locked?: true;
  name: string;
  control: string | null;
  detail: boolean;
}

interface Scenario {
  story: string;
  chips: ExpectedChip[];
  files?: number;
  notice?: "status" | "alert";
}

const docName = "Supply agreement.docx";
const quote = "“The Supplier shall deliver the Goods no later than the deliv…”";
const subject = "RE: Q4 vendor contract renewal";

const included = (
  kind: string,
  label: string,
  meta: string,
  control: string,
  origin: "ambient" | "user" = "ambient",
): ExpectedChip => ({
  kind,
  state: "included",
  tone: "neutral",
  origin,
  name: `${label} ${meta} Included.`,
  control,
  detail: true,
});

const docIncluded = (meta = "86 ¶ · 12 comments") =>
  included("word.document", docName, meta, "Don't include this document");
const selIncluded = included(
  "word.selection",
  quote,
  "Selected passage · 2 ¶",
  "Dismiss selection",
);
const docReplaced: ExpectedChip = {
  kind: "word.document",
  state: "superseded",
  tone: "neutral",
  origin: "ambient",
  name: `${docName} Replaced by selection Not sent.`,
  control: "Don't include this document",
  detail: true,
};
const threadIncluded = (meta = "5 messages · 1.5 MB of 25 MB") =>
  included("outlook.thread", subject, meta, "Leave out the email");
const draftIncluded = included(
  "outlook.draft",
  "Your draft",
  "Reply to Anna Weber",
  "Don't include draft",
);
const attachment = (label: string, meta: string, state = "included") => ({
  kind: "outlook.draftAttachment",
  state,
  tone: "neutral" as const,
  origin: "ambient" as const,
  name: `${label} ${meta} ${state === "included" ? "Included." : "Not sent."}`,
  control: `Don't include ${label}`,
  detail: true,
});
const contract = attachment("contract-v3.pdf", "Draft attachment · 482 KB");
const pricing = attachment("pricing.xlsx", "Draft attachment · 36 KB");

const SCENARIOS: Scenario[] = [
  { story: "word-document", chips: [docIncluded()] },
  { story: "word-selection", chips: [selIncluded, docReplaced] },
  {
    story: "word-suggested-selection",
    chips: [
      {
        kind: "word.selection",
        state: "suggested",
        tone: "neutral",
        origin: "ambient",
        name: "“The Buyer may audit the Supplier's records once per contract…” Shown by Erato · 1 ¶ Not included.",
        control: "Use this selection",
        detail: true,
      },
      docIncluded(),
    ],
  },
  {
    story: "word-document-off",
    chips: [
      {
        kind: "word.document",
        state: "suggested",
        tone: "neutral",
        origin: "ambient",
        // The lane's own words for a chat-long dismissal.
        name: `${docName} Off in this chat Not included.`,
        control: "Include this document",
        detail: true,
      },
      {
        kind: "word.openComments",
        state: "suggested",
        tone: "neutral",
        origin: "ambient",
        name: "Open comments (9) Not included Not included.",
        control: "Include open comments",
        detail: true,
      },
    ],
  },
  {
    story: "word-reading",
    chips: [
      {
        kind: "word.document",
        state: "loading",
        tone: "neutral",
        origin: "ambient",
        name: `${docName} Reading document… Loading.`,
        control: "Don't include this document",
        detail: true,
      },
    ],
    notice: "status",
  },
  ...["word-error", "word-error-again"].map(
    (story): Scenario => ({
      story,
      chips: [
        {
          kind: "word.document",
          state: "error",
          tone: "error",
          origin: "ambient",
          name: `${docName} Couldn't read the document Error.`,
          control: "Dismiss",
          detail: true,
        },
      ],
    }),
  ),
  {
    story: "word-cursor-in-comments",
    chips: [
      docIncluded("86 ¶"),
      {
        kind: "word.comment",
        state: "attention",
        tone: "warning",
        origin: "ambient",
        name: "Cursor is in 3 comments Choose one Needs your choice.",
        control: "Send without comments",
        detail: true,
      },
    ],
  },
  {
    story: "word-busy",
    chips: [
      selIncluded,
      docReplaced,
      included(
        "word.comment",
        "Comment by Maya Krüger",
        "At your cursor",
        "Send without comments",
      ),
    ],
    files: 5,
  },
  {
    // After Send, from the prototype's resolver: the selection failed, so the
    // document is no longer replaced.
    story: "word-selection-failed",
    chips: [
      {
        kind: "word.selection",
        state: "error",
        tone: "error",
        origin: "ambient",
        name: `${quote} Couldn't read · send again Error.`,
        control: "Dismiss selection",
        detail: true,
      },
      docIncluded(),
    ],
    notice: "alert",
  },
  { story: "word-changed", chips: [docIncluded("Changed since last send")] },
  { story: "outlook-read-thread", chips: [threadIncluded()] },
  {
    story: "outlook-read-partial",
    chips: [threadIncluded("3 of 5 messages · 1.2 MB of 25 MB")],
  },
  {
    story: "outlook-read-loading",
    chips: [
      {
        kind: "outlook.thread",
        state: "loading",
        tone: "neutral",
        origin: "ambient",
        name: `${subject} Loading email thread… Loading.`,
        control: "Leave out the email",
        detail: true,
      },
    ],
  },
  ...["outlook-read-error", "outlook-read-error-again"].map(
    (story): Scenario => ({
      story,
      chips: [
        {
          kind: "outlook.thread",
          state: "error",
          tone: "error",
          origin: "ambient",
          name: `${subject} Couldn't load the email thread Error.`,
          control: "Dismiss",
          detail: true,
        },
      ],
    }),
  ),
  {
    story: "outlook-read-sign-in",
    chips: [
      {
        kind: "outlook.thread",
        state: "attention",
        tone: "warning",
        origin: "ambient",
        name: `${subject} Sign in to load email Needs your choice.`,
        control: "Leave out the email",
        detail: true,
      },
    ],
  },
  {
    story: "outlook-read-follow-up",
    chips: [
      {
        kind: "outlook.thread",
        state: "suggested",
        tone: "neutral",
        origin: "ambient",
        name: `${subject} Not included on follow-up messages Not included.`,
        control: "Include the email",
        detail: true,
      },
    ],
  },
  {
    story: "outlook-read-drops",
    chips: [
      threadIncluded(),
      included(
        "outlook.droppedEmail",
        "Re: Offsite agenda",
        "Lena Hoffmann • 10/7/2026 · 2/2 attachments",
        "Remove Re: Offsite agenda",
        "user",
      ),
      included(
        "outlook.droppedEmail",
        "Budget 2027 draft",
        "Jonas Weber • 10/12/2026 · 3/3 attachments",
        "Remove Budget 2027 draft",
        "user",
      ),
    ],
  },
  {
    story: "outlook-read-dropping",
    chips: [
      threadIncluded(),
      {
        kind: "outlook.dropProgress",
        state: "loading",
        tone: "neutral",
        origin: "user",
        locked: true,
        name: "Reading email 1 of 2… Loading. Locked.",
        control: null,
        detail: false,
      },
    ],
  },
  {
    story: "outlook-compose-draft",
    chips: [draftIncluded, contract, pricing],
  },
  {
    story: "outlook-compose-unchanged",
    chips: [
      {
        kind: "outlook.draft",
        state: "superseded",
        tone: "neutral",
        origin: "ambient",
        name: "Your draft Unchanged, not re-sent Not sent.",
        control: "Don't include draft",
        detail: true,
      },
      attachment("contract-v3.pdf", "Sent earlier, not re-sent", "superseded"),
      attachment("pricing.xlsx", "Sent earlier, not re-sent", "superseded"),
    ],
  },
  {
    story: "outlook-compose-dismissed",
    chips: [
      {
        kind: "outlook.draft",
        state: "suggested",
        tone: "neutral",
        origin: "ambient",
        name: "Your draft Off until you switch mail items Not included.",
        control: "Include draft",
        detail: true,
      },
      contract,
      pricing,
    ],
  },
  {
    story: "outlook-compose-scheduling",
    chips: [
      {
        kind: "outlook.draft",
        state: "superseded",
        tone: "neutral",
        origin: "ambient",
        name: "Your draft Not sent while scheduling Not sent.",
        control: "Don't include draft",
        detail: true,
      },
      contract,
      pricing,
    ],
  },
  {
    story: "outlook-compose-attachments",
    chips: [
      draftIncluded,
      included(
        "outlook.draftAttachments",
        "Draft attachments (3)",
        "3 of 3 · 738 KB",
        "Don't include draft attachments",
      ),
    ],
  },
  {
    story: "outlook-compose-selection",
    chips: [
      included(
        "outlook.selection",
        "“Could you confirm the delivery date by Friday?”",
        "Replaces draft",
        "Dismiss selection",
      ),
      {
        kind: "outlook.draft",
        state: "superseded",
        tone: "neutral",
        origin: "ambient",
        name: "Your draft Replaced by selection Not sent.",
        control: "Don't include draft",
        detail: true,
      },
      contract,
      pricing,
    ],
  },
  {
    story: "teams-transcript",
    chips: [
      included(
        "teams.transcript",
        "Product sync +2",
        "3 conversations · 240 messages",
        "Remove Teams transcript",
        "user",
      ),
    ],
  },
  {
    story: "teams-with-files",
    chips: [
      included(
        "teams.transcript",
        "Product sync +1",
        "2 conversations · 124 messages",
        "Remove Teams transcript",
        "user",
      ),
    ],
    files: 3,
  },
  {
    story: "teams-preparing",
    chips: [
      {
        kind: "teams.transcript",
        state: "loading",
        tone: "neutral",
        origin: "user",
        locked: true,
        name: "Product sync +1 Preparing transcript… Loading. Locked.",
        control: "Remove Teams transcript",
        detail: true,
      },
    ],
  },
];

const openHost = (
  page: Page,
  story: string,
  options: { theme?: "light" | "dark"; width?: number } = {},
) => openStory(page, `${HOSTS}--${story}`, LANE, options);

/** Every chip in the lane box, at its token height, with no page overflow and nothing folded. */
const expectFits = async (page: Page, width: number, story: string) => {
  const area = await boxOf(page.locator(AREA));
  const lane = await boxOf(page.locator(LANE));
  for (const item of await page.locator(CHIP).all()) {
    const box = await boxOf(item);
    expect(box.height, story).toBeCloseTo(54, 0);
    expect(box.x + box.width, story).toBeLessThanOrEqual(
      lane.x + lane.width + 0.5,
    );
    expect(box.y, story).toBeGreaterThanOrEqual(area.y - 0.5);
    expect(box.y + box.height, story).toBeLessThanOrEqual(
      area.y + area.height + 0.5,
    );
  }
  await expect(page.locator('[data-ui="composer-context-more"]')).toHaveCount(
    0,
  );
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

test.describe("host scenarios match the prototype", () => {
  for (const scenario of SCENARIOS) {
    test(scenario.story, async ({ page }) => {
      await openHost(page, scenario.story);
      const chips = page.locator(CHIP);
      await expect(chips).toHaveCount(scenario.chips.length);

      for (const [index, expected] of scenario.chips.entries()) {
        const item = chips.nth(index);
        await expect(item).toHaveAttribute("data-kind", expected.kind);
        await expect(item).toHaveAttribute("data-state", expected.state);
        await expect(item).toHaveAttribute("data-tone", expected.tone);
        await expect(item).toHaveAttribute("data-origin", expected.origin);
        if (expected.locked) {
          await expect(item).toHaveAttribute("data-locked", "true");
        } else {
          await expect(item).not.toHaveAttribute("data-locked");
        }
        const open = item.locator(OPEN);
        await expect(open).toHaveAccessibleName(expected.name);
        if (expected.detail) {
          await expect(open).toHaveAttribute("aria-haspopup", "dialog");
        } else {
          await expect(open).not.toHaveAttribute("aria-haspopup");
        }

        const control = item.locator(
          '[data-ui="composer-context-remove"], [data-ui="composer-context-restore"]',
        );
        if (expected.control === null) {
          await expect(control).toHaveCount(0);
          continue;
        }
        await expect(control).toHaveAccessibleName(expected.control);
        await expect(control).toHaveAttribute(
          "data-ui",
          expected.state === "suggested"
            ? "composer-context-restore"
            : "composer-context-remove",
        );
        await expect(control).toBeVisible();
        if (expected.locked) {
          await expect(control).toBeDisabled();
        } else {
          await expect(control).toBeEnabled();
        }
        const box = await boxOf(control);
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }

      await expectFits(page, 340, scenario.story);

      const tiles = page.locator(`${AREA} [data-ui="attachment-tile"]`);
      await expect(tiles).toHaveCount(scenario.files ?? 0);
      for (const tile of await tiles.all()) {
        expect((await boxOf(tile)).height).toBeCloseTo(54, 0);
      }

      // Hosts opt in, so both notice regions are mounted even when empty,
      // and keep their roles whatever the tone.
      const notice = page.locator('[data-ui="composer-notice"]');
      await expect(notice).toHaveCount(1);
      await expect(
        notice.locator('[data-ui="composer-notice-polite"]'),
      ).toHaveAttribute("role", "status");
      await expect(
        notice.locator('[data-ui="composer-notice-assertive"]'),
      ).toHaveAttribute("role", "alert");
      if (scenario.notice) {
        await expect(
          notice.locator(`[role="${scenario.notice}"] [data-ui="alert"]`),
        ).toBeVisible();
      } else {
        await expect(notice.locator('[data-ui="alert"]')).toHaveCount(0);
      }

      for (const { text, ratio } of await ratiosOf(page)) {
        expect(ratio, text).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("every scenario fits the 480 px breakpoint too", async ({ page }) => {
    for (const { story } of SCENARIOS) {
      await openHost(page, story, { width: 480 });
      await expectFits(page, 480, story);
    }
  });

  test("every scenario reads at 4.5:1 in dark", async ({ page }) => {
    for (const { story } of SCENARIOS) {
      await openHost(page, story, { theme: "dark" });
      for (const { text, ratio } of await ratiosOf(page)) {
        expect(ratio, `${story}: ${text}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

test.describe("host flows", () => {
  test("Word: (x) on an error leaves the document off in this chat, + reads it again", async ({
    page,
  }) => {
    await openHost(page, "word-error");
    const doc = chip(page, docName);
    await openButton(page, docName).focus();
    await page.keyboard.press("Delete");
    await expect(doc).toHaveAttribute("data-state", "suggested");
    await expect(openButton(page, docName)).toHaveAccessibleName(
      `${docName} Off in this chat Not included.`,
    );
    await expect(
      doc.locator('[data-ui="composer-context-restore"]'),
    ).toHaveAccessibleName("Include this document");
    await expect(live(page)).toHaveText(
      "Document removed. Include again with +",
    );
    await expect(openButton(page, docName)).toBeFocused();

    await page.keyboard.press("+");
    await expect(doc).toHaveAttribute("data-state", "loading");
    await expect(doc).toHaveAttribute("data-state", "included");
    await expect(openButton(page, docName)).toHaveAccessibleName(
      `${docName} 86 ¶ · 12 comments Included.`,
    );
    await expect(live(page)).toHaveText("Document included.");
    await expect(openButton(page, docName)).toBeFocused();
  });

  test("Word: a + that fails again says so", async ({ page }) => {
    await openHost(page, "word-error-again");
    const doc = chip(page, docName);
    await openButton(page, docName).focus();
    await page.keyboard.press("Delete");
    await expect(doc).toHaveAttribute("data-state", "suggested");
    await page.keyboard.press("+");
    await expect(doc).toHaveAttribute("data-state", "loading");
    await expect(doc).toHaveAttribute("data-state", "error");
    await expect(live(page)).toHaveText("Document: Couldn't read the document");
    await expect(openButton(page, docName)).toBeFocused();
    await expect(
      doc.locator('[data-ui="composer-context-remove"]'),
    ).toHaveAccessibleName("Dismiss");
  });

  test("Word: dismissing the selection gives the document back", async ({
    page,
  }) => {
    await openHost(page, "word-selection");
    const doc = chip(page, docName);
    await expect(doc).toHaveAttribute("data-state", "superseded");
    await openButton(page, quote).focus();
    await page.keyboard.press("Delete");
    await expect(chip(page, quote)).toHaveAttribute("data-state", "suggested");
    await expect(doc).toHaveAttribute("data-state", "included");
    await expect(openButton(page, docName)).toHaveAccessibleName(
      `${docName} 86 ¶ · 12 comments Included.`,
    );
    await expect(live(page)).toHaveText(
      "Selection removed. Include again with +",
    );

    await page.keyboard.press("+");
    await expect(chip(page, quote)).toHaveAttribute("data-state", "included");
    await expect(doc).toHaveAttribute("data-state", "superseded");
    await expect(live(page)).toHaveText("Selection included.");
  });

  test("Outlook: (x) on an error offers + to load the email again", async ({
    page,
  }) => {
    await openHost(page, "outlook-read-error");
    const thread = chip(page, subject);
    await openButton(page, subject).focus();
    await page.keyboard.press("Delete");
    await expect(thread).toHaveAttribute("data-state", "suggested");
    await expect(openButton(page, subject)).toHaveAccessibleName(
      `${subject} Off until you switch mail items Not included.`,
    );
    const retry = thread.locator('[data-ui="composer-context-restore"]');
    await expect(retry).toHaveAccessibleName("Try loading the email again");

    await retry.click();
    await expect(thread).toHaveAttribute("data-state", "loading");
    await expect(thread).toHaveAttribute("data-state", "included");
    await expect(live(page)).toHaveText("Email thread included.");
  });

  test("Outlook: a retry that fails again says so", async ({ page }) => {
    await openHost(page, "outlook-read-error-again");
    const thread = chip(page, subject);
    await openButton(page, subject).focus();
    await page.keyboard.press("Delete");
    await expect(thread).toHaveAttribute("data-state", "suggested");
    await thread.locator('[data-ui="composer-context-restore"]').click();
    await expect(thread).toHaveAttribute("data-state", "loading");
    await expect(thread).toHaveAttribute("data-state", "error");
    await expect(live(page)).toHaveText(
      "Email thread: Couldn't load the email thread",
    );
  });

  test("hosts word their own removals; the lane states the lifetime", async ({
    page,
  }) => {
    await openHost(page, "word-busy");
    const comment = chip(page, "Comment by Maya Krüger");
    await openButton(page, "Comment by Maya Krüger").focus();
    await page.keyboard.press("Delete");
    await expect(comment).toHaveAttribute("data-state", "suggested");
    await expect(live(page)).toHaveText(
      "Comments removed for this message. Include again with +",
    );
    await expect(
      openButton(page, "Comment by Maya Krüger"),
    ).toHaveAccessibleName(
      "Comment by Maya Krüger Off for this message Not included.",
    );
    await expect(
      comment.locator('[data-ui="composer-context-restore"]'),
    ).toHaveAccessibleName("Include comments");

    await openHost(page, "outlook-compose-draft");
    await openButton(page, "Your draft").focus();
    await page.keyboard.press("Backspace");
    await expect(chip(page, "Your draft")).toHaveAttribute(
      "data-state",
      "suggested",
    );
    await expect(live(page)).toHaveText("Draft removed. Include again with +");
    await expect(openButton(page, "Your draft")).toHaveAccessibleName(
      "Your draft Off until you switch mail items Not included.",
    );
  });

  test("a suggested chip says how to include it, and + does", async ({
    page,
  }) => {
    await openHost(page, "outlook-read-follow-up");
    const thread = chip(page, subject);
    await openButton(page, subject).focus();
    await page.keyboard.press("Delete");
    await expect(live(page)).toHaveText(
      "Email thread is not included. Press + to include it.",
    );
    await expect(thread).toHaveAttribute("data-state", "suggested");
    await page.keyboard.press("+");
    await expect(thread).toHaveAttribute("data-state", "included");
    await expect(live(page)).toHaveText("Email thread included.");
  });

  test("locked chips say why, with or without a control", async ({ page }) => {
    await openHost(page, "teams-preparing");
    const transcript = chip(page, "Product sync +1");
    await expect(
      transcript.locator('[data-ui="composer-context-remove"]'),
    ).toHaveAttribute("title", "Wait until the transcript is ready");
    await openButton(page, "Product sync +1").focus();
    await page.keyboard.press("Delete");
    await expect(live(page)).toHaveText("Wait until the transcript is ready");
    await expect(transcript).toHaveAttribute("data-state", "loading");

    await openHost(page, "outlook-read-dropping");
    await openButton(page, "Reading email 1 of 2…").focus();
    await page.keyboard.press("Delete");
    await expect(live(page)).toHaveText("Wait until the emails are added");
    await expect(chip(page, "Reading email 1 of 2…")).toHaveCount(1);
  });

  test("removing the last chip hands focus to the message box", async ({
    page,
  }) => {
    await openHost(page, "teams-with-files");
    await openButton(page, "Product sync +1").focus();
    await page.keyboard.press("Delete");
    await expect(chip(page, "Product sync +1")).toHaveCount(0);
    await expect(live(page)).toHaveText("Teams transcript removed.");
    await expect(page.getByPlaceholder("Type a message...")).toBeFocused();
    // The files the transcript sat beside stay staged.
    await expect(
      page.locator(`${AREA} [data-ui="attachment-tile"]`),
    ).toHaveCount(3);
  });
});
