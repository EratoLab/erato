import { expect, test, type Page } from "@playwright/test";

import {
  boxOf,
  tokenColor,
} from "../storybook-composer-context-lane/lane-helpers";
import {
  chipsOf,
  expectReadable,
  noPageOverflow,
  openParity,
  px,
  storiesOf,
  style,
  tokenLength,
} from "./parity-helpers";

const THREAD = "[data-story-thread]";
const ROW = '[data-ui="message-sent-with"]';
const ROW_LABEL = '[data-ui="message-sent-with-label"]';
const SENT_CHIP = '[data-ui="message-sent-with-chip"]';
const SENT_CHIP_LABEL = '[data-ui="message-sent-with-chip-label"]';

const userMessage = (page: Page) => page.getByTestId("message-user");

const sentStories = storiesOf("sent");
const withChips = sentStories.filter(([name]) => chipsOf(name).length > 0);
const withoutChips = sentStories.filter(([name]) => chipsOf(name).length === 0);

test.describe("Sent with, every story against what the add-in names", () => {
  for (const [name, sent] of withChips) {
    test(name, async ({ page }) => {
      await openParity(page, name, THREAD);
      const message = userMessage(page);
      const row = message.locator(ROW);
      await expect(row).toHaveCount(1);
      // Inside the bubble's body, under the text the user wrote.
      await expect(
        message.locator(`[data-ui="message-body"] ${ROW}`),
      ).toHaveCount(1);
      const text = await boxOf(message.getByText(sent.text, { exact: true }));
      expect((await boxOf(row)).y).toBeGreaterThanOrEqual(
        text.y + text.height - 0.5,
      );

      const list = message.getByRole("list", { name: "Sent with" });
      await expect(list).toBeVisible();
      const expected = chipsOf(name);
      const chips = list.locator(SENT_CHIP);
      await expect(chips).toHaveCount(expected.length);
      for (const [index, chip] of expected.entries()) {
        const item = chips.nth(index);
        await expect(item).toHaveAttribute("data-kind", chip.kind);
        await expect(item.locator(SENT_CHIP_LABEL)).toHaveText(chip.label);
        await expect(item).toHaveAttribute(
          "title",
          chip.meta ? `${chip.label} · ${chip.meta}` : chip.label,
        );
        // Read as "label, meta": the meta is spoken, not drawn.
        expect(await item.textContent()).toBe(
          chip.meta ? `${chip.label}, ${chip.meta}` : chip.label,
        );
      }

      // Read-only: no control, no tab stop, glyphs out of the tree.
      await expect(
        row.locator("a, button, input, select, textarea, [tabindex]"),
      ).toHaveCount(0);
      const glyphsHidden = await row
        .locator("svg")
        .evaluateAll((svgs) =>
          svgs.every((svg) => svg.closest('[aria-hidden="true"]') !== null),
        );
      expect(glyphsHidden).toBe(true);
    });
  }

  for (const [name] of withoutChips) {
    test(`${name} draws no row`, async ({ page }) => {
      await openParity(page, name, THREAD);
      await expect(userMessage(page)).toBeVisible();
      await expect(page.locator(ROW)).toHaveCount(0);
    });
  }

  test("a facet no host describes keeps only its quote above the text", async ({
    page,
  }) => {
    await openParity(page, "SentWithUnregistered", THREAD);
    const message = userMessage(page);
    await expect(message.getByText("Selection", { exact: true })).toBeVisible();
    await expect(
      message.getByText("Q3 revenue: 4.2 M EUR (+8 % year on year)"),
    ).toBeVisible();
    await expect(message.locator(ROW)).toHaveCount(0);
  });

  test("the assistant's answer never carries the row", async ({ page }) => {
    await openParity(page, "SentWithWordSelection", THREAD);
    await expect(page.getByTestId("message-assistant")).toBeVisible();
    await expect(
      page.getByTestId("message-assistant").locator(ROW),
    ).toHaveCount(0);
  });
});

test.describe("Sent with, look", () => {
  test("a small muted label over 22 px chips in the attachment border", async ({
    page,
  }) => {
    await openParity(page, "SentWithOutlookDraft", THREAD);
    const label = page.locator(ROW_LABEL);
    expect(await style(label, "text-transform")).toBe("uppercase");
    const labelSize = await px(label, "font-size");
    expect(labelSize).toBeGreaterThanOrEqual(10.5);
    expect(labelSize).toBeLessThanOrEqual(11.5);
    expect(await style(label, "color")).toBe(
      await tokenColor(label, "--theme-fg-muted"),
    );

    const chip = page.locator(SENT_CHIP).first();
    expect((await boxOf(chip)).height).toBeCloseTo(22, 0);
    expect(await px(chip, "font-size")).toBe(12);
    expect(await style(chip, "border-top-style")).toBe("solid");
    const border = await chip.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.borderColor = "var(--theme-border-attachment)";
      probe.style.borderStyle = "solid";
      element.appendChild(probe);
      const value = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return value;
    });
    expect(await style(chip, "border-top-color")).toBe(border);
    expect(await style(chip, "border-top-left-radius")).toBe(
      await tokenLength(chip, "--theme-radius-base"),
    );
    expect(await style(chip, "color")).toBe(
      await tokenColor(chip, "--theme-fg-secondary"),
    );
  });

  test("a long name is cut with an ellipsis inside the bubble at 340", async ({
    page,
  }) => {
    await openParity(page, "SentWithLongNames", THREAD, { width: 340 });
    const chip = page.locator(SENT_CHIP).first();
    const label = chip.locator(SENT_CHIP_LABEL);
    expect(await style(label, "text-overflow")).toBe("ellipsis");
    const cut = await label.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    expect(cut).toBe(true);
    const body = await boxOf(
      userMessage(page).locator('[data-ui="message-body"]'),
    );
    const box = await boxOf(chip);
    expect(box.x + box.width).toBeLessThanOrEqual(body.x + body.width + 0.5);
    const list = page.locator('[data-ui="message-sent-with-list"]');
    expect(
      await list.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await noPageOverflow(page, 340);
  });

  for (const width of [480, 1280]) {
    test(`the row stays inside the bubble at ${width}`, async ({ page }) => {
      await openParity(page, "SentWithWordDocument", THREAD, { width });
      const body = await boxOf(
        userMessage(page).locator('[data-ui="message-body"]'),
      );
      for (const chip of await page.locator(SENT_CHIP).all()) {
        const box = await boxOf(chip);
        expect(box.x).toBeGreaterThanOrEqual(body.x - 0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(
          body.x + body.width + 0.5,
        );
      }
      await noPageOverflow(page, width);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`label and chips read at 4.5:1 in ${theme}`, async ({ page }) => {
      for (const name of ["SentWithWordSelection", "SentWithOutlookDraft"]) {
        await openParity(page, name, THREAD, { theme });
        await expectReadable(page, ROW_LABEL, `${name} label, ${theme}`);
        await expectReadable(page, SENT_CHIP_LABEL, `${name} chips, ${theme}`);
      }
    });
  }
});

test.describe("Sent with, German", () => {
  test("the label and the add-in's names follow the locale", async ({
    page,
  }) => {
    for (const name of ["SentWithOutlookAppointment", "SentWithWordDocument"]) {
      await openParity(page, name, THREAD, { locale: "de" });
      const message = userMessage(page);
      await expect(message.locator(ROW_LABEL)).toHaveText("Gesendet mit");
      expect(await message.locator(ROW_LABEL).innerText()).toBe("GESENDET MIT");
      const list = message.getByRole("list", { name: "Gesendet mit" });
      const expected = chipsOf(name, "de");
      expect(expected).not.toEqual(chipsOf(name, "en"));
      for (const [index, chip] of expected.entries()) {
        const item = list.locator(SENT_CHIP).nth(index);
        await expect(item.locator(SENT_CHIP_LABEL)).toHaveText(chip.label);
        expect(await item.textContent()).toBe(
          chip.meta ? `${chip.label}, ${chip.meta}` : chip.label,
        );
      }
    }
  });
});
