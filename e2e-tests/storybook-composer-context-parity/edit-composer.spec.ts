import { expect, test, type Locator, type Page } from "@playwright/test";

import { boxOf } from "../storybook-composer-context-lane/lane-helpers";
import {
  chipsOf,
  expectReadable,
  noPageOverflow,
  openParity,
  style,
} from "./parity-helpers";

const EDITOR = '[data-testid="message-editor"]';
const AREA = `${EDITOR} [data-ui="composer-staged-area"]`;
const CHIP = `${EDITOR} [data-ui="composer-context-chip"]`;
const OPEN = '[data-ui="composer-context-chip-open"]';
const REMOVE = '[data-ui="composer-context-remove"]';
const TILE = `${EDITOR} [data-ui="composer-staged-files"] [data-ui="attachment-tile"]`;
const LIVE = `${EDITOR} [data-ui="composer-context-live"]`;
const DETAIL = '[data-ui="composer-context-detail"]';
const LOCK_REASON =
  "An edited message keeps the context it was sent with. To leave it out, write a new message.";

const textarea = (page: Page) => page.getByTestId("message-editor-input");
const chip = (page: Page, kind: string) =>
  page.locator(`${CHIP}[data-kind="${kind}"]`);
const labelOf = (item: Locator) =>
  item.locator('[data-ui="composer-context-chip-label"]');
const metaOf = (item: Locator) =>
  item.locator('[data-ui="composer-context-chip-meta"]');
const tileNames = (page: Page) =>
  page
    .locator(`${EDITOR} [data-ui="composer-staged-files"] button[title]`)
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("title") ?? ""),
    );

/** The file ids the submitted edit carried, as the story logs them. */
const readLog = async (page: Page) => {
  const log = page.locator("[data-story-log]");
  await expect(log).toHaveAttribute("data-submitted", "true");
  return (await log.innerText()).replace(/^Submitted files: /, "");
};

const submitAndRead = async (page: Page) => {
  await page.getByTestId("message-editor-submit").click();
  return readLog(page);
};

const openEdit = (
  page: Page,
  name: string,
  options: { width?: number; theme?: "light" | "dark"; locale?: string } = {},
) => openParity(page, name, EDITOR, options);

test.describe("Edit composer: the lane in the editor", () => {
  test("the lane sits above the message field and its files go through the slot", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsTranscript");
    const area = await boxOf(page.locator(AREA));
    const input = await boxOf(textarea(page));
    expect(area.y + area.height).toBeLessThanOrEqual(input.y + 0.5);
    await expect(
      page.getByRole("list", { name: "Attachments of this message" }),
    ).toBeVisible();
    await expect(page.locator(TILE)).toHaveCount(2);
    expect(await tileNames(page)).toEqual([
      "supplier-quote-a.pdf",
      "supplier-quote-b.pdf",
    ]);
    await noPageOverflow(page, 340);
  });

  test("a Teams transcript is one chip that stands for its files", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsTranscript");
    const transcript = chip(page, "teams.transcript");
    await expect(transcript).toHaveCount(1);
    await expect(transcript).toHaveAttribute("data-state", "included");
    await expect(labelOf(transcript)).toHaveText("Product sync");
    await expect(metaOf(transcript)).toContainText("1 conversation");
    expect((await boxOf(transcript)).height).toBeCloseTo(32, 0);
    // The (x) is drawn without hover, inside its chip.
    const remove = transcript.locator(REMOVE);
    await expect(remove).toBeVisible();
    await expect(remove).toHaveAccessibleName("Remove Teams transcript");
    expect(Number(await style(remove, "opacity"))).toBe(1);
    const box = await boxOf(transcript);
    const x = await boxOf(remove);
    expect(x.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(x.x + x.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    // The transcript and its shared files never show as tiles.
    for (const name of await tileNames(page)) {
      expect(name).not.toMatch(/^teams-/);
    }
  });

  test("(x) takes the transcript and its files out of the edit", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsTranscript");
    await chip(page, "teams.transcript").locator(REMOVE).click();
    await expect(chip(page, "teams.transcript")).toHaveCount(0);
    await expect(page.locator(LIVE)).toHaveText(
      "Teams transcript removed, with 2 shared files.",
    );
    // The last chip gone, focus goes back to the message.
    await expect(textarea(page)).toBeFocused();
    await expect(page.locator(TILE)).toHaveCount(2);
    expect(await submitAndRead(page)).toBe("user-file-1,user-file-2");
  });

  test("Delete on the focused chip removes it, as in the composer", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsTranscript");
    await chip(page, "teams.transcript").locator(OPEN).focus();
    await page.keyboard.press("Delete");
    await expect(chip(page, "teams.transcript")).toHaveCount(0);
    await expect(textarea(page)).toBeFocused();
  });

  test("an unchanged edit sends the transcript, its files and the user's", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsTranscript");
    await textarea(page).press("Enter");
    const sent = await readLog(page);
    expect(sent.split(",")).toEqual([
      "edit-v1",
      "edit-v1:roadmap",
      "edit-v1:dashboard",
      "user-file-1",
      "user-file-2",
    ]);
  });

  test("the transcript's detail is a sheet at 340, without Edit selection; Escape closes only it", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsTranscript");
    const open = chip(page, "teams.transcript").locator(OPEN);
    await open.click();
    const detail = page.getByRole("dialog", { name: "Teams transcript" });
    await expect(detail).toBeVisible();
    await expect(page.locator(DETAIL)).toHaveAttribute(
      "data-placement",
      "sheet",
    );
    await expect(
      detail.getByRole("button", { name: "Edit selection" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(page.locator(EDITOR)).toBeVisible();
    await expect(open).toBeFocused();
    // Escape again, now on the chip, cancels the edit.
    await page.keyboard.press("Escape");
    await expect(page.locator(EDITOR)).toHaveCount(0);
    await expect(page.getByTestId("message-user")).toContainText(
      "Compare the two supplier quotes",
    );
  });

  test("at 1280 the detail is a popover at its chip; Escape closes only it", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsTranscript", { width: 1280 });
    const transcript = chip(page, "teams.transcript");
    await transcript.locator(OPEN).click();
    const detail = page.locator(DETAIL);
    await expect(detail).toHaveAttribute("data-placement", "popover");
    const chipBox = await boxOf(transcript);
    const box = await boxOf(detail);
    expect(Math.abs(box.x - chipBox.x)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(page.locator(EDITOR)).toBeVisible();
    await expect(transcript.locator(OPEN)).toBeFocused();
  });

  test("Escape in the message field or on a file cancels the edit", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsTranscript");
    await textarea(page).press("Escape");
    await expect(page.locator(EDITOR)).toHaveCount(0);

    await openEdit(page, "EditTeamsTranscript");
    await page
      .getByRole("button", {
        name: /^Preview attachment supplier-quote-a\.pdf/,
      })
      .focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(EDITOR)).toHaveCount(0);
  });

  test("a transcript still being read is a loading chip that names itself", async ({
    page,
  }) => {
    await openEdit(page, "EditTeamsReading");
    const transcript = chip(page, "teams.transcript");
    await expect(transcript).toHaveAttribute("data-state", "loading");
    await expect(labelOf(transcript)).toHaveText("Teams transcript");
    await expect(metaOf(transcript)).toHaveText("Reading transcript…");
    // The minted-name files are claimed while it reads.
    expect(await tileNames(page)).toEqual(["supplier-quote-a.pdf"]);
    await transcript.locator(OPEN).click();
    await expect(
      page.getByRole("dialog", { name: "Teams transcript" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await transcript.locator(REMOVE).click();
    await expect(transcript).toHaveCount(0);
    expect(await submitAndRead(page)).toBe("user-file-1");
  });

  test("a transcript that can't be read stays a chip and its files never flash into the row", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const seen = { max: 0 };
      (window as unknown as { __tiles: typeof seen }).__tiles = seen;
      new MutationObserver(() => {
        const count = document.querySelectorAll(
          '[data-testid="message-editor"] [data-ui="attachment-tile"]',
        ).length;
        seen.max = Math.max(seen.max, count);
      }).observe(document, { subtree: true, childList: true });
    });
    await openEdit(page, "EditTeamsUnreadable");
    const transcript = chip(page, "teams.transcript");
    await expect(transcript).toHaveAttribute("data-state", "included");
    await expect(metaOf(transcript)).toHaveText("Conversations can't be shown");
    await page.waitForTimeout(500);
    expect(await tileNames(page)).toEqual(["supplier-quote-a.pdf"]);
    const most = await page.evaluate(
      () => (window as unknown as { __tiles: { max: number } }).__tiles.max,
    );
    expect(most).toBe(1);
  });

  test("Remove all takes only the files; the transcript keeps its chip", async ({
    page,
  }) => {
    await openEdit(page, "EditManyFiles");
    const area = page.locator(AREA);
    // One cap for chips and files together: the area scrolls, the page does not.
    expect(await style(area, "overflow-y")).toBe("auto");
    expect(
      await area.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    const removeAll = page.getByRole("button", { name: "Remove all: 6 files" });
    await expect(removeAll).toBeVisible();
    await removeAll.click();
    await expect(page.locator(TILE)).toHaveCount(0);
    await expect(chip(page, "teams.transcript")).toHaveCount(1);
    expect((await submitAndRead(page)).split(",")).toEqual([
      "edit-v1",
      "edit-v1:roadmap",
      "edit-v1:dashboard",
      "edit-v1:wireframes",
    ]);
  });
});

test.describe("Edit composer: the context the edit sends again", () => {
  for (const [name, kind] of [
    ["EditWordSelection", "word.selection"],
    ["EditWordDocument", "word.document"],
    ["EditOutlookDraft", "outlook.draft"],
  ] as const) {
    test(`${name}: a locked chip says it is sent as before`, async ({
      page,
    }) => {
      await openEdit(page, name);
      const [expected] = chipsOf(name);
      const item = chip(page, kind);
      await expect(item).toHaveCount(1);
      await expect(item).toHaveAttribute("data-state", "included");
      await expect(item).toHaveAttribute("data-locked", "true");
      await expect(labelOf(item)).toHaveText(expected.label);
      await expect(metaOf(item)).toHaveText("Sent as before");
      await expect(item.locator(OPEN)).toHaveAccessibleName(
        `${expected.label} Sent as before Included. Locked.`,
      );
      const remove = item.locator(REMOVE);
      await expect(remove).toBeVisible();
      await expect(remove).toBeDisabled();
      await expect(remove).toHaveAttribute("title", LOCK_REASON);
    });
  }

  test("Delete on the locked chip says why it stays", async ({ page }) => {
    await openEdit(page, "EditWordSelection");
    const item = chip(page, "word.selection");
    await item.locator(OPEN).focus();
    await page.keyboard.press("Delete");
    await expect(page.locator(LIVE)).toHaveText(LOCK_REASON);
    await expect(item).toHaveCount(1);
    await expect(item.locator(OPEN)).toBeFocused();
  });

  test("Enter opens the passage that went, as a scroll region, and the reason", async ({
    page,
  }) => {
    await openEdit(page, "EditWordSelection");
    const [expected] = chipsOf("EditWordSelection");
    const open = chip(page, "word.selection").locator(OPEN);
    await open.focus();
    await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog", { name: "Selection" });
    await expect(detail).toBeVisible();
    const quote = detail.locator('[data-ui="message-editor-facet-quote"]');
    await expect(quote).toHaveText(expected.quote!);
    await expect(quote).toHaveAttribute("tabindex", "0");
    await expect(quote).toHaveAccessibleName("Selection");
    await expect(
      detail.locator('[data-ui="message-editor-facet-note"]'),
    ).toHaveText(LOCK_REASON);
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(page.locator(EDITOR)).toBeVisible();
    await expect(open).toBeFocused();
  });

  test("the document's detail names what went, without a quote", async ({
    page,
  }) => {
    await openEdit(page, "EditWordDocument");
    const [expected] = chipsOf("EditWordDocument");
    await chip(page, "word.document").locator(OPEN).click();
    const detail = page.getByRole("dialog", { name: "Document" });
    await expect(detail).toBeVisible();
    await expect(detail.getByText(expected.meta!)).toBeVisible();
    await expect(
      detail.locator('[data-ui="message-editor-facet-quote"]'),
    ).toHaveCount(0);
  });

  test("the facet is not a file: the edit sends the files alone", async ({
    page,
  }) => {
    await openEdit(page, "EditOutlookDraft");
    expect(await submitAndRead(page)).toBe("user-file-1,user-file-2");
  });

  test("a facet the server no longer offers shows no chip", async ({
    page,
  }) => {
    await openEdit(page, "EditFacetUnavailable");
    await expect(page.locator(TILE)).toHaveCount(1);
    await expect(page.locator(CHIP)).toHaveCount(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the locked chip reads at 4.5:1 in ${theme}`, async ({ page }) => {
      await openEdit(page, "EditWordSelection", { theme });
      await expectReadable(
        page,
        `${CHIP} [data-ui="composer-context-chip-label"], ${CHIP} [data-ui="composer-context-chip-meta"]`,
        `edit lane, ${theme}`,
      );
    });
  }

  test("German: the lane, the meta and the reason", async ({ page }) => {
    await openEdit(page, "EditWordSelection", { locale: "de" });
    await expect(
      page.getByRole("list", { name: "Anhänge dieser Nachricht" }),
    ).toBeVisible();
    await expect(metaOf(chip(page, "word.selection"))).toHaveText(
      "Wie zuvor gesendet",
    );
    await expect(chip(page, "word.selection").locator(REMOVE)).toHaveAttribute(
      "title",
      "Eine bearbeitete Nachricht behält den Kontext, mit dem sie gesendet wurde. Um ihn wegzulassen, schreiben Sie eine neue Nachricht.",
    );
  });
});

test.describe("Edit composer: a component kit", () => {
  test("the kit's chip face and attachment preview draw the edit lane", async ({
    page,
  }) => {
    await openEdit(page, "EditKitOverride");
    const transcript = chip(page, "teams.transcript");
    await expect(transcript.getByTestId("sample-kit-face")).toBeVisible();
    const kitTiles = page.locator(
      `${EDITOR} [data-component-kit="sample-tiles"] [data-testid="sample-kit-tile"]`,
    );
    // The kit's preview gets only the files no chip stands for.
    await expect(kitTiles).toHaveText([
      /supplier-quote-a\.pdf/i,
      /supplier-quote-b\.pdf/i,
    ]);
    await expect(page.locator(TILE)).toHaveCount(0);
    await kitTiles
      .first()
      .getByRole("button", { name: "Remove supplier-quote-a.pdf" })
      .click();
    expect((await submitAndRead(page)).split(",")).toEqual([
      "edit-v1",
      "edit-v1:roadmap",
      "edit-v1:dashboard",
      "user-file-2",
    ]);
  });
});
