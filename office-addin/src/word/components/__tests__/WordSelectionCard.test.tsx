import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
}) {
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
      <WordHostCardRenderer
        language="erato-word-replace"
        content={options.content ?? PROPOSAL}
      />
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

  it("says the passage changed and lets the user ask again about the current selection", async () => {
    const capture = await captureOf(host, { p: "PL1" });
    host.insertText({ p: "PL1", text: "kilo" }, "KILO");
    const { restoreRequest } = renderCard({ capture });
    fireEvent.click(replaceButton()!);
    await screen.findByText(
      "This passage changed after your request. Nothing was replaced.",
    );
    expect(host.paragraphs()[2].text).toContain("KILO");
    fireEvent.click(
      screen.getByRole("button", { name: "Use current selection" }),
    );
    expect(restoreRequest).toHaveBeenCalledWith(REQUEST);
    expect(wordSelectionStore.requestRefresh).toHaveBeenCalledWith({
      rearm: true,
    });
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

  it("says Word could not pinpoint the passage, keeping Copy and Use current selection", async () => {
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
      screen.getByRole("button", { name: "Use current selection" }),
    );
    expect(restoreRequest).toHaveBeenCalledWith(REQUEST);
  });

  it("explains a selection Erato can only use as context and offers no Replace", async () => {
    const capture = await captureOf(host, { p: "MX1", text: "golf" });
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
});
