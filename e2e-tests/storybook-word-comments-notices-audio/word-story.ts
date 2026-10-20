import { readFileSync } from "node:fs";

import { expect, type Locator, type Page } from "@playwright/test";

import {
  boxOf,
  CHIP,
  contrastOf,
  LANE,
  OPEN,
  openStory,
} from "../storybook-composer-context-lane/lane-helpers";

// What every `Chat/ComposerContextWordComments` story draws, and where each
// gesture leads, as the add-in's own resolvers wrote it
// (office-addin/src/word/utils/__tests__/wordCommentStoryParity.test.ts).

export interface Note {
  tone: "info" | "warning" | "error";
  text: string;
}
export interface Coverage {
  heading: string;
  lines: string[];
}
export interface ItemData {
  id: string;
  kind: string;
  origin: "ambient" | "user";
  placement?: "ambient" | "user";
  dismissScope?: "message" | "selection" | "item" | "chat";
  state: string;
  tone?: "warning" | "error";
  label: string;
  meta?: string;
  locked?: boolean;
  lockReason?: string;
  removeLabel?: string;
  removeActionLabel?: string;
  restoreLabel?: string;
  announcements?: { removed?: string; restored?: string };
  remove: boolean;
  restore: boolean;
  detail: {
    title: string;
    actions: { id: string; label: string; announcement?: string }[];
    body: {
      kind: "selection" | "document" | "comment" | "openComments";
      variant?: string;
      why?: string | null;
      thread?: string | null;
      choices?: string[];
      intro?: string;
      notes: Note[];
      coverage: Coverage | null;
      comments?: unknown;
      lifetime: string;
    };
  };
}
export interface NoticeData {
  id: string;
  tone: "info" | "warning" | "error";
  text: string;
  busy?: boolean;
  progressLabel?: string;
  actions: { id: string; label: string }[];
  dismissible: boolean;
}
interface StoryData {
  strings: Record<string, string>;
  threads: Record<
    string,
    {
      author: string;
      title: string;
      status: string;
      activity?: string;
      replies?: string;
      text: string;
      quote: string;
      chosen: string;
    }
  >;
  stories: Record<string, { id: string; start: string; pickable: string[] }>;
  states: Record<
    string,
    {
      items: string[];
      notice: NoticeData | null;
      send: { carrier: string; block?: string };
    }
  >;
  items: Record<string, ItemData>;
  transitions: Record<
    string,
    Record<string, { to: string; announce?: string } | undefined> | undefined
  >;
}

export const DATA = JSON.parse(
  readFileSync(
    new URL(
      "../../frontend/src/stories/chat/composerContextWordComments.generated.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as StoryData;

export const SHELL = '[data-ui="chat-input-shell"]';
export const NOTICE = '[data-ui="composer-notice"]';
export const WORD_LIVE = '[data-testid="word-composer-announcer"]';

export const STATE_WORD: Record<string, string> = {
  included: "Included.",
  suggested: "Not included.",
  superseded: "Not sent.",
  loading: "Loading.",
  error: "Error.",
  attention: "Needs your choice.",
};

// The lane's own meta for a suggested ambient chip the host gives none.
const SCOPE_META: Record<string, string> = {
  message: "Off for this message",
  selection: "Off until the selection changes",
  item: "Off until you switch mail items",
  chat: "Off in this chat",
};

export const storyNames = () => Object.keys(DATA.stories);

/** Where a story is after these gestures, as the add-in's resolvers took it. */
export function stateAfter(story: string, gestures: string[] = []): string {
  let key = DATA.stories[story].start;
  for (const gesture of gestures) {
    const next = DATA.transitions[key]?.[gesture];
    if (!next) throw new Error(`${story}: no ${gesture} from ${key}`);
    key = next.to;
  }
  return key;
}

/** The chips in lane order: ambient first, then the user's, each where its placement puts it. */
export const laneItems = (stateKey: string): ItemData[] => {
  const items = DATA.states[stateKey].items.map((key) => DATA.items[key]);
  const group = (item: ItemData) => item.placement ?? item.origin;
  return [
    ...items.filter((item) => group(item) === "ambient"),
    ...items.filter((item) => group(item) === "user"),
  ];
};
export const noticeOf = (stateKey: string) => DATA.states[stateKey].notice;
export const itemOf = (stateKey: string, kind: string) => {
  const item = laneItems(stateKey).find((entry) => entry.kind === kind);
  if (!item) throw new Error(`no ${kind} in ${stateKey}`);
  return item;
};

export const shownMeta = (item: ItemData): string | null =>
  item.meta ??
  (item.state === "suggested" && item.origin === "ambient" && item.dismissScope
    ? SCOPE_META[item.dismissScope]
    : null);
export const controlName = (item: ItemData): string | null =>
  item.state === "suggested"
    ? item.restore
      ? (item.restoreLabel ?? null)
      : null
    : item.remove
      ? (item.removeLabel ?? null)
      : null;

export const openWord = (
  page: Page,
  story: string,
  options: { theme?: "light" | "dark"; width?: number; locale?: string } = {},
) => openStory(page, DATA.stories[story].id, SHELL, options);

export const kind = (page: Page, name: string) =>
  page.locator(`${CHIP}[data-kind="${name}"]`);
export const open = (chip: Locator) => chip.locator(OPEN);
export const metaOf = (chip: Locator) =>
  chip.locator('[data-ui="composer-context-chip-meta"]');
export const labelOf = (chip: Locator) =>
  chip.locator('[data-ui="composer-context-chip-label"]');
export const control = (chip: Locator) =>
  chip.locator(
    '[data-ui="composer-context-remove"], [data-ui="composer-context-restore"]',
  );
export const style = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
export const textarea = (page: Page) => page.locator(`${SHELL} textarea`);
export const wordLive = (page: Page) => page.locator(WORD_LIVE);

export const expectChip = async (
  chip: Locator,
  item: ItemData,
  label: string,
) => {
  const meta = shownMeta(item);
  await expect(chip, label).toHaveAttribute("data-kind", item.kind);
  await expect(chip, label).toHaveAttribute("data-state", item.state);
  await expect(chip, label).toHaveAttribute("data-origin", item.origin);
  if (item.tone) {
    await expect(chip, label).toHaveAttribute("data-tone", item.tone);
  }
  await expect(labelOf(chip), label).toHaveText(item.label);
  if (meta === null) await expect(metaOf(chip), label).toHaveCount(0);
  else await expect(metaOf(chip), label).toHaveText(meta);
  await expect(open(chip), label).toHaveAccessibleName(
    [item.label, meta, STATE_WORD[item.state]]
      .filter((part) => part !== null)
      .concat(item.locked ? ["Locked."] : [])
      .join(" "),
  );
  const name = controlName(item);
  const button = control(chip);
  if (name === null) await expect(button, label).toHaveCount(0);
  else await expect(button, label).toHaveAccessibleName(name);
  if (item.locked && name !== null) {
    await expect(button, label).toBeDisabled();
    await expect(button, label).toHaveAttribute("title", item.lockReason!);
  }
};

export const expectLane = async (
  page: Page,
  stateKey: string,
  label: string,
) => {
  const items = laneItems(stateKey);
  const chips = page.locator(CHIP);
  await expect(chips, label).toHaveCount(items.length);
  for (const [index, item] of items.entries()) {
    await expectChip(chips.nth(index), item, label);
  }
};

/** Chips at their token height inside the lane, controls inside their chip, no page overflow. */
export const expectFits = async (page: Page, width: number, label: string) => {
  if ((await page.locator(CHIP).count()) > 0) {
    const lane = await boxOf(page.locator(LANE));
    for (const item of await page.locator(CHIP).all()) {
      const box = await boxOf(item);
      expect(box.height, label).toBeCloseTo(32, 0);
      expect(box.x, label).toBeGreaterThanOrEqual(lane.x - 0.5);
      expect(box.x + box.width, label).toBeLessThanOrEqual(
        lane.x + lane.width + 0.5,
      );
      const button = control(item);
      if ((await button.count()) > 0) {
        const inner = await boxOf(button);
        expect(inner.x, label).toBeGreaterThanOrEqual(box.x - 0.5);
        expect(inner.x + inner.width, label).toBeLessThanOrEqual(
          box.x + box.width + 0.5,
        );
      }
      for (const part of ["label", "meta"]) {
        const text = item.locator(`[data-ui="composer-context-chip-${part}"]`);
        if ((await text.count()) === 0) continue;
        expect(await style(text, "text-overflow"), label).toBe("ellipsis");
      }
    }
  }
  expect(
    await page.evaluate(() => document.scrollingElement!.scrollWidth),
    label,
  ).toBeLessThanOrEqual(width);
};

export const ratiosOf = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements, measure) => {
    const contrast = new Function(`return (${measure})`)() as (
      element: Element,
    ) => number;
    return elements.map((element) => ({
      text: element.textContent ?? "",
      ratio: contrast(element),
    }));
  }, contrastOf.toString());

export const CHIP_TEXT = `${CHIP} [data-ui="composer-context-chip-label"], ${CHIP} [data-ui="composer-context-chip-meta"]`;

/** Text a screen reader gets from an element: aria-hidden parts left out. */
export const spokenText = (locator: Locator) =>
  locator.evaluate((element) => {
    const copy = element.cloneNode(true) as Element;
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"]'))
      hidden.remove();
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  });

/** Marks a chip so a later check can tell whether the lane kept the same element. */
export const tagElement = (locator: Locator, tag: string) =>
  locator.evaluate((element, name) => {
    (window as unknown as Record<string, Element>)[name] = element;
  }, tag);
export const isTagged = (locator: Locator, tag: string) =>
  locator.evaluate(
    (element, name) =>
      (window as unknown as Record<string, Element>)[name] === element &&
      element.isConnected,
    tag,
  );
