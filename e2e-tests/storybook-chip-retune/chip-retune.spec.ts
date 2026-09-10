import { expect, test, type Page } from "@playwright/test";

// The attachment chip takes its corner from `--attachment-tile-radius`, which
// it reads and never declares — only a frame around it declares it. jsdom
// loads no CSS, so the unit suites can only assert the rule text; this is the
// measurement that a declaration on the chip would break. It has to be a pair:
// a default on `.attachment-tile-geometry` shadows what the card declares, so
// a chip standing on its own still lands on exactly the corner it should have
// and the outside case below stays green — only the inside one drops to the
// base corner and catches it. Neither half means anything alone.

const TILE = '[data-ui="attachment-tile"]';
const ICON = '[data-ui="attachment-tile-icon"]';
const BADGE = '[data-ui="attachment-remove"]';
const CARD = '[data-ui="thread-message-card"]';
const GROUP = '[data-ui="attachment-group"]';
const THEME_LINK = 'link[data-theme-styles="true"]';

// The pack under test: `themes/open-webui-like/theme.css:97-100` declares
// `--attachment-tile-radius: var(--theme-radius-pill)` on the thread card, and
// theme.json puts `radius.pill` at 9999px and `radius.base` at 0.75rem.
const THEME = "open-webui-like";
const PILL = "9999px";
const BASE = "12px";
// The chips inside a thread card also get `padding-inline: 1rem` from the same
// stylesheet, and nothing else in the app sets it. It is the one measurement
// that separates "the retune did not reach the chip" from "the theme never
// loaded", which otherwise both read as the base corner.
const THEME_ONLY_PADDING = "16px";

const openStory = async (page: Page, story: string, ready: string) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`/iframe.html?id=${story}&viewMode=story`);
  // The first request compiles the story bundle; later ones are instant.
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 60_000 });

  const href = await page.locator(THEME_LINK).getAttribute("href");
  expect(
    href,
    `no customer stylesheet — start Storybook with VITE_CUSTOMER_NAME=${THEME} and copy the pack in, see README.md`,
  ).toContain(`${THEME}/theme.css`);
};

const styleOf = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (el, name) => getComputedStyle(el).getPropertyValue(name),
      property,
    );

const radiusOf = (page: Page, selector: string) =>
  styleOf(page, selector, "border-radius");

test.describe("attachment chip under the open-webui-like retune", () => {
  test("a chip inside a thread card takes the card's pill corner", async ({
    page,
  }) => {
    await openStory(
      page,
      "ui-groupedfileattachmentspreview--sticky-thread",
      `${CARD} ${TILE}`,
    );

    expect(await styleOf(page, `${CARD} ${TILE}`, "padding-inline-start")).toBe(
      THEME_ONLY_PADDING,
    );

    const tile = await radiusOf(page, `${CARD} ${TILE}`);
    console.log(`inside a thread card: chip ${tile}`);
    expect(tile).toBe(PILL);

    // The icon plate derives from the chip corner, so the retune reaches it
    // through two hops without naming it. At a pill corner the derivation
    // lands far past half the plate, which is what makes it a circle.
    const plate = page.locator(`${CARD} ${ICON}`).first();
    const icon = await radiusOf(page, `${CARD} ${ICON}`);
    const box = await plate.boundingBox();
    console.log(`inside a thread card: icon plate ${icon} on ${box?.width}px`);
    expect(parseFloat(icon)).toBeGreaterThanOrEqual((box?.width ?? 0) / 2);
  });

  test("the same chip outside one stays on the base corner", async ({
    page,
  }) => {
    // Not a bare chip: these sit in the attachment group frame, which declares
    // its own `--card-radius` and no tile corner. So this also says the frame
    // above the thread card does not leak one.
    await openStory(
      page,
      "ui-groupedfileattachmentspreview--collapsed",
      `${GROUP} ${TILE}`,
    );

    const tile = await radiusOf(page, `${GROUP} ${TILE}`);
    console.log(`inside the group frame only: chip ${tile}`);
    expect(tile).not.toBe(PILL);
    expect(tile).toBe(BASE);

    expect(await radiusOf(page, `${GROUP} ${ICON}`)).toBe(BASE);
  });

  test("the remove badge stays a circle a pill radius cannot reach", async ({
    page,
  }) => {
    await openStory(page, "ui-attachmenttile--composer-compact", TILE);

    expect(await radiusOf(page, TILE)).toBe(BASE);
    expect(await radiusOf(page, BADGE)).toBe("50%");
  });
});
