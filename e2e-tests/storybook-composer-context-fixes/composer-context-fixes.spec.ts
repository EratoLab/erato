import { expect, test, type Locator, type Page } from "@playwright/test";

// Measurements only, no pixel snapshots: jsdom has no layout, so geometry,
// focus order and image loading are checked here.

const GROUP = '[data-ui="attachment-group"]';
const HEADER_ACTIONS = '[data-ui="attachment-group-header-actions"]';
const CARD = '[data-ui="thread-message-card"]';

const openStory = async (
  page: Page,
  story: string,
  ready: string,
  theme: "light" | "dark" = "light",
) => {
  // The task pane's width, where a pinned action has the least room.
  await page.setViewportSize({ width: 340, height: 800 });
  await page.goto(
    `/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
  );
  // The first request compiles the story bundle; later ones are instant.
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 60_000 });
};

// WCAG contrast of an element's text on the first opaque fill behind it.
const contrastOf = (element: Element) => {
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

  test("draws its header divider only while expanded", async ({ page }) => {
    await openStory(
      page,
      "ui-groupedfileattachmentspreview--pinned-group-action",
      HEADER_ACTIONS,
    );
    // The disclosure is no longer the header, so the collapsed rule keyed on
    // its aria-expanded cannot reach this one.
    const header = page.locator(HEADER_ACTIONS).locator("..");
    const divider = () =>
      header.evaluate((el) => getComputedStyle(el).borderBottomWidth);
    expect(await divider()).toBe("0px");

    await page.locator(`${GROUP} button[aria-expanded]`).first().click();
    expect(await divider()).toBe("1px");
  });

  test("stays above the rows scrolling under it", async ({ page }) => {
    await openStory(
      page,
      "ui-groupedfileattachmentspreview--pinned-group-action-scrolled",
      HEADER_ACTIONS,
    );
    const remove = page.getByRole("button", { name: removeName });
    const before = await remove.boundingBox();
    if (!before) throw new Error("Remove has no box");

    const region = page.locator(".overflow-y-auto").first();
    await region.evaluate((el) => {
      el.scrollTop = 160;
    });
    expect(await region.evaluate((el) => el.scrollTop)).toBe(160);

    const after = await remove.boundingBox();
    if (!after) throw new Error("Remove has no box");
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
    const regionBox = await region.boundingBox();
    if (!regionBox) throw new Error("the scroll region has no box");
    expect(after.y).toBeGreaterThanOrEqual(regionBox.y - 0.5);
    // The sticky band paints over the rows, so a click lands on Remove.
    expect(
      await remove.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return hit !== null && button.contains(hit);
      }),
    ).toBe(true);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`reads at 4.5:1 on the header band in ${theme}`, async ({ page }) => {
      await openStory(
        page,
        "ui-groupedfileattachmentspreview--pinned-group-action",
        HEADER_ACTIONS,
        theme,
      );
      const ratio = await page
        .getByRole("button", { name: removeName })
        .evaluate(contrastOf);
      console.log(`pinned Remove in ${theme}: ${ratio.toFixed(2)}:1`);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
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

test("ticking one attachment brings back only that one", async ({ page }) => {
  await openStory(
    page,
    "ui-groupedfileattachmentspreview--thread-message-reticked-attachment",
    CARD,
  );
  const card = page.locator(CARD).first();
  await expect(card.locator('[data-ui="card-header"] input')).toBeChecked();
  expect(
    await card
      .locator('[data-ui="card-header"] > div')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("1");

  const rowOpacity = (box: Locator) =>
    box.evaluate((el) => {
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity);
      }
      return Math.round(opacity * 100) / 100;
    });
  const [ticked, sibling] = await card
    .locator('[data-ui="attachment-tile"] input[type="checkbox"]')
    .all();
  await expect(ticked).toBeChecked();
  expect(await rowOpacity(ticked)).toBe(1);
  await expect(sibling).not.toBeChecked();
  expect(await rowOpacity(sibling)).toBe(0.5);
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
  const removeAll = page.getByRole("button", {
    name: "Remove all attachments",
  });
  await expect(removeAll).toBeVisible();
  const box = await removeAll.boundingBox();
  if (!box) throw new Error("Remove all has no box");
  expect(box.height).toBeGreaterThanOrEqual(24);
  expect(box.x + box.width).toBeLessThanOrEqual(340);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
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

test("a confirmation over Preferences is named by its own title", async ({
  page,
}) => {
  // The web app's own stack: Archive all chats confirms inside Preferences.
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(
    "/iframe.html?id=ui-userpreferencesdialog--empty&viewMode=story",
  );
  const preferences = page.getByRole("dialog", { name: "Preferences" });
  await expect(preferences).toBeVisible({ timeout: 60_000 });

  await page.getByRole("tab", { name: "Data" }).click();
  await page.getByRole("button", { name: "Archive all chats" }).click();

  const confirm = page.getByRole("dialog", { name: "Archive all chats?" });
  await expect(confirm).toBeVisible();
  await expect(preferences).toHaveCount(1);
  await expect(page.locator('[role="dialog"]')).toHaveCount(2);

  await confirm.getByRole("button", { name: "Cancel action" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(preferences).toBeVisible();
});
