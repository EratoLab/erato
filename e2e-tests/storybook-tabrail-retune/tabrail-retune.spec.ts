import { expect, test, type Page } from "@playwright/test";

// A tab's corner is `max(0px, var(--tab-rail-radius, var(--theme-radius-control))
// - var(--tab-rail-track-padding))`, and the shipped theme retunes it by
// re-declaring the control token on the rail's hook. jsdom cannot evaluate
// `max()`, so this is where the corner is actually read. Each reading is paired
// with the same element after the rule that should have produced it is deleted
// from the loaded sheet, so a probe that cannot fail never counts as evidence.

const RAIL = '[data-ui="tab-rail"]';
const TAB = '[data-ui="tab-rail-tab"]';
const MODAL = '[data-ui="modal-shell"]';
const THEME_LINK = 'link[data-theme-styles="true"]';

const THEME = "open-webui-like";
// theme.json: radius.pill 9999px, radius.control 0.75rem (stock is 0.5rem).
const PILL = "9999px";
const THEME_CONTROL = "12px";
// The segmented track insets its tabs by 0.125rem and the tab corner is derived
// from the track's, so a segment sits 2px inside whichever corner the rail has.
const PILL_IN_TRACK = "9997px";
const THEME_CONTROL_IN_TRACK = "10px";
// The control padding tokens: 0.75rem / 0.5rem in both the theme and stock.
const TOKEN_PADDING = "8px 12px";

// Selector text as the browser reports it from the shipped theme.css.
const HOOK_RULE = '[data-ui="tab-rail"]';
const INTERIM_RULE =
  '[data-ui="modal-shell"] [role="tablist"][aria-orientation]';
const PAGE_SHELL_RULES = '[data-ui="page-shell"] [role="tablist"]';

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
  // The link is appended before its sheet has parsed; a corner read in that
  // window is the base corner and would fail for the wrong reason.
  await page.waitForFunction(
    (selector) =>
      (document.querySelector<HTMLLinkElement>(selector)?.sheet?.cssRules
        .length ?? 0) > 0,
    THEME_LINK,
  );
  // Only the pack's theme.json sets this; stock is 0.5rem. Separates "the
  // retune missed the rail" from "the pack never loaded".
  expect(
    await styleOf(page, ":root", "--theme-radius-control"),
    "the theme pack's tokens did not reach :root",
  ).toBe("0.75rem");
};

const styleOf = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (el, name) => getComputedStyle(el).getPropertyValue(name).trim(),
      property,
    );

const radiusOf = (page: Page, selector: string) =>
  styleOf(page, selector, "border-radius");

// Deletes every rule of the loaded theme sheet whose selector matches, and
// returns how many went. A caller asserts that count: a selector the sheet no
// longer contains would otherwise leave the control silently unbroken.
const deleteThemeRules = (
  page: Page,
  selector: string,
  match: "exact" | "prefix" = "exact",
) =>
  page.evaluate(
    ([link, wanted, mode]) => {
      const sheet = document.querySelector<HTMLLinkElement>(link)?.sheet;
      if (!sheet) {
        throw new Error("theme stylesheet not loaded");
      }
      let deleted = 0;
      for (let i = sheet.cssRules.length - 1; i >= 0; i -= 1) {
        const rule = sheet.cssRules[i];
        if (!(rule instanceof CSSStyleRule)) {
          continue;
        }
        const hit =
          mode === "exact"
            ? rule.selectorText === wanted
            : rule.selectorText.startsWith(wanted);
        if (hit) {
          sheet.deleteRule(i);
          deleted += 1;
        }
      }
      return deleted;
    },
    [THEME_LINK, selector, match] as const,
  );

test.describe("tab rails under the open-webui-like retune", () => {
  test("a SharingDialog segmented control inside ModalBase takes the pill", async ({
    page,
  }) => {
    const track = `${MODAL} ${RAIL}[data-variant="segmented"]`;
    const tab = `${track} ${TAB}`;
    await openStory(page, "ui-sharing-sharingdialog--already-open", track);

    // The hook rule's declaration lands on the rail itself, so it survives the
    // portal that keeps page-scoped rules out of the dialog.
    expect(await styleOf(page, track, "--theme-radius-control")).toBe(PILL);

    const trackRadius = await radiusOf(page, track);
    const tabRadius = await radiusOf(page, tab);
    const tabPadding = await styleOf(page, tab, "padding");
    console.log(
      `sharing dialog: track ${trackRadius} (padding ${await styleOf(page, track, "padding")}, border ${await styleOf(page, track, "border-width")}), segment ${tabRadius}, segment padding ${tabPadding}`,
    );
    expect(trackRadius).toBe(PILL);
    expect(tabRadius).toBe(PILL_IN_TRACK);
    // The size literal (`px-3 py-1.5`) still outranks the geometry class's
    // token padding on the segmented variant, so the retune changes no size.
    expect(tabPadding).toBe("6px 12px");

    // The interim modal-shell rule also matches here; it is not what does it.
    expect(await deleteThemeRules(page, INTERIM_RULE)).toBe(1);
    expect(await radiusOf(page, tab)).toBe(PILL_IN_TRACK);

    // The negative control: without the hook rule the control reads the
    // theme's 0.75rem token — the pre-hook look this dialog had under this
    // theme, before its segmented control carried data-ui="tab-rail".
    expect(await deleteThemeRules(page, HOOK_RULE)).toBe(1);
    const squareTrack = await radiusOf(page, track);
    const squareTab = await radiusOf(page, tab);
    console.log(
      `sharing dialog without the hook rule: track ${squareTrack}, segment ${squareTab}`,
    );
    expect(squareTrack).toBe(THEME_CONTROL);
    expect(squareTab).toBe(THEME_CONTROL_IN_TRACK);
  });

  test("a settings rail tab and the nested text-size control take the pill", async ({
    page,
  }) => {
    const rail = `${MODAL} ${RAIL}[data-variant="rail"]`;
    const selected = `${rail} ${TAB}[aria-selected="true"]`;
    await openStory(page, "ui-userpreferencesdialog--empty", rail);

    const tabRadius = await radiusOf(page, selected);
    const tabPadding = await styleOf(page, selected, "padding");
    console.log(
      `preferences rail: selected tab ${tabRadius}, padding ${tabPadding}`,
    );
    expect(tabRadius).toBe(PILL);
    expect(tabPadding).toBe(TOKEN_PADDING);

    // The segmented text-size control inside the Appearance panel is the third
    // ModalBase surface the one rule reaches.
    await page.getByRole("tab", { name: "Appearance" }).click();
    const textSize = `${MODAL} ${RAIL}[data-variant="segmented"]`;
    await expect(page.locator(textSize)).toBeVisible();
    const textSizeTab = await radiusOf(page, `${textSize} ${TAB}`);
    console.log(
      `text-size control: track ${await radiusOf(page, textSize)}, segment ${textSizeTab}, segment padding ${await styleOf(page, `${textSize} ${TAB}`, "padding")}`,
    );
    expect(await radiusOf(page, textSize)).toBe(PILL);
    expect(textSizeTab).toBe(PILL_IN_TRACK);

    // Inside ModalBase the interim rule matches every rail as well, so the
    // control has to remove both before the base corner can show.
    expect(await deleteThemeRules(page, HOOK_RULE)).toBe(1);
    expect(await radiusOf(page, selected)).toBe(PILL);
    expect(await deleteThemeRules(page, INTERIM_RULE)).toBe(1);
    const base = await radiusOf(page, selected);
    console.log(`preferences rail without both rules: selected tab ${base}`);
    expect(base).toBe(THEME_CONTROL);
    expect(await radiusOf(page, `${textSize} ${TAB}`)).toBe(
      THEME_CONTROL_IN_TRACK,
    );
  });

  test("the markdown/preview tab takes the pill from the hook rule alone", async ({
    page,
  }) => {
    const rail = `${RAIL}[aria-label="Markdown editor"]`;
    const tab = `${rail} ${TAB}`;
    await openStory(page, "ui-assistantform--empty-form", rail);

    // Neither the modal-shell nor the page-shell rules can reach this story,
    // so the hook rule is the only one left that can pill the strip.
    expect(
      await page
        .locator(rail)
        .evaluate(
          (el) =>
            el.closest('[data-ui="modal-shell"], [data-ui="page-shell"]') !==
            null,
        ),
    ).toBe(false);

    const tabRadius = await radiusOf(page, tab);
    const tabPadding = await styleOf(page, tab, "padding");
    console.log(`markdown/preview: tab ${tabRadius}, padding ${tabPadding}`);
    expect(tabRadius).toBe(PILL);
    expect(tabPadding).toBe(TOKEN_PADDING);

    // The rail variant reads the padding tokens, unlike the sized segments: a
    // theme that moves the token on the hook moves these tabs.
    const tokenRetune = await page.addStyleTag({
      content: `${rail} { --theme-spacing-control-padding-y: 1rem; }`,
    });
    expect(await styleOf(page, tab, "padding")).toBe("16px 12px");
    await tokenRetune.evaluate((el) => el.remove());
    expect(await styleOf(page, tab, "padding")).toBe(TOKEN_PADDING);

    expect(await deleteThemeRules(page, HOOK_RULE)).toBe(1);
    const base = await radiusOf(page, tab);
    console.log(`markdown/preview without the hook rule: tab ${base}`);
    expect(base).toBe(THEME_CONTROL);
  });

  test("a page rail under page-shell is pilled twice over", async ({
    page,
  }) => {
    // No story renders AssistantsPage's view switcher; a bare horizontal rail
    // under the page-shell hook is the same anatomy under the same rules.
    const rail = `${RAIL}[data-variant="rail"]`;
    const tab = `${rail} ${TAB}`;
    await openStory(page, "ui-controls-tabrail--rail", rail);
    await page
      .locator("#storybook-root")
      .evaluate((el) => el.setAttribute("data-ui", "page-shell"));

    const tabRadius = await radiusOf(page, tab);
    console.log(
      `page rail: tab ${tabRadius}, padding ${await styleOf(page, tab, "padding")}`,
    );
    expect(tabRadius).toBe(PILL);
    expect(await styleOf(page, tab, "padding")).toBe(TOKEN_PADDING);

    // Either rule pills it on its own; only removing both shows the base.
    expect(await deleteThemeRules(page, HOOK_RULE)).toBe(1);
    expect(await radiusOf(page, tab)).toBe(PILL);
    expect(await deleteThemeRules(page, PAGE_SHELL_RULES, "prefix")).toBe(2);
    const base = await radiusOf(page, tab);
    console.log(`page rail without both rules: tab ${base}`);
    expect(base).toBe(THEME_CONTROL);
  });

  test("a --tab-rail-radius declaration outranks the token re-declaration", async ({
    page,
  }) => {
    // The documented retune channel: the corner reads `--tab-rail-radius`
    // first and falls back to the control token, so a value set anywhere
    // above the rail wins even against the theme's rule on the rail itself.
    const track = `${RAIL}[data-variant="segmented"]`;
    const tab = `${track} ${TAB}`;
    await openStory(page, "ui-controls-tabrail--segmented", track);
    expect(await radiusOf(page, tab)).toBe(PILL_IN_TRACK);

    await page.addStyleTag({
      content: "#storybook-root { --tab-rail-radius: 0.5rem; }",
    });
    const trackRadius = await radiusOf(page, track);
    const tabRadius = await radiusOf(page, tab);
    console.log(
      `segmented with --tab-rail-radius 0.5rem above it: track ${trackRadius}, segment ${tabRadius}`,
    );
    expect(trackRadius).toBe("8px");
    expect(tabRadius).toBe("6px");
  });

  test("a unitless 0 track padding squares every segment; 0px keeps the corner", async ({
    page,
  }) => {
    const track = `${RAIL}[data-variant="segmented"]`;
    const tab = `${track} ${TAB}`;
    await openStory(page, "ui-controls-tabrail--segmented", track);
    const before = await radiusOf(page, tab);
    expect(before).toBe(PILL_IN_TRACK);

    // `max(0px, <length> - 0)` mixes a length with a number, which is invalid
    // at computed-value time, so border-radius falls back to its initial 0.
    // The track's own padding accepts the same value without complaint — the
    // only symptom is every tab going square.
    const unitless = await page.addStyleTag({
      content: `${track} { --tab-rail-track-padding: 0; }`,
    });
    const squared = await radiusOf(page, tab);
    const squaredTrackPadding = await styleOf(page, track, "padding");
    console.log(
      `--tab-rail-track-padding: 0 — segment ${squared}, track padding ${squaredTrackPadding}`,
    );
    expect(squared).toBe("0px");
    expect(squaredTrackPadding).toBe("0px");
    await unitless.evaluate((el) => el.remove());
    expect(await radiusOf(page, tab)).toBe(before);

    await page.addStyleTag({
      content: `${track} { --tab-rail-track-padding: 0px; }`,
    });
    const kept = await radiusOf(page, tab);
    console.log(
      `--tab-rail-track-padding: 0px — segment ${kept}, track padding ${await styleOf(page, track, "padding")}`,
    );
    expect(kept).toBe(PILL);
    expect(kept).not.toBe(before);
  });
});
