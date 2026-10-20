import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  boxOf,
  openStory,
  tokenColor,
} from "../storybook-composer-context-lane/lane-helpers";
import {
  expectReadable,
  noPageOverflow,
  PARITY,
  precedes,
  px,
  style,
  tokenBackground,
  tokenLength,
} from "./parity-helpers";

const SHELL = '[data-ui="chat-input-shell"]';
const CONTROLS = '[data-ui="chat-input-controls"]';
const TOOL_CHIP = '[data-ui="composer-tool-chip"]';
const TOOL_LIVE = '[data-ui="composer-tool-live"]';
const LOCK_REASON = "This assistant sets the tools for its chats.";

const openTools = (
  page: Page,
  story: string,
  options: { width?: number; theme?: "light" | "dark"; locale?: string } = {},
) => openStory(page, `${PARITY}--${story}`, SHELL, options);

const group = (page: Page, name = "Selected tools") =>
  page.locator(CONTROLS).getByRole("group", { name });
const toolChip = (page: Page, name: string) =>
  page.getByRole("button", { name: `Deselect ${name}` });
const plus = (page: Page) => page.getByTestId("chat-input-add-menu-trigger");
const send = (page: Page) => page.getByTestId("chat-input-send-message");
const modelSelector = (page: Page) =>
  page.locator(`${CONTROLS} #model-selector-dropdown-trigger`);
const centre = async (locator: Locator) => {
  const box = await boxOf(locator);
  return box.y + box.height / 2;
};

test.describe("Tool chips next to +", () => {
  test("two tools are chips in the controls row, after + and the model", async ({
    page,
  }) => {
    await openTools(page, "tool-chips-pane");
    const tools = group(page);
    await expect(tools).toBeVisible();
    await expect(tools.locator(TOOL_CHIP)).toHaveCount(2);
    await expect(tools.locator(TOOL_CHIP).nth(0)).toHaveAccessibleName(
      "Deselect Web search",
    );
    await expect(tools.locator(TOOL_CHIP).nth(1)).toHaveAccessibleName(
      "Deselect Extended thinking",
    );
    await expect(page.getByTestId("selected-facet-web_search")).toBeVisible();
    // The count badge on + is gone; the chips say what is on.
    await expect(page.getByTestId("chat-input-add-menu-badge")).toHaveCount(0);
    expect(await precedes(plus(page), tools)).toBe(true);
    expect(await precedes(modelSelector(page), tools)).toBe(true);

    const shell = await boxOf(page.locator(SHELL));
    for (const chip of await tools.locator(TOOL_CHIP).all()) {
      const box = await boxOf(chip);
      expect(box.height).toBeCloseTo(28, 0);
      expect(box.x).toBeGreaterThanOrEqual(shell.x);
      expect(box.x + box.width).toBeLessThanOrEqual(shell.x + shell.width);
    }
    // Send keeps its corner: right edge and bottom row of the controls.
    const sendBox = await boxOf(send(page));
    const lastChip = await boxOf(tools.locator(TOOL_CHIP).last());
    expect(sendBox.x).toBeGreaterThan(lastChip.x + lastChip.width);
    expect(
      Math.abs(
        (await centre(send(page))) -
          (await centre(tools.locator(TOOL_CHIP).last())),
      ),
    ).toBeLessThanOrEqual(4);
    await noPageOverflow(page, 340);
  });

  test("a chip is drawn from the control tokens, with its glyphs hidden", async ({
    page,
  }) => {
    await openTools(page, "tool-chips-pane");
    const chip = toolChip(page, "Web search");
    expect(await style(chip, "border-top-left-radius")).toBe(
      await tokenLength(chip, "--theme-radius-control"),
    );
    expect(await style(chip, "background-color")).toBe(
      await tokenBackground(chip, "--theme-bg-secondary"),
    );
    expect(await style(chip, "color")).toBe(
      await tokenColor(chip, "--theme-fg-secondary"),
    );
    expect(await px(chip, "font-size")).toBe(12);
    expect(await style(chip, "font-weight")).toBe("500");
    await expect(
      chip.locator('[data-ui="composer-tool-chip-label"]'),
    ).toHaveText("Web search");
    const glyphsHidden = await chip
      .locator("svg")
      .evaluateAll((svgs) =>
        svgs.every((svg) => svg.closest('[aria-hidden="true"]') !== null),
      );
    expect(glyphsHidden).toBe(true);
  });

  test("a click deselects, says so and hands focus on; the last hands it to +", async ({
    page,
  }) => {
    await openTools(page, "tool-chips-pane");
    const live = page.locator(TOOL_LIVE);
    // Where the model selector sits beside +; the composer itself may move.
    const besidePlus = async () => {
      const [model, trigger] = [
        await boxOf(modelSelector(page)),
        await boxOf(plus(page)),
      ];
      return { dx: model.x - trigger.x, dy: model.y - trigger.y };
    };
    const before = await besidePlus();
    await toolChip(page, "Web search").click();
    await expect(toolChip(page, "Web search")).toHaveCount(0);
    await expect(live).toHaveText("Web search deselected.");
    await expect(toolChip(page, "Extended thinking")).toBeFocused();
    // Dropping a tool never moves the model selector.
    expect(await besidePlus()).toEqual(before);

    await page.keyboard.press("Enter");
    await expect(page.locator(TOOL_CHIP)).toHaveCount(0);
    await expect(group(page)).toHaveCount(0);
    // The live region outlives the last chip, so this is still read.
    await expect(live).toHaveText("Extended thinking deselected.");
    await expect(plus(page)).toBeFocused();
  });

  test("Space deselects the focused chip too", async ({ page }) => {
    await openTools(page, "tool-chips-pane");
    await toolChip(page, "Extended thinking").focus();
    await page.keyboard.press("Space");
    await expect(toolChip(page, "Extended thinking")).toHaveCount(0);
    // The chip before it takes focus when the last one leaves.
    await expect(toolChip(page, "Web search")).toBeFocused();
  });

  test("no tool selected: no group, the live region and + stay", async ({
    page,
  }) => {
    await openTools(page, "tool-chips-none");
    await expect(plus(page)).toBeVisible();
    await expect(page.locator(TOOL_CHIP)).toHaveCount(0);
    await expect(group(page)).toHaveCount(0);
    await expect(page.locator(TOOL_LIVE)).toHaveCount(1);
    await expect(page.getByTestId("chat-input-add-menu-badge")).toHaveCount(0);
  });

  test("an assistant's enforced tools are locked chips that say why", async ({
    page,
  }) => {
    await openTools(page, "tool-chips-locked");
    const chip = toolChip(page, "Web search");
    await expect(chip).toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAttribute("data-locked", "true");
    await expect(chip).toHaveAttribute("title", LOCK_REASON);
    await expect(chip).toHaveAccessibleDescription(LOCK_REASON);
    expect(Number(await style(chip, "opacity"))).toBeCloseTo(0.5, 2);
    await chip.click({ force: true });
    await expect(toolChip(page, "Web search")).toHaveCount(1);
    await expect(page.locator(TOOL_LIVE)).toHaveText("");
  });

  test("a long name is cut inside the chip's width", async ({ page }) => {
    await openTools(page, "tool-chips-long-name");
    const chip = page.getByTestId("selected-facet-knowledge_search");
    const label = chip.locator('[data-ui="composer-tool-chip-label"]');
    expect(await style(label, "text-overflow")).toBe("ellipsis");
    expect(
      await label.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    expect((await boxOf(chip)).width).toBeLessThanOrEqual(180.5);
    await noPageOverflow(page, 340);
  });

  test("with room, + and the chips share one row in that order", async ({
    page,
  }) => {
    await openTools(page, "tool-chips-wide", { width: 1280 });
    const chips = page.locator(TOOL_CHIP);
    await expect(chips).toHaveCount(2);
    const plusCentre = await centre(plus(page));
    let lastX = (await boxOf(plus(page))).x;
    for (const chip of await chips.all()) {
      expect(Math.abs((await centre(chip)) - plusCentre)).toBeLessThanOrEqual(
        4,
      );
      const { x } = await boxOf(chip);
      expect(x).toBeGreaterThan(lastX);
      lastX = x;
    }
  });

  test("the wide web composer keeps its Tools dropdown and draws no chips", async ({
    page,
  }) => {
    await openTools(page, "tool-chips-pane", { width: 1280 });
    await expect(
      page.locator("#facet-selector-dropdown-trigger"),
    ).toContainText("Tools");
    await expect(page.getByTestId("selected-facet-web_search")).toBeVisible();
    await expect(page.locator(TOOL_CHIP)).toHaveCount(0);
    await expect(plus(page)).toHaveCount(0);
  });

  test("a mode chip comes before the tool chips, each with its own control", async ({
    page,
  }) => {
    await openTools(page, "tool-chips-with-mode");
    const mode = page.locator('[data-ui="composer-mode-chip"]');
    await expect(mode).toHaveAttribute("data-mode-id", "outlook.scheduling");
    const tool = toolChip(page, "Web search");
    expect(await precedes(plus(page), mode)).toBe(true);
    expect(await precedes(mode, tool)).toBe(true);
    // Reading order matches: the tool is after the mode, on its row or below.
    const modeBox = await boxOf(mode);
    const toolBox = await boxOf(tool);
    expect(
      toolBox.y > modeBox.y + modeBox.height / 2 || toolBox.x > modeBox.x,
    ).toBe(true);
    await tool.click();
    await expect(tool).toHaveCount(0);
    await expect(mode).toBeVisible();
    await noPageOverflow(page, 340);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`chip text reads at 4.5:1 in ${theme}`, async ({ page }) => {
      await openTools(page, "tool-chips-pane", { theme });
      await expectReadable(
        page,
        '[data-ui="composer-tool-chip-label"]',
        `tool chips, ${theme}`,
      );
    });
  }

  test("German names, group and announcement", async ({ page }) => {
    await openTools(page, "tool-chips-pane", { locale: "de" });
    const tools = group(page, "Ausgewählte Tools");
    await expect(tools).toBeVisible();
    const chip = page.getByRole("button", { name: "Tool Web search abwählen" });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.locator(TOOL_LIVE)).toHaveText("Web search abgewählt.");
  });
});
