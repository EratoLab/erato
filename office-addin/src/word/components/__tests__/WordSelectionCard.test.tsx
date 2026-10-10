import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as frontendMessages } from "../../../../../frontend/src/locales/en/messages.po";
import { TestTheme } from "../../../test/helpers/TestTheme";
import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import { wordSelectionStore } from "../../hooks/wordSelectionStore";
import { WordWriteProvider } from "../../providers/WordWriteProvider";
import {
  WORD_REPLACE_SELECTION_TIMEOUT_MS,
  WORD_REVERT_SELECTION_MS_PER_PARAGRAPH,
  WORD_REVERT_SELECTION_TIMEOUT_MS,
  WORD_WEB_REVERT_MAX_PARAGRAPHS,
} from "../../utils/wordReplaceSelection";
import { emptySelectionCapture } from "../../utils/wordSelectionAnchor";
import {
  captureWordSelection,
  WORD_SELECTION_SPAN_CHECK_MS_PER_PARAGRAPH,
} from "../../utils/wordSelectionCapture";
import { WordHostCardRenderer } from "../WordHostCardRenderer";
import { wordSelectionReasonText } from "../WordSelectionCard";

import type {
  MockSelectionTarget,
  WordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import type { WordSelectionCapture } from "../../utils/wordSelectionAnchor";
import type * as EratoLibrary from "@erato/frontend/library";

const mockUseHostArtifact = vi.fn();
const mockUseChatContext = vi.fn();
const mockUsePersistedState = vi.fn();

vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<typeof EratoLibrary>()),
  ActionConfirmationCard: (props: {
    onAllowOnce: () => void;
    onAlwaysAllow: () => void;
    onDeny: () => void;
  }) => (
    <div data-testid="confirmation-card">
      <button type="button" onClick={props.onAllowOnce}>
        allow-once
      </button>
      <button type="button" onClick={props.onAlwaysAllow}>
        always-allow
      </button>
      <button type="button" onClick={props.onDeny}>
        deny
      </button>
    </div>
  ),
  useChatContext: () => mockUseChatContext(),
  useHostArtifact: () => mockUseHostArtifact(),
  usePersistedState: () => mockUsePersistedState(),
  useConfirmationRegistryStore: (
    selector: (state: {
      registerConfirmation: () => void;
      unregisterConfirmation: () => void;
    }) => unknown,
  ) =>
    selector({
      registerConfirmation: () => {},
      unregisterConfirmation: () => {},
    }),
}));

const IDENTITY = "https://contoso.sharepoint.com/report.docx";
const REPLACE = "word.replace_selection";
const REQUEST = "Make this paragraph shorter.";
const PROPOSAL = "PL1 A shorter plain paragraph.";
let nextMessageId = 0;

async function captureOf(
  host: WordSelectionHost,
  target: MockSelectionTarget,
): Promise<WordSelectionCapture> {
  host.select(target);
  const read = await captureWordSelection();
  if (read.status !== "ok" || !read.value) throw new Error("no capture");
  host.select({ p: "MP2", text: "xray" });
  return emptySelectionCapture(IDENTITY, read.value);
}

function renderCard(options: {
  capture: WordSelectionCapture | null;
  identity?: string;
  presentation?: string;
  decisions?: Record<string, string>;
  proposed?: boolean;
  content?: string;
  /** Several versions in one answer, each its own fence and card. */
  versions?: string[];
}) {
  const versions = options.versions ?? [options.content ?? PROPOSAL];
  nextMessageId += 1;
  const messageId = `assistant-${nextMessageId}`;
  mockUseHostArtifact.mockReturnValue({
    facetId: "word_selection",
    renderMode: "suggestions",
    messageId,
    cardFenceLanguages: ["erato-word-replace"],
    allowedClientActions: [REPLACE],
    clientActionPresentation: options.presentation ?? "render_buttons",
    isFreshCompletion: true,
    itemIdentity: IDENTITY,
    proposedClientAction: options.proposed ? REPLACE : undefined,
  });
  mockUseChatContext.mockReturnValue({
    messages: {
      user: {
        id: "user",
        role: "user",
        content: [{ content_type: "text", text: REQUEST }],
      },
      [messageId]: {
        id: messageId,
        role: "assistant",
        previous_message_id: "user",
        content: [
          {
            content_type: "text",
            text: versions
              .map(
                (version, i) =>
                  `Version ${i + 1}:\n\n\`\`\`erato-word-replace\n${version}\n\`\`\``,
              )
              .join("\n\n"),
          },
        ],
      },
    },
    messageOrder: ["user", messageId],
    currentChatId: "chat-1",
  });
  mockUsePersistedState.mockReturnValue([options.decisions ?? {}, vi.fn()]);
  const restoreRequest = vi.fn();
  const element = (identity: string) => (
    <WordWriteProvider
      documentIdentity={identity}
      capturesByAssistantMessageId={
        new Map(options.capture ? [[messageId, options.capture]] : [])
      }
      restoreRequest={restoreRequest}
    >
      {versions.map((version, i) => (
        <WordHostCardRenderer
          key={i}
          language="erato-word-replace"
          content={version}
        />
      ))}
    </WordWriteProvider>
  );
  const view = render(element(options.identity ?? IDENTITY), {
    wrapper: TestTheme,
  });
  return {
    ...view,
    restoreRequest,
    rerenderFor: (id: string) => view.rerender(element(id)),
  };
}

const replaceButton = () => screen.queryByRole("button", { name: "Replace" });
const card = (index: number) =>
  within(screen.getAllByTestId("word-selection-card")[index]);
const undo = async (index: number) => {
  fireEvent.click(card(index).getByRole("button", { name: "Undo" }));
  fireEvent.click(card(index).getByRole("button", { name: "Restore passage" }));
  await card(index).findByText("Undone: Rewrite of the selected passage");
};

const SHORTER = "PL1 A shorter plain paragraph.";
const BRIEFER = "PL1 A brief plain paragraph.";
const SIBLING_HINT =
  "Another version from this answer is in the document. Undo it to use this one instead.";
const SIBLING_REFUSED =
  "Another version from this answer was applied to this passage. Undo it, then choose Replace again. Nothing was replaced.";
const SIBLING_HINT_WORD =
  "Another version from this answer is in the document. Remove it in Word, for example with Word's own Undo, to use this one instead.";
const SIBLING_REFUSED_WORD =
  "Another version from this answer was applied to this passage. Remove it in Word, for example with Word's own Undo, then choose Replace again. Nothing was replaced.";
const SIBLING_REFUSED_TRACKED =
  "Another version from this answer was applied to this passage. Reject it in Word, then choose Replace again. Nothing was replaced.";
const AMBIGUOUS =
  "This passage now appears more than once, so Erato can't tell which one you meant. Nothing was replaced.";
const askAgain = (index: number) =>
  card(index).queryByRole("button", {
    name: "Ask again with current selection",
  });

describe("WordSelectionCard", () => {
  let host: WordSelectionHost;

  beforeEach(() => {
    i18n.load("en", frontendMessages);
    i18n.activate("en");
    host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    vi.spyOn(wordSelectionStore, "requestRefresh");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallWordSelectionHost();
  });

  it("compares the selection when requested with the proposal and replaces only that paragraph", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    renderCard({ capture });
    expect(
      screen.getByText("Selection when requested → proposed replacement"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Original" }));
    expect(
      screen.getByText(
        "PL1 Plain paragraph kilo lima mike november oscar papa.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(replaceButton()!);
    await screen.findByText("Replaced the selected passage.");
    expect(host.paragraphs()[2].text).toBe(PROPOSAL);
    expect(host.selectionText()).toBe("xray");
    expect(wordSelectionStore.requestRefresh).toHaveBeenCalled();
    expect(screen.getByTestId("word-selection-undo")).toBeInTheDocument();
  });

  it("says the passage changed and puts the request back for the current selection", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    host.insertText({ p: "PL1", text: "kilo" }, "KILO");
    const { restoreRequest } = renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText(
      "This passage changed after your request. Nothing was replaced.",
    );
    expect(host.paragraphs()[2].text).toContain("KILO");
    fireEvent.click(
      screen.getByRole("button", { name: "Ask again with current selection" }),
    );
    expect(restoreRequest).toHaveBeenCalledWith(REQUEST);
    expect(wordSelectionStore.requestRefresh).toHaveBeenCalledWith({
      rearm: true,
    });
    expect(
      screen.getByText(
        "Your request is back in the message box. Select the passage you mean, then send.",
      ),
    ).toBeInTheDocument();
  });

  it("says the passage appears more than once and replaces the copy the user selects with the same proposal", async () => {
    uninstallWordSelectionHost();
    host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      nullParagraphIds: true,
    });
    const capture = await captureOf(host, { p: "PL1" });
    const original = host.paragraphs()[2].text;
    host.insertParagraphs({ p: "PL1" }, [original], "After");
    const { restoreRequest } = renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText(
      "This passage now appears more than once, so Erato can't tell which one you meant. Nothing was replaced.",
    );
    expect(host.writeSyncs()).toEqual([]);
    expect(
      screen.queryByRole("button", {
        name: "Ask again with current selection",
      }),
    ).toBeNull();

    host.select({ paragraph: 3 });
    fireEvent.click(
      screen.getByRole("button", { name: "Replace selected passage" }),
    );
    await screen.findByText("Replaced the selected passage.");
    expect(
      host
        .paragraphs()
        .slice(2, 4)
        .map((p) => p.text),
    ).toEqual([original, PROPOSAL]);
    expect(restoreRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId("word-selection-undo")).toBeInTheDocument();
  });

  it("replaces nothing when the selected text is not exactly the requested passage", async () => {
    uninstallWordSelectionHost();
    host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      nullParagraphIds: true,
    });
    const capture = await captureOf(host, { p: "PL1" });
    host.insertParagraphs({ p: "PL1" }, [host.paragraphs()[2].text], "After");
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText(
      "This passage now appears more than once, so Erato can't tell which one you meant. Nothing was replaced.",
    );
    host.select({ p: "MP2" });
    fireEvent.click(
      screen.getByRole("button", { name: "Replace selected passage" }),
    );
    await screen.findByText(
      "The selected text is not exactly the passage from your request. Nothing was replaced.",
    );
    expect(host.writeSyncs()).toEqual([]);
  });

  it("replaces nothing when only the selected copy has bold the card did not announce", async () => {
    uninstallWordSelectionHost();
    host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      nullParagraphIds: true,
    });
    const capture = await captureOf(host, { p: "PL1" });
    expect(capture.selection).toMatchObject({ role: "rewrite" });
    expect(capture.selection?.flattensEmphasis).toBeUndefined();
    host.insertParagraphs({ p: "PL1" }, [host.paragraphs()[2].text], "After");
    host.format({ paragraph: 3, text: "lima" }, { font: { bold: true } });
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText(
      "This passage now appears more than once, so Erato can't tell which one you meant. Nothing was replaced.",
    );
    expect(
      screen.queryByText(
        "After Replace, bold, italic, underlined or struck-through words in this passage take the paragraph's usual formatting.",
      ),
    ).toBeNull();
    const before = host.paragraphs().slice(2, 4);

    host.select({ paragraph: 3 });
    fireEvent.click(
      screen.getByRole("button", { name: "Replace selected passage" }),
    );
    await screen.findByText(
      "The selected passage has bold, italic, underlined or struck-through words that the passage in your request did not have. Replace would remove that formatting, so nothing was replaced.",
    );
    expect(host.writeSyncs()).toEqual([]);
    expect(host.paragraphs().slice(2, 4)).toEqual(before);
    expect(screen.queryByText("Replaced the selected passage.")).toBeNull();
  });

  it("shows a kept field by its text and replaces around it", async () => {
    const capture = await captureOf(host, { p: "FD1" });
    renderCard({
      capture,
      content: "FD1 Feld vor \u27E61\u27E7 Feld danach.",
    });
    fireEvent.click(screen.getByRole("tab", { name: "Original" }));
    expect(
      screen.getByText("FD1 Field before [2026-10-06] field after words."),
    ).toBeInTheDocument();
    fireEvent.click(replaceButton()!);
    await screen.findByText("Replaced the selected passage.");
    expect(host.paragraphs().find((p) => p.text.startsWith("FD1"))?.text).toBe(
      "FD1 Feld vor 2026-10-06 Feld danach.",
    );
    expect(host.ooxml({ p: "FD1" })).toContain("DATE");
  });

  it("says a proposal that lost a kept item's marker would delete it, and offers no Replace", async () => {
    const capture = await captureOf(host, { p: "FD1" });
    renderCard({ capture, content: "FD1 Feld vor Feld danach." });
    expect(
      screen.getByText(
        "The proposal lost or moved a field, link, note or comment of the passage, so it would delete or misplace it. Nothing was replaced.",
      ),
    ).toBeInTheDocument();
    expect(replaceButton()).toBeNull();
    expect(host.writeSyncs()).toEqual([]);
  });

  it("replaces only the selected passage inside its paragraph", async () => {
    const capture = await captureOf(host, {
      p: "RP1",
      text: "Repeated word one.",
      occ: 1,
    });
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText("Replaced the selected passage.");
    expect(host.paragraphs().find((p) => p.text.startsWith("RP1"))?.text).toBe(
      `RP1 Repeated word one. ${PROPOSAL} Repeated word one.`,
    );
    expect(screen.getByTestId("word-selection-undo")).toBeInTheDocument();
  });

  it("says Word could not pinpoint the passage, keeping Copy and Ask again", async () => {
    const capture = await captureOf(host, { p: "PL1", text: "lima mike" });
    host.onSearch((hits) => [...hits, ...hits]);
    const { restoreRequest } = renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText(
      "Word could not pinpoint the passage inside its paragraph. Nothing was replaced.",
    );
    expect(host.writeSyncs()).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Copy proposal" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Ask again with current selection" }),
    );
    expect(restoreRequest).toHaveBeenCalledWith(REQUEST);
  });

  it("explains a selection Erato can only use as context and offers no Replace", async () => {
    const capture = await captureOf(host, { p: "HT1", text: "after words" });
    renderCard({ capture, proposed: true, presentation: "auto_prompt" });
    expect(
      screen.getByText(
        "This passage holds a link, field, comment, note, picture or other content a rewrite would lose.",
      ),
    ).toBeInTheDocument();
    expect(replaceButton()).toBeNull();
    expect(screen.queryByTestId("confirmation-card")).toBeNull();
    await act(() => Promise.resolve());
    expect(host.writeSyncs()).toEqual([]);
  });

  it.each([
    [
      "whole_table",
      "Select text in one table cell to have it replaced. A selection across several cells is only used as context.",
    ],
    [
      "multi_cell",
      "Select text in one table cell to have it replaced. A selection across several cells is only used as context.",
    ],
    [
      "nested_table",
      "Text in a table inside another table is only used as context.",
    ],
    [
      "cell_multi_paragraph",
      "Select one paragraph in this table cell to have it replaced. Several paragraphs in one cell are only used as context.",
    ],
  ] as const)("explains the table reason %s", (code, text) => {
    expect(wordSelectionReasonText(code)).toBe(text);
  });

  it("says a bookmark, not a link or field, keeps a heading from being replaced", async () => {
    uninstallWordSelectionHost();
    host = installWordSelectionHost(
      {
        body: [
          {
            runs: [
              { text: "H1 Selection probe heading", bookmark: "_Toc938001" },
            ],
            style: "Heading 1",
          },
          ...SV2_MAIN_DOCUMENT.body.slice(1),
        ],
      },
      { ooxmlOmitsBookmarks: true },
    );
    const capture = await captureOf(host, { p: "H1" });
    renderCard({ capture });
    expect(
      screen.getByText(
        "This passage holds a bookmark, such as one a table of contents or a cross-reference uses, which a rewrite could break.",
      ),
    ).toBeInTheDocument();
    expect(replaceButton()).toBeNull();
  });

  it("says where a bookmark inside the selection keeps it from being replaced", () => {
    expect(wordSelectionReasonText("bookmark_cut")).toBe(
      "A bookmark, such as one a cross-reference points to, starts or ends inside this selection, and a rewrite could not tell where it belongs. Select exactly the bookmarked text, or only text before or after it, to have it replaced.",
    );
  });

  it("says superscript or subscript would turn into normal text", () => {
    expect(wordSelectionReasonText("mixed_script")).toBe(
      "This passage has superscript or subscript characters, as in m² or CO₂, which a rewrite would turn into normal text.",
    );
  });

  it("says before Replace that mixed bold or italic takes the paragraph's usual formatting", async () => {
    const hint =
      "After Replace, bold, italic, underlined or struck-through words in this passage take the paragraph's usual formatting.";
    const mixed = await captureOf(host, { p: "MX1" });
    expect(mixed.selection).toMatchObject({
      role: "rewrite",
      flattensEmphasis: true,
    });
    renderCard({
      capture: mixed,
      content:
        "MX1 Alpha \u27E61\u27E7link\u27E6/1\u27E7 golf \u27E62\u27E7 hotel.",
    });
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(replaceButton()).toBeInTheDocument();
    cleanup();
    renderCard({ capture: await captureOf(host, { p: "PL1" }) });
    expect(replaceButton()).toBeInTheDocument();
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("no longer says only whole paragraphs can be replaced for a shape not enabled", () => {
    expect(wordSelectionReasonText("shape_not_enabled")).not.toContain(
      "whole paragraph",
    );
  });

  it("replaces several paragraphs and undoes every one of them after its own warning", async () => {
    const before = host.paragraphs();
    const capture = await captureOf(host, {
      p: "MP1",
      text: "victor whiskey.",
      to: { p: "MP3", text: "MP3 Multi" },
    });
    renderCard({
      capture,
      content: "victor yankee.\nMP2 Changed middle.\nMP3 Several",
    });
    fireEvent.click(replaceButton()!);
    await screen.findByText("Replaced the selected passage.");
    expect(host.paragraphs()[6].text).toBe("MP2 Changed middle.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getByText(
        "Restore every paragraph of the passage as it was before this Replace? Nothing is restored if any of them changed since.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore passage" }));
    await screen.findByText("Undone: Rewrite of the selected passage");
    expect(host.paragraphs().map(({ text, runs }) => ({ text, runs }))).toEqual(
      before.map(({ text, runs }) => ({ text, runs })),
    );
  });

  it("replaces one table cell and leaves the others", async () => {
    const before = host.paragraphs();
    const capture = await captureOf(host, { table: 0, cell: [1, 1] });
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText("Replaced the selected passage.");
    const after = host.paragraphs();
    const cell = after.findIndex((p) => p.text === PROPOSAL);
    expect(after[cell].nesting).toBe(1);
    expect(after.filter((_, i) => i !== cell)).toEqual(
      before.filter((p) => p.text !== "CB2 Cell B2 text"),
    );
  });

  it("offers only Copy when the pane no longer holds the passage", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard({ capture: null });
    expect(
      screen.getByText(
        "This pane no longer holds the passage this answer was written for. Copy the proposal, or select the passage and ask again.",
      ),
    ).toBeInTheDocument();
    expect(replaceButton()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy proposal" }));
    expect(writeText).toHaveBeenCalledWith(PROPOSAL);
    await screen.findByText("Copied the proposal.");
  });

  it("refuses a passage from another document", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    renderCard({
      capture,
      identity: "https://contoso.sharepoint.com/other.docx",
    });
    expect(
      screen.getByText(
        "This answer was written for a passage in another document, so it cannot be replaced here.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    [WORD_WEB_REVERT_MAX_PARAGRAPHS, true],
    [WORD_WEB_REVERT_MAX_PARAGRAPHS + 1, false],
  ] as const)(
    "on the web, offers Erato's Undo after replacing %i paragraphs: %s",
    async (count, offered) => {
      uninstallWordSelectionHost();
      const tags = Array.from(
        { length: count },
        (_, i) => `WP${String(i + 1).padStart(2, "0")}`,
      );
      host = installWordSelectionHost(
        {
          body: [
            "H0 Heading",
            ...tags.map((tag) => `${tag} Body text.`),
            "MP2 xray",
          ],
        },
        { host: "web" },
      );
      const capture = await captureOf(host, {
        p: tags[0],
        to: { p: tags.at(-1)! },
      });
      renderCard({
        capture,
        content: tags.map((tag) => `${tag} Shorter.`).join("\n"),
      });
      fireEvent.click(replaceButton()!);
      await screen.findByText("Replaced the selected passage.");
      expect(host.paragraphs()[count].text).toBe(`${tags.at(-1)} Shorter.`);
      expect(!!screen.queryByTestId("word-selection-undo")).toBe(offered);
      expect(
        !!screen.queryByText(
          `To undo this Replace, use Word's own Undo in the document (Ctrl+Z, or ⌘Z on a Mac). In Word for the web, Erato's Undo covers up to ${WORD_WEB_REVERT_MAX_PARAGRAPHS} paragraphs.`,
        ),
      ).toBe(!offered);
    },
  );

  it("undoes the Replace exactly", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    const before = host.paragraphs()[2];
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText("Replaced the selected passage.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore passage" }));
    await screen.findByText("Undone: Rewrite of the selected passage");
    expect(host.paragraphs()[2]).toMatchObject({
      text: before.text,
      runs: before.runs,
    });
    expect(screen.queryByTestId("word-selection-undo")).toBeNull();
  });

  it("says an Undo Word rejected restored nothing, and keeps Undo", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText("Replaced the selected passage.");
    host.run.mockRejectedValueOnce(new Error("GeneralException"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore passage" }));
    await screen.findByText(
      "Word did not accept the change. The passage was not restored; try Undo again.",
    );
    expect(host.paragraphs()[2].text).toBe(PROPOSAL);
    expect(screen.getByTestId("word-selection-undo")).toBeInTheDocument();
  });

  it("says Word is not responding during a timed-out Undo, then that nothing was restored", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText("Replaced the selected passage.");
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const hang = host.hangSync({ at: host.syncCount() + 1 });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore passage" }));
    await act(async () => {
      await hang.reached;
      await vi.advanceTimersByTimeAsync(
        WORD_REVERT_SELECTION_TIMEOUT_MS +
          WORD_REVERT_SELECTION_MS_PER_PARAGRAPH,
      );
    });
    expect(
      screen.getByText(
        "Word is not responding. Reload the add-in pane if this persists.",
      ),
    ).toBeInTheDocument();
    await act(async () => {
      hang.release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText(
        "Word did not answer in time. The passage was not restored; try Undo again.",
      ),
    ).toBeInTheDocument();
    expect(host.paragraphs()[2].text).toBe(PROPOSAL);
  });

  it("points to Reject in Word under Track Changes and offers no Undo", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    host.setTrackingMode("TrackAll");
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText(
      "Track Changes is on, so the replacement is a tracked change. Reject it in Word to undo it.",
    );
    expect(screen.queryByTestId("word-selection-undo")).toBeNull();
  });

  it("says Word is not responding while a timed-out run still holds the lock", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const hang = host.hangSync({ at: host.syncCount() + 3 });
    renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await act(async () => {
      await hang.reached;
      await vi.advanceTimersByTimeAsync(
        WORD_REPLACE_SELECTION_TIMEOUT_MS +
          WORD_SELECTION_SPAN_CHECK_MS_PER_PARAGRAPH,
      );
    });
    expect(
      screen.getByText(
        "Word is not responding. Reload the add-in pane if this persists.",
      ),
    ).toBeInTheDocument();
    await act(async () => {
      hang.release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText("Word did not answer in time. Nothing was replaced."),
    ).toBeInTheDocument();
    expect(host.writeSyncs()).toEqual([]);
  });

  it("replaces once on its own under Always allow", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    renderCard({
      capture,
      presentation: "auto_prompt",
      proposed: true,
      decisions: { [`word_selection/${REPLACE}`]: "always" },
    });
    await waitFor(() => expect(host.paragraphs()[2].text).toBe(PROPOSAL));
    await screen.findByText("Replaced the selected passage.");
    expect(host.writeSyncs()).toHaveLength(1);
  });

  describe("several versions in one answer", () => {
    it("says another version is in the document, and Replace on it writes nothing and stays available", async () => {
      const capture = await captureOf(host, { p: "PL1" });
      renderCard({ capture, versions: [SHORTER, BRIEFER] });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText("Replaced the selected passage.");
      expect(card(1).getByText(SIBLING_HINT)).toBeInTheDocument();
      expect(card(0).queryByText(SIBLING_HINT)).toBeNull();

      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText(SIBLING_REFUSED);
      expect(host.writeSyncs()).toHaveLength(1);
      expect(host.paragraphs()[2].text).toBe(SHORTER);
      expect(card(1).queryByText(SIBLING_HINT)).toBeNull();
      expect(
        card(1).queryByRole("button", {
          name: "Ask again with current selection",
        }),
      ).toBeNull();
      expect(card(1).getByRole("button", { name: "Replace" })).toBeEnabled();
    });

    it("replaces with another version after the first one's Undo", async () => {
      const capture = await captureOf(host, { p: "PL1" });
      renderCard({ capture, versions: [SHORTER, BRIEFER] });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText("Replaced the selected passage.");
      await undo(0);
      expect(card(1).queryByText(SIBLING_HINT)).toBeNull();
      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText("Replaced the selected passage.");
      expect(host.paragraphs()[2].text).toBe(BRIEFER);
      expect(card(0).getByText(SIBLING_HINT)).toBeInTheDocument();
    });

    it("replaces with a version refused while another was in the document once that one is undone", async () => {
      const capture = await captureOf(host, { p: "PL1" });
      renderCard({ capture, versions: [SHORTER, BRIEFER] });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText("Replaced the selected passage.");
      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText(SIBLING_REFUSED);
      await undo(0);
      expect(card(1).queryByText(SIBLING_REFUSED)).toBeNull();
      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText("Replaced the selected passage.");
      expect(host.paragraphs()[2].text).toBe(BRIEFER);
    });

    it("points to Reject in Word under Track Changes, and replaces once the change is rejected", async () => {
      const capture = await captureOf(host, { p: "PL1" });
      host.setTrackingMode("TrackAll");
      renderCard({ capture, versions: [SHORTER, BRIEFER] });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText("Replaced the selected passage.");
      expect(
        card(1).getByText(
          "Another version from this answer is in the document. Reject it in Word to use this one instead.",
        ),
      ).toBeInTheDocument();
      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText(SIBLING_REFUSED_TRACKED);
      expect(host.writeSyncs()).toHaveLength(1);

      host.rejectAllRevisions();
      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText("Replaced the selected passage.");
    });

    it("keeps Ask again under Track Changes, where Erato cannot undo the other version once Word accepted it", async () => {
      const capture = await captureOf(host, { p: "PL1" });
      host.setTrackingMode("TrackAll");
      const { restoreRequest } = renderCard({
        capture,
        versions: [SHORTER, BRIEFER],
      });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText("Replaced the selected passage.");
      host.acceptAllRevisions();

      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText(SIBLING_REFUSED_TRACKED);
      expect(host.writeSyncs()).toHaveLength(1);
      expect(host.paragraphs()[2].text).toBe(SHORTER);
      expect(card(0).queryByTestId("word-selection-undo")).toBeNull();
      fireEvent.click(askAgain(1)!);
      expect(restoreRequest).toHaveBeenCalledWith(REQUEST);
    });

    it("points to Word's own Undo and keeps Ask again once the other version's Undo was refused for later edits", async () => {
      const capture = await captureOf(host, { p: "PL1" });
      const { restoreRequest } = renderCard({
        capture,
        versions: [SHORTER, BRIEFER],
      });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText("Replaced the selected passage.");
      host.insertText({ p: "PL1", text: "shorter" }, "SHORTER");
      fireEvent.click(card(0).getByRole("button", { name: "Undo" }));
      fireEvent.click(card(0).getByRole("button", { name: "Restore passage" }));
      await card(0).findByText(
        "The passage changed after it was replaced. Undo was not run because it would remove later edits.",
      );
      expect(card(1).getByText(SIBLING_HINT_WORD)).toBeInTheDocument();

      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText(SIBLING_REFUSED_WORD);
      expect(host.writeSyncs()).toHaveLength(1);
      expect(card(1).getByRole("button", { name: "Replace" })).toBeEnabled();
      fireEvent.click(askAgain(1)!);
      expect(restoreRequest).toHaveBeenCalledWith(REQUEST);
    });

    it("without paragraph IDs, refuses another version rather than offer a copy elsewhere, and replaces after the first one's Undo", async () => {
      uninstallWordSelectionHost();
      host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        nullParagraphIds: true,
      });
      const original = host.paragraphs()[2].text;
      host.insertParagraphs({ p: "MP3" }, [original], "After");
      const capture = await captureOf(host, { paragraph: 2 });
      renderCard({ capture, versions: [SHORTER, BRIEFER] });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText("Replaced the selected passage.");

      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText(SIBLING_REFUSED);
      expect(host.writeSyncs()).toHaveLength(1);
      expect(host.paragraphs()[8].text).toBe(original);
      expect(
        card(1).queryByRole("button", { name: "Replace selected passage" }),
      ).toBeNull();
      expect(askAgain(1)).toBeNull();

      await undo(0);
      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText("Replaced the selected passage.");
      expect([host.paragraphs()[2].text, host.paragraphs()[8].text]).toEqual([
        BRIEFER,
        original,
      ]);
    });

    it("keeps another version's pick when the first was written onto a copy the user picked", async () => {
      uninstallWordSelectionHost();
      host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        nullParagraphIds: true,
      });
      const capture = await captureOf(host, { p: "PL1" });
      const original = host.paragraphs()[2].text;
      host.insertParagraphs({ p: "PL1" }, [original, original], "After");
      renderCard({ capture, versions: [SHORTER, BRIEFER] });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText(AMBIGUOUS);
      host.select({ paragraph: 3 });
      fireEvent.click(
        card(0).getByRole("button", { name: "Replace selected passage" }),
      );
      await card(0).findByText("Replaced the selected passage.");
      expect(card(1).queryByText(SIBLING_HINT)).toBeNull();

      fireEvent.click(card(1).getByRole("button", { name: "Replace" }));
      await card(1).findByText(AMBIGUOUS);
      host.select({ paragraph: 4 });
      fireEvent.click(
        card(1).getByRole("button", { name: "Replace selected passage" }),
      );
      await card(1).findByText("Replaced the selected passage.");
      expect(
        host
          .paragraphs()
          .slice(2, 5)
          .map((p) => p.text),
      ).toEqual([original, SHORTER, BRIEFER]);
    });

    it.each([
      [1, true],
      [2, false],
    ] as const)(
      "under Always allow, with %i version(s), replaces on its own: %s",
      async (count, written) => {
        const capture = await captureOf(host, { p: "PL1" });
        renderCard({
          capture,
          versions: [SHORTER, BRIEFER].slice(0, count),
          presentation: "auto_prompt",
          proposed: true,
          decisions: { [`word_selection/${REPLACE}`]: "always" },
        });
        if (written) {
          await screen.findByText("Replaced the selected passage.");
          expect(host.paragraphs()[2].text).toBe(SHORTER);
        } else {
          await act(() => Promise.resolve());
          expect(host.writeSyncs()).toEqual([]);
          expect(
            screen.getAllByRole("button", { name: "Replace" }),
          ).toHaveLength(2);
        }
      },
    );

    it.each([
      [1, true],
      [2, false],
    ] as const)(
      "under ask, with %i version(s), opens the confirmation on its own: %s",
      async (count, opened) => {
        const capture = await captureOf(host, { p: "PL1" });
        renderCard({
          capture,
          versions: [SHORTER, BRIEFER].slice(0, count),
          presentation: "auto_prompt",
          proposed: true,
        });
        await act(() => Promise.resolve());
        expect(!!screen.queryByTestId("confirmation-card")).toBe(opened);
        expect(host.writeSyncs()).toEqual([]);
      },
    );

    it("replaces again with the same version after its own Undo", async () => {
      const capture = await captureOf(host, { p: "PL1" });
      renderCard({ capture });
      fireEvent.click(replaceButton()!);
      await screen.findByText("Replaced the selected passage.");
      await undo(0);
      fireEvent.click(replaceButton()!);
      await screen.findByText("Replaced the selected passage.");
      expect(host.paragraphs()[2].text).toBe(PROPOSAL);
      expect(screen.getByTestId("word-selection-undo")).toBeInTheDocument();
    });

    it("shows identical versions as one: both replaced, both undone, and the other version applies after", async () => {
      const capture = await captureOf(host, { p: "PL1" });
      renderCard({ capture, versions: [SHORTER, SHORTER, BRIEFER] });
      fireEvent.click(card(0).getByRole("button", { name: "Replace" }));
      await card(0).findByText("Replaced the selected passage.");
      expect(
        card(1).getByText("Replaced the selected passage."),
      ).toBeInTheDocument();
      expect(card(2).getByText(SIBLING_HINT)).toBeInTheDocument();

      await undo(1);
      expect(
        card(0).getByText("Undone: Rewrite of the selected passage"),
      ).toBeInTheDocument();
      fireEvent.click(card(2).getByRole("button", { name: "Replace" }));
      await card(2).findByText("Replaced the selected passage.");
      expect(host.paragraphs()[2].text).toBe(BRIEFER);
      expect(card(0).getByText(SIBLING_HINT)).toBeInTheDocument();
      expect(card(1).getByText(SIBLING_HINT)).toBeInTheDocument();
    });
  });
});
