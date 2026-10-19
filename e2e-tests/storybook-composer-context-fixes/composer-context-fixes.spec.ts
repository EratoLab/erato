import { expect, test, type Page } from "@playwright/test";

// Measurements only, no pixel snapshots: jsdom has no layout, so geometry,
// focus order and image loading are checked here.

const GROUP = '[data-ui="attachment-group"]';
const HEADER_ACTIONS = '[data-ui="attachment-group-header-actions"]';
const CARD = '[data-ui="thread-message-card"]';

const openStory = async (page: Page, story: string, ready: string) => {
  // The task pane's width, where a pinned action has the least room.
  await page.setViewportSize({ width: 340, height: 800 });
  await page.goto(`/iframe.html?id=${story}&viewMode=story`);
  // The first request compiles the story bundle; later ones are instant.
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 60_000 });
};

const boxOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box;
};

test.describe("pinned group action", () => {
  const removeName = "Remove Re: Offsite agenda";

  test("stays reachable beside the collapsed disclosure", async ({ page }) => {
    await openStory(
      page,
      "ui-groupedfileattachmentspreview--pinned-group-action",
      HEADER_ACTIONS,
    );
    const toggle = page.locator(`${GROUP} button[aria-expanded]`).first();
    const remove = page.getByRole("button", { name: removeName });

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(remove).toBeVisible();
    expect(
      await toggle.evaluate(
        (button, name) =>
          [...button.querySelectorAll("button")].some(
            (inner) => inner.getAttribute("aria-label") === name,
          ),
        removeName,
      ),
    ).toBe(false);

    const header = await page
      .locator(HEADER_ACTIONS)
      .evaluate((actions) =>
        actions.parentElement!.getBoundingClientRect().toJSON(),
      );
    const card = await boxOf(page, GROUP);
    const button = await remove.boundingBox();
    if (!button) throw new Error("Remove has no box");
    expect(button.y).toBeGreaterThanOrEqual(header.top - 0.5);
    expect(button.y + button.height).toBeLessThanOrEqual(header.bottom + 0.5);
    expect(button.x + button.width).toBeLessThanOrEqual(
      card.x + card.width + 0.5,
    );
    // WCAG 2.5.8 target size.
    expect(button.height).toBeGreaterThanOrEqual(24);

    await toggle.focus();
    await page.keyboard.press("Tab");
    await expect(remove).toBeFocused();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: removeName })).toHaveCount(1);
  });

  test("keeps Remove whole beside a long subject", async ({ page }) => {
    await openStory(
      page,
      "ui-groupedfileattachmentspreview--pinned-group-action-long-subject",
      HEADER_ACTIONS,
    );
    const title = page.locator(`${GROUP} h3`).first();
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    );

    const remove = page.locator(`${HEADER_ACTIONS} button`);
    await expect(remove).toBeVisible();
    const card = await boxOf(page, GROUP);
    const button = await remove.boundingBox();
    if (!button) throw new Error("Remove has no box");
    expect(button.x).toBeGreaterThanOrEqual(card.x);
    expect(button.x + button.width).toBeLessThanOrEqual(
      card.x + card.width + 0.5,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});

test("an unticked thread message reads its attachments unticked", async ({
  page,
}) => {
  await openStory(
    page,
    "ui-groupedfileattachmentspreview--thread-message-unticked",
    CARD,
  );
  const card = page.locator(CARD).first();
  const boxes = card.locator(
    '[data-ui="attachment-tile"] input[type="checkbox"]',
  );
  await expect(boxes).toHaveCount(2);
  for (const box of await boxes.all()) {
    await expect(box).not.toBeChecked();
    // Faded once by the row, never again by the card around it.
    expect(
      await box.evaluate((el) => {
        let opacity = 1;
        for (let node: Element | null = el; node; node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity);
        }
        return Math.round(opacity * 100) / 100;
      }),
    ).toBe(0.5);
  }
  expect(await card.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  expect(
    await card
      .locator('[data-ui="card-header"] > div')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("0.6");
});

test("a display-named image upload draws as a thumbnail and an image row", async ({
  page,
}) => {
  const thumbnail = '[data-filetype="image"] img[data-ui="attachment-tile"]';
  await openStory(
    page,
    "ui-groupedfileattachmentspreview--display-named-image",
    thumbnail,
  );

  const image = page.locator(thumbnail).first();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  const expected = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.width =
      "var(--theme-layout-attachment-tile-compact-media-size)";
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
  expect(expected).toBeGreaterThan(0);
  expect((await image.boundingBox())?.width).toBeCloseTo(expected, 0);

  const row = page.locator(`${CARD} [data-filetype="image"]`).first();
  await expect(row).toBeVisible();
  await expect(row.locator("img")).toHaveCount(0);
});

test("the staged count reads files shown elsewhere", async ({ page }) => {
  await openStory(
    page,
    "ui-fileattachmentspreview--counts-files-shown-elsewhere",
    '[data-ui="attachment-tile"]',
  );

  await expect(page.getByText("5/5", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove all attachments" }),
  ).toBeVisible();
});

test("stacked dialogs are each named by their own title", async ({ page }) => {
  await openStory(page, "ui-modal-modalbase--stacked", '[role="dialog"]');

  const dialogs = page.locator('[role="dialog"]');
  await expect(dialogs).toHaveCount(2);
  const labelledBy = await dialogs.evaluateAll((elements) =>
    elements.map((el) => el.getAttribute("aria-labelledby")),
  );
  expect(new Set(labelledBy).size).toBe(2);
  // `useId` values hold characters an `#id` selector cannot take.
  const resolved = await page.evaluate(
    (ids) =>
      ids.map((id) => {
        const heading = id ? document.getElementById(id) : null;
        return heading ? heading.closest('[role="dialog"]') !== null : false;
      }),
    labelledBy,
  );
  expect(resolved).toEqual([true, true]);
  for (const name of ["Teams conversation", "Preview: dashboard.png"]) {
    await expect(page.getByRole("dialog", { name })).toHaveCount(1);
  }
  const duplicateIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);
});
