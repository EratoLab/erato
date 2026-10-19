import { expect, test, type Locator } from "@playwright/test";

import {
  AREA,
  boxOf,
  chip,
  CHIP,
  contrastOf,
  LANE,
  live,
  LIVE,
  OPEN,
  openButton,
  openStory,
  STORY,
  tokenColor,
} from "./lane-helpers";

// Measurements only, no pixel snapshots: jsdom has no layout, so geometry,
// focus, scrolling and colour are checked here.

test.describe("semantics", () => {
  test("one named list, one tab stop, state words at the end of each name", async ({
    page,
  }) => {
    await openStory(page, `${STORY}--all-states`, LANE);
    const lane = page.getByRole("list", { name: "Message context" });
    await expect(lane).toHaveAttribute("data-ui", "composer-context-lane");
    await expect(lane.getByRole("listitem")).toHaveCount(8);
    expect(await lane.locator(`${OPEN}[tabindex="0"]`).count()).toBe(1);

    const names = await lane.locator(OPEN).evaluateAll((buttons) =>
      buttons.map((button) => ({
        state: button
          .closest('[data-ui="composer-context-chip"]')!
          .getAttribute("data-state"),
        text: (button.textContent ?? "").replace(/\s+/g, " ").trim(),
      })),
    );
    const word: Record<string, RegExp> = {
      included: /Included\.( Locked\.)?$/,
      suggested: /Not included\.$/,
      superseded: /Not sent\.$/,
      loading: /Loading\.( Locked\.)?$/,
      error: /Error\.$/,
      attention: /Needs your choice\.$/,
    };
    for (const { state, text } of names) {
      expect(text).toMatch(word[state!]);
    }
  });
});

test.describe("geometry", () => {
  test("32px chips with always-visible 24px controls beside the open button", async ({
    page,
  }) => {
    await openStory(page, `${STORY}--all-states`, LANE);
    const lane = page.locator(LANE);
    const token = await lane.evaluate((element) => {
      const probe = document.createElement("div");
      probe.style.height = "var(--theme-layout-composer-context-chip-height)";
      element.appendChild(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      return height;
    });
    expect(token).toBe(32);
    const laneBox = await boxOf(lane);

    for (const item of await lane.locator(CHIP).all()) {
      const box = await boxOf(item);
      expect(box.height).toBeCloseTo(token, 0);
      expect(box.width).toBeLessThanOrEqual(laneBox.width + 0.5);
    }

    const controls = lane.locator(
      '[data-ui="composer-context-remove"], [data-ui="composer-context-restore"]',
    );
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) {
      const box = await boxOf(control);
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
      const style = await control.evaluate((element) => {
        const computed = getComputedStyle(element);
        const open = element.parentElement!.querySelector(
          '[data-ui="composer-context-chip-open"]',
        )!;
        return {
          // A locked chip's control is dimmed on purpose; it is still there.
          opacity: element.hasAttribute("disabled")
            ? Number(computed.opacity) > 0
            : computed.opacity === "1",
          visibility: computed.visibility,
          nested: open.contains(element),
        };
      });
      expect(style).toEqual({
        opacity: true,
        visibility: "visible",
        nested: false,
      });
    }
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollWidth),
    ).toBeLessThanOrEqual(340);
  });

  test("files keep their 54px tile beside 32px chips", async ({ page }) => {
    await openStory(page, `${STORY}--in-chat-input`, LANE);
    const tiles = page.locator(`${AREA} [data-ui="attachment-tile"]`);
    await expect(tiles).toHaveCount(2);
    for (const tile of await tiles.all()) {
      expect((await boxOf(tile)).height).toBeCloseTo(54, 0);
    }
    expect((await boxOf(page.locator(CHIP).first())).height).toBeCloseTo(32, 0);
  });

  for (const [story, width] of [
    ["in-chat-input", 340],
    ["in-chat-input-wide", 1280],
  ] as const) {
    test(`chips and files sit inside the composer box, chips first, at ${width}px`, async ({
      page,
    }) => {
      await openStory(page, `${STORY}--${story}`, LANE, { width });
      const shell = await boxOf(page.locator('[data-ui="chat-input-shell"]'));
      const parts = page.locator(
        `${CHIP}, ${AREA} [data-ui="attachment-tile"]`,
      );
      await expect(parts).toHaveCount(5);
      for (const part of await parts.all()) {
        const box = await boxOf(part);
        expect(box.x).toBeGreaterThanOrEqual(shell.x);
        expect(box.x + box.width).toBeLessThanOrEqual(shell.x + shell.width);
        expect(box.y).toBeGreaterThanOrEqual(shell.y);
        expect(box.y + box.height).toBeLessThanOrEqual(shell.y + shell.height);
      }
      const lastChip = await boxOf(page.locator(CHIP).last());
      const firstTile = await boxOf(
        page.locator(`${AREA} [data-ui="attachment-tile"]`).first(),
      );
      expect(firstTile.y).toBeGreaterThanOrEqual(lastChip.y + lastChip.height);
    });
  }

  test("an opted-in host with nothing to show adds no space", async ({
    page,
  }) => {
    await openStory(
      page,
      `${STORY}--no-items-yet`,
      '[data-ui="chat-input-shell"]',
    );
    const flow = await page
      .locator('[data-ui="chat-input-shell"]')
      .evaluate((shell) =>
        [...shell.children]
          .filter((child) => {
            const style = getComputedStyle(child);
            return style.display !== "none" && style.position !== "absolute";
          })
          .map((child) => child.getAttribute("data-ui") ?? child.tagName),
      );
    expect(flow.some((name) => name.startsWith("composer-"))).toBe(false);
    await expect(page.locator(LIVE)).toHaveCount(1);
    await expect(page.locator('[data-ui="composer-notice"]')).toHaveCount(1);
  });
});

test.describe("state styles", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`suggested dashes, superseded mutes, tones colour, loading spins, ${theme}`, async ({
      page,
    }) => {
      await openStory(page, `${STORY}--all-states`, LANE, { theme });
      const suggested = page.locator(`${CHIP}[data-state="suggested"]`).first();
      const style = (locator: Locator, property: string) =>
        locator.evaluate(
          (element, name) => getComputedStyle(element).getPropertyValue(name),
          property,
        );
      expect(await style(suggested, "border-top-style")).toBe("dashed");
      expect(await style(suggested, "border-top-color")).toBe(
        await tokenColor(suggested, "--theme-border-strong"),
      );

      const superseded = page
        .locator(`${CHIP}[data-state="superseded"]`)
        .first();
      expect(await style(superseded, "background-color")).toBe(
        "rgba(0, 0, 0, 0)",
      );
      expect(
        await style(
          superseded.locator('[data-ui="composer-context-chip-meta"]'),
          "font-style",
        ),
      ).toBe("italic");

      for (const tone of ["warning", "error"]) {
        const toned = page
          .locator(`${CHIP}[data-tone="${tone}"]:not([data-state="suggested"])`)
          .first();
        expect(await style(toned, "border-top-color")).toBe(
          await tokenColor(toned, `--theme-${tone}-border`),
        );
      }

      const loading = page.locator(`${CHIP}[data-state="loading"]`).first();
      await expect(loading.locator('[data-ui="spinner"]')).toHaveCount(1);
      await expect(loading.locator('[role="status"]')).toHaveCount(0);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`label and meta read at 4.5:1 in every state, ${theme}`, async ({
      page,
    }) => {
      await openStory(page, `${STORY}--all-states`, LANE, { theme });
      const ratios = await page
        .locator(
          `${CHIP} [data-ui="composer-context-chip-label"], ${CHIP} [data-ui="composer-context-chip-meta"]`,
        )
        .evaluateAll((elements, measure) => {
          const contrast = new Function(`return (${measure})`)() as (
            element: Element,
          ) => number;
          return elements.map((element) => ({
            state: element
              .closest('[data-ui="composer-context-chip"]')!
              .getAttribute("data-state"),
            ratio: contrast(element),
          }));
        }, contrastOf.toString());
      expect(ratios.length).toBeGreaterThan(8);
      for (const { state, ratio } of ratios) {
        expect(ratio, `${state} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("long labels truncate and keep the control inside the chip", async ({
    page,
  }) => {
    await openStory(page, `${STORY}--long-labels`, LANE);
    const first = page.locator(CHIP).first();
    const label = first.locator('[data-ui="composer-context-chip-label"]');
    expect(
      await label.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    const chipBox = await boxOf(first);
    const control = await boxOf(
      first.locator('[data-ui="composer-context-remove"]'),
    );
    expect(control.x + control.width).toBeLessThanOrEqual(
      chipBox.x + chipBox.width + 0.5,
    );
  });
});

test.describe("keyboard", () => {
  test("one tab stop, arrows, Delete and + with outcome announcements", async ({
    page,
  }) => {
    await openStory(page, `${STORY}--interactive`, LANE);
    const textarea = page.getByPlaceholder("Type a message...");
    const selectionOpen = page.locator(OPEN).first();

    await selectionOpen.focus();
    await expect(selectionOpen).toBeFocused();
    await page.keyboard.press("Tab");
    // The next stop is outside the lane: the lane is one stop.
    expect(
      await page.evaluate(
        (lane) =>
          !document.querySelector(lane)!.contains(document.activeElement),
        LANE,
      ),
    ).toBe(true);

    await selectionOpen.focus();
    await page.keyboard.press("ArrowRight");
    await expect(openButton(page, "Supply agreement")).toBeFocused();
    await page.keyboard.press("End");
    await expect(openButton(page, "Budget follow-up")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(selectionOpen).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(selectionOpen).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Delete");
    const documentChip = chip(page, "Supply agreement");
    await expect(documentChip).toHaveAttribute("data-state", "suggested");
    await expect(openButton(page, "Supply agreement")).toBeFocused();
    await expect(live(page)).toHaveText(
      "Supply agreement removed. Include again with +",
    );

    await page.keyboard.press("+");
    await expect(documentChip).toHaveAttribute("data-state", "included");
    await expect(live(page)).toHaveText("Supply agreement included.");

    await openButton(page, "Re: Offsite agenda").focus();
    await page.keyboard.press("Delete");
    await expect(chip(page, "Re: Offsite agenda")).toHaveCount(0);
    await expect(openButton(page, "Budget follow-up")).toBeFocused();
    await expect(live(page)).toHaveText("Re: Offsite agenda removed.");

    // The selection churns; the lane says nothing and keeps its place.
    await page.getByRole("button", { name: "Change selection" }).click();
    await expect(chip(page, "A new selection")).toHaveCount(1);
    await expect(live(page)).toHaveText("Re: Offsite agenda removed.");

    await openButton(page, "Budget follow-up").focus();
    await page.keyboard.press("Backspace");
    await expect(chip(page, "Budget follow-up")).toHaveCount(0);
    // The last user chip leaves: focus falls back to the chip before it.
    await expect(openButton(page, "Supply agreement")).toBeFocused();
    await expect(textarea).not.toBeFocused();
  });

  test("Delete on a locked chip says why and changes nothing", async ({
    page,
  }) => {
    await openStory(page, `${STORY}--all-states`, LANE);
    const transcript = openButton(page, "Weekly product sync");
    await transcript.focus();
    await page.keyboard.press("Delete");
    await expect(live(page)).toHaveText("Preparing the transcript");
    await expect(chip(page, "Weekly product sync")).toHaveAttribute(
      "data-state",
      "included",
    );
  });
});

test.describe("detail", () => {
  test("opens as a bottom sheet in the pane, focus in and back", async ({
    page,
  }) => {
    await openStory(page, `${STORY}--detail-sheet`, LANE);
    const open = openButton(page, "Supply agreement");
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Supply agreement" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const box = await boxOf(dialog);
    expect(box.width).toBeGreaterThanOrEqual(340 - 20);
    expect(800 - (box.y + box.height)).toBeLessThanOrEqual(12);
    expect(
      await dialog.evaluate(
        (element, area) => Boolean(element.closest(area)),
        AREA,
      ),
    ).toBe(false);
    await expect(
      dialog.getByRole("button", { name: "Don't include this document" }),
    ).toBeVisible();
    // Focus moved in, and Tab stays in.
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("anchors a popover to its chip on the wide app", async ({ page }) => {
    await openStory(page, `${STORY}--detail-popover`, LANE, { width: 1280 });
    const target = chip(page, "Supply agreement");
    const open = openButton(page, "Supply agreement");
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Supply agreement" });
    await expect(dialog).toHaveAttribute("data-placement", "popover");
    const chipBox = await boxOf(target);
    const box = await boxOf(dialog);
    const gap = chipBox.y - (box.y + box.height);
    expect(gap).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(12);
    expect(Math.abs(box.x - chipBox.x)).toBeLessThanOrEqual(1);
    const width = await dialog.evaluate((element) => {
      const probe = document.createElement("div");
      probe.style.width = "var(--theme-layout-composer-context-detail-width)";
      element.appendChild(probe);
      const value = probe.getBoundingClientRect().width;
      probe.remove();
      return value;
    });
    expect(box.width).toBeCloseTo(width, 0);
    await expect(page.locator('[data-ui="modal-overlay"]')).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Close details" }),
    ).toBeFocused();

    // Its own chip toggles it closed rather than closing and reopening.
    await open.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await open.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(1200, 40);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("overflow", () => {
  test("one capped area: +N more, Show less, Remove all in view", async ({
    page,
  }) => {
    await openStory(page, `${STORY}--busy-lane`, LANE);
    const area = page.locator(AREA);
    const cap = await area.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).maxHeight),
    );
    expect(cap).toBe(192);
    expect((await boxOf(area)).height).toBeLessThanOrEqual(cap + 1);

    const more = page.locator(
      '[data-ui="composer-context-more"][data-expanded="false"] button',
    );
    await expect(more).toBeVisible();
    const shown = await page.locator(CHIP).count();
    const hidden = 8 - shown;
    expect(hidden).toBeGreaterThan(0);
    await expect(more).toHaveText(`+${hidden} more`);
    await expect(more).toHaveAccessibleName(
      `Show ${hidden} more item${hidden === 1 ? "" : "s"}`,
    );

    // No scroll area nests inside the shared one.
    const nested = await area.evaluate(
      (element) =>
        [...element.querySelectorAll("*")].filter((node) =>
          ["auto", "scroll"].includes(getComputedStyle(node).overflowY),
        ).length,
    );
    expect(nested).toBe(0);

    const removeAll = page.getByRole("button", {
      name: "Remove all attachments",
    });
    const areaBox = await boxOf(area);
    const removeBox = await boxOf(removeAll);
    expect(removeBox.y + removeBox.height).toBeLessThanOrEqual(
      areaBox.y + areaBox.height + 1,
    );
    // Chips fold first, but never past the top half of the first file.
    const firstTile = await boxOf(
      area.locator('[data-ui="attachment-tile"]').first(),
    );
    const pinnedTop = (
      await boxOf(area.locator('[data-ui="attachment-bulk-controls"]'))
    ).y;
    expect(firstTile.y).toBeGreaterThanOrEqual(areaBox.y);
    expect(pinnedTop - firstTile.y).toBeGreaterThanOrEqual(
      firstTile.height / 2 - 1,
    );

    await more.click();
    await expect(page.locator(CHIP)).toHaveCount(8);
    await expect(page.getByRole("button", { name: "Show less" })).toBeVisible();
    await expect(live(page)).toHaveText("Showing every item.");
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("data-ui"),
      ),
    ).toBe("composer-context-chip-open");
    expect(
      await area.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    // With every chip shown the files sit further down the same area, and
    // Remove all comes with them.
    await area.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    const pinned = await boxOf(removeAll);
    const box = await boxOf(area);
    expect(pinned.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(pinned.y + pinned.height).toBeLessThanOrEqual(
      box.y + box.height + 1,
    );
  });

  test("a focused chip's outline is not clipped", async ({ page }) => {
    await openStory(page, `${STORY}--busy-lane`, LANE);
    await page.locator(OPEN).first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    const clipped = await page
      .locator(OPEN)
      .first()
      .evaluate((open, area) => {
        const chipNode = open.closest('[data-ui="composer-context-chip"]')!;
        const style = getComputedStyle(chipNode);
        const offset = Number.parseFloat(style.outlineOffset);
        const width = Number.parseFloat(style.outlineWidth);
        const rect = chipNode.getBoundingClientRect();
        const outer = Math.max(0, offset + width);
        const areaRect = document.querySelector(area)!.getBoundingClientRect();
        return {
          styled: style.outlineStyle !== "none",
          inside:
            rect.left - outer >= areaRect.left - 0.5 &&
            rect.right + outer <= areaRect.right + 0.5,
        };
      }, AREA);
    expect(clipped).toEqual({ styled: true, inside: true });
  });

  test("speaks German", async ({ page }) => {
    await openStory(page, `${STORY}--busy-lane`, LANE, { locale: "de" });
    await expect(
      page.getByRole("list", { name: "Kontext der Nachricht" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-ui="composer-context-more"] button'),
    ).toHaveText(/^\+\d+ weitere$/);
  });
});

test.describe("web unchanged", () => {
  for (const story of [
    "ui-chatinput--default",
    "ui-chatinput--with-initial-attachments",
    "ui-attachmenttile--recipe-in-chat-input",
  ]) {
    test(`${story} draws no lane hooks`, async ({ page }) => {
      await openStory(page, story, '[data-ui="chat-input-shell"]');
      await expect(page.locator('[data-ui^="composer-"]')).toHaveCount(0);
      const capped = page.locator(
        '[data-ui="chat-input-shell"] [style*="attachment-tile-staged-max-height"]',
      );
      if (story !== "ui-chatinput--default") {
        await expect(capped).toHaveCount(1);
        expect(
          await capped.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).maxHeight),
          ),
        ).toBe(192);
      }
    });
  }
});

test.describe("kit face", () => {
  test("draws inside the open button and keeps the host's control and popup", async ({
    page,
  }) => {
    await openStory(
      page,
      `${STORY}--kit-face`,
      '[data-testid="sample-kit-face"]',
    );
    const faces = page.locator('[data-testid="sample-kit-face"]');
    expect(await faces.count()).toBeGreaterThan(0);
    for (const face of await faces.all()) {
      expect(
        await face.evaluate((element) =>
          Boolean(element.closest('[data-ui="composer-context-chip-open"]')),
        ),
      ).toBe(true);
    }
    const withDetail = page.locator(`${CHIP}[data-has-detail]`).first();
    await expect(withDetail.locator(OPEN)).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    const control = withDetail.locator('[data-ui="composer-context-remove"]');
    expect(
      await control.evaluate(
        (element) =>
          !element
            .parentElement!.querySelector(
              '[data-ui="composer-context-chip-open"]',
            )!
            .contains(element),
      ),
    ).toBe(true);
  });
});

test.describe("notices", () => {
  test("sit above the lane with a role by tone", async ({ page }) => {
    await openStory(page, `${STORY}--notices`, '[data-ui="composer-notice"]');
    const notices = page.locator('[data-ui="composer-notice"]');
    await expect(notices).toHaveCount(3);
    await expect(notices.nth(0)).toHaveAttribute("role", "status");
    await expect(notices.nth(1)).toHaveAttribute("role", "status");
    await expect(notices.nth(2)).toHaveAttribute("role", "alert");
    for (const notice of await notices.all()) {
      const order = await notice.evaluate((element) => {
        const shell = element.parentElement!;
        const children = [...shell.children];
        const area = shell.querySelector('[data-ui="composer-staged-area"]')!;
        return {
          inShell: shell.getAttribute("data-ui"),
          before: children.indexOf(element) < children.indexOf(area),
        };
      });
      expect(order).toEqual({ inShell: "chat-input-shell", before: true });
      // The mark, spinner included, centres on the first line of text.
      const offset = await notice.evaluate((element) => {
        const mark = element
          .querySelector('[data-ui="composer-notice-icon"]')!
          .getBoundingClientRect();
        const text = element.querySelector(
          '[data-ui="alert"] .text-sm > div > span',
        )!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const line = range.getClientRects()[0];
        return Math.abs(
          mark.top + mark.height / 2 - (line.top + line.height / 2),
        );
      });
      expect(offset).toBeLessThanOrEqual(3);
    }
  });
});
