import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_FACET_ARG_MAX_BYTES } from "../../../core/clientActions/actionFacetArgs";
import { __resetOfficeSelectionChangedBrokerForTests } from "../../../hooks/officeSelectionChangedBroker";
import { ContextLaneDouble } from "../../../test/helpers/contextLaneDouble";
import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import { WORD_SELECTION_DEBOUNCE_MS } from "../../hooks/useWordSelection";
import { wordContextStore } from "../../hooks/wordContextStore";
import { wordSelectionStore } from "../../hooks/wordSelectionStore";
import {
  markProgrammaticWordSelection,
  resetProgrammaticWordSelectionForTests,
} from "../../utils/wordProgrammaticSelection";
import { WORD_SELECTION_ARG_KEYS } from "../../utils/wordSelectionArgs";
import { WORD_SELECTION_CAPTURE_TIMEOUT_MS } from "../../utils/wordSelectionCapture";
import { WordChatInput } from "../WordChatInput";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type { WordSelectionHost } from "../../../test/mocks/word/selectionHost";
import type { WordDocumentBuild } from "../../utils/buildWordDocumentArgs";
import type { WordSelectionCapture } from "../../utils/wordSelectionAnchor";
import type { ComposerContextItem } from "@erato/frontend/library";

const host = vi.hoisted(() => ({
  facets: [] as { id: string; allowed_args?: string[] }[],
  includeDocument: false,
  capture: vi.fn(),
  captureExpectedSlow: vi.fn(() => false),
  items: [] as ComposerContextItem[],
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  const { AlertMock } = await import("../../../test/helpers/contextLaneDouble");
  return mock.createEratoLibraryMock({
    useFacets: () => ({ data: { action_facets: host.facets } }),
    Alert: AlertMock,
  });
});

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
    contextItems,
  }: {
    onSendMessage: (message: string) => void;
    contextItems?: ComposerContextItem[];
  }) => {
    host.items = contextItems ?? [];
    return (
      <>
        <ContextLaneDouble items={contextItems} />
        <button
          type="button"
          data-testid="send"
          onClick={() => onSendMessage("Shorten this")}
        >
          send
        </button>
      </>
    );
  },
}));

vi.mock("../../hooks/useWordDocumentSource", () => ({
  useWordDocumentSource: () => ({
    // As a read leaves it: an included document has content.
    preview: {
      status: "included",
      coverage: {
        paragraphsSent: 1,
        paragraphsTotal: 1,
        truncated: false,
        partialParagraph: false,
        hasContent: true,
      },
      changedSinceLastSend: false,
      reading: false,
    },
    capture: host.capture,
    captureExpectedSlow: host.captureExpectedSlow,
    previousCapture: () => null,
    markSent: () => {},
    retry: () => {},
  }),
}));

vi.mock("../../wordPreferences", () => ({
  useWordIncludeDocumentByDefault: () => [host.includeDocument, () => {}],
  useWordCommentPrecedence: () => ["selection", () => {}],
}));

type SendCall = Parameters<AddinChatInputRenderProps["onSendMessage"]>;
type Prepared = Awaited<ReturnType<NonNullable<SendCall[11]>["run"]>>;

const IDENTITY = "https://contoso.sharepoint.com/Shared%20Documents/a.docx";
// As deployed before ERMAIN-951 advertises comments.
const SELECTION_FACET = {
  id: "word_selection",
  allowed_args: WORD_SELECTION_ARG_KEYS.filter(
    (key) => key !== "anchored_comments",
  ),
};
const REVIEW_FACET = { id: "word_document_review" };

const documentBuild = (): WordDocumentBuild =>
  ({
    args: {
      document_text: "[1] Text",
      heading_outline: "",
      paragraphs_sent: "1",
      paragraphs_total: "1",
      truncation_note: "",
    },
    coverage: { hasContent: true, paragraphsSent: 1 },
    ordinalMap: new Map(),
    headings: new Map(),
    renderedOrdinals: new Set([1]),
    partialOrdinal: null,
  }) as unknown as WordDocumentBuild;

describe("WordChatInput with a Word selection", () => {
  let word: WordSelectionHost;
  let handedOver: SendCall[];
  let staged: (WordSelectionCapture | null)[];

  const props = (chatId: string | null): AddinChatInputRenderProps =>
    ({
      chatId,
      onSendMessage: (...args: SendCall) => handedOver.push(args),
    }) as unknown as AddinChatInputRenderProps;
  const element = (chatId: string | null = "chat-1", identity = IDENTITY) => (
    <WordChatInput
      chatInputProps={props(chatId)}
      documentIdentity={identity}
      stagePendingCapture={(capture) => staged.push(capture)}
    />
  );
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(WORD_SELECTION_DEBOUNCE_MS);
    });
  const renderInput = async (chatId: string | null = "chat-1") => {
    const view = render(element(chatId));
    await settle();
    return view;
  };
  const chip = () => screen.queryByTestId("context-chip-word.selection");
  const meta = (element: HTMLElement | null) =>
    element && within(element).queryByTestId("context-chip-meta")?.textContent;
  const selectionDetail = () =>
    screen.getByTestId("context-detail-word.selection");
  const documentChip = () => screen.getByTestId("context-chip-word.document");
  const documentDetail = () =>
    screen.getByTestId("context-detail-word.document");
  const press = (element: HTMLElement | null, name: string) =>
    fireEvent.click(within(element!).getByRole("button", { name }));
  const send = () => fireEvent.click(screen.getByTestId("send"));
  const lastSend = () => {
    const call = handedOver.at(-1);
    if (!call) throw new Error("nothing was sent");
    return call;
  };
  const prepared = async (): Promise<Prepared> => {
    const prepare = lastSend()[11];
    if (!prepare) throw new Error("the send was not prepared");
    let result: Prepared = null;
    await act(async () => {
      result = await prepare.run(new AbortController().signal);
    });
    return result;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    i18n.activate("en");
    host.facets = [SELECTION_FACET, REVIEW_FACET];
    host.includeDocument = false;
    host.capture.mockReset().mockResolvedValue(documentBuild());
    handedOver = [];
    staged = [];
    word = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    word.select({ p: "PL1", text: "lima mike" });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    uninstallWordSelectionHost();
    __resetOfficeSelectionChangedBrokerForTests();
    resetProgrammaticWordSelectionForTests();
    wordSelectionStore.resetForTests();
    wordContextStore.resetForTests();
  });

  it("shows the selection in the lane and sends it with the word_selection facet", async () => {
    await renderInput();
    expect(chip()).toHaveAttribute("data-state", "included");
    expect(within(chip()!).getByTestId("context-chip-label")).toHaveTextContent(
      "“lima mike”",
    );
    expect(meta(chip())).toBe("Selected passage · 1 ¶");
    expect(screen.queryByTestId("word-selection-chip")).toBeNull();

    send();
    expect(lastSend()[11]?.label).toBe("Reading selection…");
    const result = await prepared();
    expect(result).toEqual({
      actionFacet: {
        id: "word_selection",
        args: expect.objectContaining({
          selected_text: "lima mike",
          selection_role: "rewrite",
          context_reason: "",
          selection_shape: "inline",
          paragraph_count: "1",
          document_identity: IDENTITY,
        }),
      },
      hostContextIdentity: IDENTITY,
    });
    expect(staged.at(-1)).toMatchObject({
      identity: IDENTITY,
      paragraphsSent: 0,
      selection: { selectedText: "lima mike", origin: "user" },
    });
    expect(host.capture).not.toHaveBeenCalled();
  });

  it("sends exactly as before when word_selection is not advertised", async () => {
    host.facets = [REVIEW_FACET];
    await renderInput();
    expect(chip()).toBeNull();
    expect(word.addHandlerAsync).not.toHaveBeenCalled();
    send();
    expect(lastSend()[4]).toBeUndefined();
    expect(lastSend()[11]).toBeUndefined();
    expect(staged).toEqual([null]);
  });

  it("offers no chip when the facet cannot carry the selected text", async () => {
    host.facets = [{ id: "word_selection", allowed_args: ["document_name"] }];
    await renderInput();
    expect(chip()).toBeNull();
  });

  it("sends a selection that can only be context instead of the included document", async () => {
    host.includeDocument = true;
    word.select({ table: 0, tableWhole: true });
    await renderInput();
    expect(
      within(selectionDetail()).getByText("Sent instead of the document."),
    ).toBeInTheDocument();
    expect(documentChip()).toHaveAttribute("data-state", "superseded");
    expect(meta(documentChip())).toBe("Replaced by selection");

    send();
    expect(lastSend()[11]?.label).toBe("Reading selection…");
    const result = await prepared();
    expect(result?.actionFacet).toMatchObject({
      id: "word_selection",
      args: { selection_role: "context_only" },
    });
    expect(result?.hostContextIdentity).toBe(IDENTITY);
    expect(host.capture).not.toHaveBeenCalled();
  });

  it("sends a whole paragraph Erato can replace instead of the included document", async () => {
    host.includeDocument = true;
    word.select({ p: "PL1" });
    await renderInput();
    expect(selectionDetail()).toHaveTextContent(
      "Sent instead of the document.",
    );
    send();
    const result = await prepared();
    expect(result?.actionFacet).toMatchObject({
      id: "word_selection",
      args: { selection_role: "rewrite", selection_shape: "paragraph" },
    });
    expect(host.capture).not.toHaveBeenCalled();
  });

  it("sends a passage inside a paragraph instead of the included document", async () => {
    host.includeDocument = true;
    await renderInput();
    expect(selectionDetail()).toHaveTextContent(
      "Sent instead of the document.",
    );
    send();
    const result = await prepared();
    expect(result?.actionFacet).toMatchObject({
      id: "word_selection",
      args: {
        selected_text: "lima mike",
        selection_role: "rewrite",
        selection_shape: "inline",
      },
    });
    expect(host.capture).not.toHaveBeenCalled();
  });

  it.each([
    [
      "several paragraphs",
      { p: "MP1", text: "whiskey.", to: { p: "MP2", text: "MP2 Multi" } },
      "multi_paragraph",
    ],
    ["a table cell", { table: 0, cell: [1, 1] }, "table_cell"],
  ] as const)(
    "sends %s Erato can replace instead of the included document",
    async (_, target, shape) => {
      host.includeDocument = true;
      word.select(target);
      await renderInput();
      expect(selectionDetail()).toHaveTextContent(
        "Sent instead of the document.",
      );
      send();
      const result = await prepared();
      expect(result?.actionFacet).toMatchObject({
        id: "word_selection",
        args: { selection_role: "rewrite", selection_shape: shape },
      });
      expect(host.capture).not.toHaveBeenCalled();
    },
  );

  it("sends a paragraph that turns out to be context only instead of the included document", async () => {
    host.includeDocument = true;
    word.select({ p: "HT1" });
    await renderInput();
    send();
    const result = await prepared();
    expect(result?.actionFacet).toMatchObject({
      id: "word_selection",
      args: { selection_role: "context_only" },
    });
    expect(host.capture).not.toHaveBeenCalled();
  });

  it("supersedes the document while the selection goes, until the selection is dismissed", async () => {
    host.includeDocument = true;
    await renderInput();
    expect(documentChip()).toHaveAttribute("data-state", "superseded");
    expect(meta(documentChip())).toBe("Replaced by selection");
    expect(documentDetail()).toHaveTextContent(
      "Your selection is sent instead of the document",
    );

    press(chip(), "Dismiss selection");

    expect(chip()).toHaveAttribute("data-state", "suggested");
    expect(documentChip()).toHaveAttribute("data-state", "included");
    expect(meta(documentChip())).toBe("1 ¶");
    send();
    const result = await prepared();
    expect(result?.actionFacet?.id).toBe("word_document_review");
    expect(host.capture).toHaveBeenCalledTimes(1);
  });

  it("sends the included document rather than a passage Erato selected", async () => {
    host.includeDocument = true;
    await renderInput();
    markProgrammaticWordSelection();
    act(() => word.select({ p: "MP1", text: "victor" }));
    await settle();
    expect(chip()).toHaveAttribute("data-state", "suggested");
    expect(meta(chip())).toBe("Shown by Erato · 1 ¶");
    expect(selectionDetail()).not.toHaveTextContent(
      "Sent instead of the document.",
    );
    expect(documentChip()).toHaveAttribute("data-state", "included");

    send();
    const result = await prepared();
    expect(result?.actionFacet?.id).toBe("word_document_review");
  });

  it("says a selection too long to send whole is cut, also while the document is included", async () => {
    host.includeDocument = true;
    word = installWordSelectionHost({
      body: [`BIG ${"lorem ipsum ".repeat(6_000)}`],
    });
    word.select({ p: "BIG" });
    await renderInput();

    expect(chip()).toHaveAttribute("data-state", "included");
    expect(chip()).toHaveAttribute("data-tone", "warning");
    expect(meta(chip())).toBe("Too long · beginning only");
    expect(selectionDetail()).toHaveTextContent(
      "Too long to send in full. Only the beginning is sent.",
    );
    expect(selectionDetail()).toHaveTextContent(
      "Sent instead of the document.",
    );
  });

  it("sends a plain message when the selection collapsed before Send", async () => {
    await renderInput();
    word.select({ p: "PL1", collapse: "End" }, { event: false });
    expect(chip()).not.toBeNull();
    send();
    expect(await prepared()).toEqual({
      actionFacet: undefined,
      hostContextIdentity: null,
    });
    expect(staged.at(-1)).toBeNull();
  });

  it("sends the included document when the selection collapsed before Send", async () => {
    host.includeDocument = true;
    await renderInput();
    word.select({ p: "PL1", collapse: "End" }, { event: false });
    send();
    const result = await prepared();
    expect(result?.actionFacet?.id).toBe("word_document_review");
    expect(result?.hostContextIdentity).toBe(IDENTITY);
    expect(host.capture).toHaveBeenCalledTimes(1);
  });

  it("sends the selection made at Send, not the one the chip showed", async () => {
    await renderInput();
    word.select({ p: "MP1", text: "victor whiskey" }, { event: false });
    send();
    const result = await prepared();
    expect(result?.actionFacet?.args?.selected_text).toBe("victor whiskey");
  });

  it("reads a selection whose chip is still pending at Send", async () => {
    await renderInput();
    act(() => word.select({ p: "MP2", text: "xray" }));
    send();
    const result = await prepared();
    expect(result?.actionFacet?.args?.selected_text).toBe("xray");
  });

  it("drops the send and says so when Word does not answer", async () => {
    await renderInput();
    word.hangSync();
    send();
    const prepare = lastSend()[11]!;
    let result: Promise<Prepared> | undefined;
    act(() => {
      result = prepare.run(new AbortController().signal);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORD_SELECTION_CAPTURE_TIMEOUT_MS);
    });
    expect(await result).toBeNull();
    expect(
      within(screen.getByTestId("word-one-off-rows")).getByRole("alert")
        .textContent,
    ).toBe(
      "Erato could not read your selection in Word, so your message was not sent. Send it again, or dismiss the selection to send without it.",
    );
    expect(chip()).toHaveAttribute("data-state", "error");
    expect(meta(chip())).toBe("Couldn't read · send again");
    act(() => prepare.onAbandoned?.());
    expect(staged.at(-1)).toBeNull();
  });

  it("drops the send when the document changes while the selection is read", async () => {
    const view = await renderInput();
    const hang = word.hangSync();
    send();
    let result: Promise<Prepared> | undefined;
    act(() => {
      result = lastSend()[11]!.run(new AbortController().signal);
    });
    await hang.reached;
    view.rerender(element("chat-1", "pane-session:another"));
    hang.release();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(await result).toBeNull();
  });

  it("does not send a passage Erato selected until the user takes it over", async () => {
    await renderInput();
    markProgrammaticWordSelection();
    act(() => word.select({ p: "MP1", text: "victor" }));
    await settle();
    expect(chip()?.textContent).toContain("victor");
    expect(meta(chip())).toBe("Shown by Erato · 1 ¶");
    expect(
      within(chip()!).queryByRole("button", { name: "Dismiss selection" }),
    ).toBeNull();

    send();
    expect(lastSend()[11]).toBeUndefined();
    expect(lastSend()[4]).toBeUndefined();

    press(chip(), "Use this selection");
    expect(chip()).toHaveAttribute("data-state", "included");
    send();
    const result = await prepared();
    expect(result?.actionFacet?.args?.selected_text).toBe("victor");
  });

  it("never sends the passage Erato is about to select as the user's", async () => {
    await renderInput();
    act(() => {
      markProgrammaticWordSelection();
    });
    word.select({ p: "MP1", text: "victor" }, { event: false });
    send();
    expect(lastSend()[11]).toBeUndefined();
    expect(lastSend()[4]).toBeUndefined();
  });

  it("reads a new selection at Send while the old one is still dismissed", async () => {
    await renderInput();
    press(chip(), "Dismiss selection");
    act(() => word.select({ p: "MP2", text: "xray" }));
    send();
    const result = await prepared();
    expect(result?.actionFacet?.args?.selected_text).toBe("xray");
  });

  it("keeps a dismissal while a new chat gets its ID, and re-arms in another chat", async () => {
    const view = await renderInput(null);
    press(chip(), "Dismiss selection");
    expect(chip()).toHaveAttribute("data-state", "suggested");
    expect(chip()).toHaveAttribute("data-dismiss-scope", "selection");
    send();
    expect(lastSend()[11]).toBeUndefined();

    view.rerender(element("chat-new"));
    expect(chip()).toHaveAttribute("data-state", "suggested");
    send();
    expect(lastSend()[11]).toBeUndefined();

    view.rerender(element("chat-other"));
    expect(chip()).toHaveAttribute("data-state", "included");
  });

  it("re-arms a dismissed chip when the user selects again", async () => {
    await renderInput();
    press(chip(), "Dismiss selection");
    act(() => word.select({ p: "MP3", text: "zulu" }));
    await settle();
    expect(chip()?.textContent).toContain("zulu");
    expect(chip()).toHaveAttribute("data-state", "included");
  });

  it("hands the lane the selection with the host's words", async () => {
    host.includeDocument = true;
    await renderInput();
    const [selection, document] = host.items;
    expect(selection).toMatchObject({
      id: "word-selection",
      kind: "word.selection",
      origin: "ambient",
      dismissScope: "selection",
      icon: "selection",
      label: "“lima mike”",
      spokenLabel: "Selection",
      state: "included",
      removeLabel: "Dismiss selection",
      // Read by the lane from the chip a + lands on.
      announcements: {
        restored: "Selection included. It is sent instead of the document.",
      },
      detail: { title: "Selected passage" },
    });
    expect(document).toMatchObject({
      id: "word-document",
      state: "superseded",
      detail: {
        actions: [
          {
            id: "send-instead",
            label: "Send this instead",
            variant: "primary",
            announcement:
              "Document included. Your selection is off until it changes.",
          },
        ],
      },
    });
  });

  it("sends the document instead from its detail, and leaves the selection off until it changes", async () => {
    host.includeDocument = true;
    await renderInput();

    press(documentDetail(), "Send this instead");

    expect(chip()).toHaveAttribute("data-state", "suggested");
    expect(documentChip()).toHaveAttribute("data-state", "included");
    send();
    const result = await prepared();
    expect(result?.actionFacet?.id).toBe("word_document_review");
    expect(host.capture).toHaveBeenCalledTimes(1);

    act(() => word.select({ p: "MP3", text: "zulu" }));
    await settle();
    expect(chip()).toHaveAttribute("data-state", "included");
    expect(documentChip()).toHaveAttribute("data-state", "superseded");
  });

  it("offers no Send this instead on a locked document, and keeps the selection's (x)", async () => {
    host.includeDocument = true;
    render(
      <WordChatInput
        chatInputProps={{ ...props("chat-1"), disabled: true }}
        documentIdentity={IDENTITY}
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );
    await settle();

    expect(documentChip()).toHaveAttribute("data-state", "superseded");
    expect(documentChip()).toHaveAttribute("data-locked", "true");
    expect(host.items[1].detail?.actions).toBeUndefined();
    expect(
      within(documentDetail()).queryByRole("button", {
        name: "Send this instead",
      }),
    ).toBeNull();

    press(chip(), "Dismiss selection");
    expect(chip()).toHaveAttribute("data-state", "suggested");
    expect(documentChip()).toHaveAttribute("data-state", "included");
  });

  it("marks where a passage over the send limit stops, and says how much of it goes", async () => {
    const tags = Array.from({ length: 14 }, (_, index) => `CL${index + 1}`);
    const clause = "lorem ipsum ".repeat(500);
    word = installWordSelectionHost({
      body: tags.map((tag) => `${tag} ${clause}`),
    });
    word.select({ p: tags[0], to: { p: tags.at(-1)! } });
    await renderInput();

    const sentLines = Math.floor(
      ACTION_FACET_ARG_MAX_BYTES / (`${tags[0]} ${clause}`.length + 1),
    );
    expect(sentLines).toBeLessThan(tags.length);
    expect(chip()).toHaveAttribute("data-tone", "warning");
    expect(host.items[0]).toMatchObject({ toneIcon: "tone" });
    const quote = selectionDetail().querySelector(
      '[data-ui="word-context-detail-quote"]',
    );
    expect(quote?.textContent?.endsWith("…")).toBe(true);
    expect(quote?.textContent).not.toContain(tags.at(-1));
    expect(selectionDetail()).toHaveTextContent(
      `Erato receives the first ${sentLines} of 14 paragraphs.`,
    );
  });

  it("shows the whole passage in the detail, beyond what the label shows", async () => {
    const long = `LONG ${"word ".repeat(120)}end`;
    word = installWordSelectionHost({ body: [long] });
    word.select({ p: "LONG" });
    await renderInput();

    const label =
      within(chip()!).getByTestId("context-chip-label").textContent ?? "";
    expect(Array.from(label.slice(1, -1)).length).toBeLessThanOrEqual(61);
    expect(label.endsWith("…”")).toBe(true);
    expect(
      selectionDetail().querySelector('[data-ui="word-context-detail-quote"]')
        ?.textContent,
    ).toBe(long);
  });

  it("brings a dismissed selection back when the host re-reads it as the user's", async () => {
    await renderInput();
    press(chip(), "Dismiss selection");
    expect(chip()).toHaveAttribute("data-state", "suggested");

    act(() => wordSelectionStore.requestRefresh({ rearm: true }));

    expect(chip()).toHaveAttribute("data-state", "included");
  });

  describe("a selection Word did not hand over", () => {
    const failRead = async () => {
      word.hangSync();
      send();
      const prepare = lastSend()[11]!;
      let result: Promise<Prepared> | undefined;
      act(() => {
        result = prepare.run(new AbortController().signal);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WORD_SELECTION_CAPTURE_TIMEOUT_MS);
      });
      expect(await result).toBeNull();
      act(() => prepare.onAbandoned?.());
    };

    it("marks that selection, and reads a new one afresh", async () => {
      await renderInput();
      await failRead();
      expect(chip()).toHaveAttribute("data-state", "error");
      expect(chip()).toHaveAttribute("data-tone", "error");

      act(() => word.select({ p: "MP3", text: "zulu" }));
      await settle();

      expect(chip()).toHaveAttribute("data-state", "included");
      // The row is a one-off prompt for the failed Send: it stays until the next one.
      expect(screen.getByTestId("word-one-off-rows")).toHaveTextContent(
        "Erato could not read your selection in Word",
      );
    });

    it("forgets the failure once the chip is dismissed", async () => {
      await renderInput();
      await failRead();

      press(chip(), "Dismiss selection");
      expect(chip()).toHaveAttribute("data-state", "suggested");
      press(chip(), "Include selection");

      expect(chip()).toHaveAttribute("data-state", "included");
    });
  });

  describe("agrees with what Send carries", () => {
    it.each([
      [
        "a selection with the document",
        true,
        "user",
        "included",
        "superseded",
        "word_selection",
      ],
      [
        "a dismissed selection with the document",
        true,
        "dismissed",
        "suggested",
        "included",
        "word_document_review",
      ],
      [
        "Erato's passage with the document",
        true,
        "erato",
        "suggested",
        "included",
        "word_document_review",
      ],
      [
        "a selection with the document off",
        false,
        "user",
        "included",
        "suggested",
        "word_selection",
      ],
      [
        "a dismissed selection with the document off",
        false,
        "dismissed",
        "suggested",
        "suggested",
        undefined,
      ],
    ] as const)(
      "%s",
      async (
        _,
        includeDocument,
        passage,
        selectionState,
        documentState,
        facet,
      ) => {
        host.includeDocument = includeDocument;
        await renderInput();
        if (passage === "dismissed") press(chip(), "Dismiss selection");
        if (passage === "erato") {
          markProgrammaticWordSelection();
          act(() => word.select({ p: "MP1", text: "victor" }));
          await settle();
        }
        expect(chip()).toHaveAttribute("data-state", selectionState);
        expect(documentChip()).toHaveAttribute("data-state", documentState);

        send();
        const actionFacet = lastSend()[11]
          ? (await prepared())?.actionFacet
          : lastSend()[4];
        expect(actionFacet?.id).toBe(facet);
      },
    );
  });
});
