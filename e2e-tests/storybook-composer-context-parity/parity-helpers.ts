import { readFileSync } from "node:fs";

import { expect, type Locator, type Page } from "@playwright/test";

import {
  contrastOf,
  openStory,
} from "../storybook-composer-context-lane/lane-helpers";

// What every `Chat/ComposerContextParity` story sends and what its sent
// context is called, as the add-in's own resolvers and descriptors wrote it
// (office-addin/src/test/__tests__/sentWithStoryParity.test.ts).

export interface SentChip {
  id: string;
  kind: string;
  icon: string;
  label: string;
  meta?: string;
  spokenLabel?: string;
  quote?: string;
  labelIsExcerpt?: boolean;
}

interface FacetData {
  facet: { id: string; args: Record<string, string> };
  registered: boolean;
  chips: Record<string, SentChip[] | null>;
  estimateBytes: number;
}

interface StoryData {
  id: string;
  kind: "sent" | "edit";
  text: string;
  facet?: string;
  files?: string[];
  transcript?: {
    conversations: string[];
    pending?: boolean;
    unreadable?: boolean;
  };
  facetUnavailable?: boolean;
  kit?: boolean;
}

export const DATA = JSON.parse(
  readFileSync(
    new URL(
      "../../frontend/src/stories/chat/composerContextParity.generated.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  facets: Record<string, FacetData>;
  stories: Record<string, StoryData>;
};

export const PARITY = "chat-composercontextparity";

export const storiesOf = (kind: StoryData["kind"]) =>
  Object.entries(DATA.stories).filter(([, story]) => story.kind === kind);

export const story = (name: string) => {
  const found = DATA.stories[name];
  if (!found) throw new Error(`no story ${name} in the generated file`);
  return found;
};

/** The chips the add-in names a story's facet with, in a locale. */
export const chipsOf = (name: string, locale = "en"): SentChip[] => {
  const { facet } = story(name);
  if (!facet) return [];
  return DATA.facets[facet].chips[locale] ?? [];
};

export const openParity = (
  page: Page,
  name: string,
  ready: string,
  options: { theme?: "light" | "dark"; width?: number; locale?: string } = {},
) => openStory(page, story(name).id, ready, options);

export const style = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );

export const px = async (locator: Locator, property: string) =>
  Number.parseFloat(await style(locator, property));

/** A length token as an element would resolve it, through a probe. */
export const tokenLength = (
  locator: Locator,
  token: string,
  property: "border-top-left-radius" = "border-top-left-radius",
) =>
  locator.evaluate(
    (element, { name, prop }) => {
      const probe = document.createElement("span");
      probe.style.setProperty(prop, `var(${name})`);
      element.appendChild(probe);
      const value = getComputedStyle(probe).getPropertyValue(prop);
      probe.remove();
      return value;
    },
    { name: token, prop: property },
  );

/** A colour token as an element would paint it as a background, through a probe. */
export const tokenBackground = (locator: Locator, token: string) =>
  locator.evaluate((element, name) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `var(${name})`;
    element.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, token);

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

export const expectReadable = async (
  page: Page,
  selector: string,
  label: string,
) => {
  const ratios = await ratiosOf(page, selector);
  expect(ratios.length, label).toBeGreaterThan(0);
  for (const { text, ratio } of ratios) {
    expect(ratio, `${label}: "${text}"`).toBeGreaterThanOrEqual(4.5);
  }
};

export const noPageOverflow = async (page: Page, width: number) => {
  expect(
    await page.evaluate(() => document.scrollingElement!.scrollWidth),
  ).toBeLessThanOrEqual(width);
};

/** True when `a` comes before `b` in document order. */
export const precedes = async (a: Locator, b: Locator) => {
  const second = await b.elementHandle();
  return a.evaluate(
    (first, other) =>
      Boolean(
        other &&
          first.compareDocumentPosition(other) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    second,
  );
};
