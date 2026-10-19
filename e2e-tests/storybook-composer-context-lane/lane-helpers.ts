import { expect, type Locator, type Page } from "@playwright/test";

export const LANE = '[data-ui="composer-context-lane"]';
export const CHIP = '[data-ui="composer-context-chip"]';
export const OPEN = '[data-ui="composer-context-chip-open"]';
export const AREA = '[data-ui="composer-staged-area"]';
export const LIVE = '[data-ui="composer-context-live"]';
export const STORY = "chat-composercontextlane";

export const openStory = async (
  page: Page,
  story: string,
  ready: string,
  {
    theme = "light",
    width = 340,
    locale,
  }: { theme?: "light" | "dark"; width?: number; locale?: string } = {},
) => {
  await page.setViewportSize({ width, height: 800 });
  const globals = [`theme:${theme}`, ...(locale ? [`locale:${locale}`] : [])];
  await page.goto(
    `/iframe.html?id=${story}&viewMode=story&globals=${globals.join(";")}`,
  );
  // The first request compiles the story bundle; later ones are instant.
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 60_000 });
};

export const chip = (page: Page, label: string) =>
  page.locator(CHIP).filter({
    has: page.locator('[data-ui="composer-context-chip-label"]', {
      hasText: label,
    }),
  });

export const openButton = (page: Page, label: string) =>
  chip(page, label).locator(OPEN);

export const live = (page: Page) => page.locator(LIVE).first();

// WCAG contrast of an element's text on the first opaque fill behind it.
export const contrastOf = (element: Element) => {
  const parse = (color: string) => {
    const [r, g, b, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
    return { r, g, b, a };
  };
  let fill = { r: 255, g: 255, b: 255, a: 1 };
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = parse(getComputedStyle(node).backgroundColor);
    if (color.a > 0) {
      fill = color;
      break;
    }
  }
  const text = parse(getComputedStyle(element).color);
  const mix = (channel: "r" | "g" | "b") =>
    text[channel] * text.a + fill[channel] * (1 - text.a);
  const luminance = (r: number, g: number, b: number) => {
    const linear = (value: number) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const foreground = luminance(mix("r"), mix("g"), mix("b"));
  const background = luminance(fill.r, fill.g, fill.b);
  return (
    (Math.max(foreground, background) + 0.05) /
    (Math.min(foreground, background) + 0.05)
  );
};

/** A token as the element would paint it, resolved through a probe. */
export const tokenColor = (locator: Locator, token: string) =>
  locator.evaluate((element, name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    element.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);

export const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return box;
};
