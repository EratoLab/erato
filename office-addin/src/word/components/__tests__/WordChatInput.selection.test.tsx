import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetOfficeSelectionChangedBrokerForTests } from "../../../hooks/officeSelectionChangedBroker";
import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import { WORD_SELECTION_DEBOUNCE_MS } from "../../hooks/useWordSelection";
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
import type { ReactNode } from "react";

const host = vi.hoisted(() => ({
  facets: [] as { id: string; allowed_args?: string[] }[],
  capture: vi.fn(),
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({ data: { action_facets: host.facets } }),
    Alert: ({ children }: { children: ReactNode }) => (
      <div role="alert">{children}</div>
    ),
  });
});

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
  }: {
    onSendMessage: (message: string) => void;
  }) => (
    <button
      type="button"
      data-testid="send"
      onClick={() => onSendMessage("Shorten this")}
    >
      send
    </button>
  ),
}));

vi.mock("../../hooks/useWordDocumentSource", () => ({
  useWordDocumentSource: () => ({
    preview: { status: "ready", coverage: null, changedSinceLastSend: false },
    capture: host.capture,
  }),
}));

type SendCall = Parameters<AddinChatInputRenderProps["onSendMessage"]>;
type Prepared = Awaited<ReturnType<NonNullable<SendCall[11]>["run"]>>;

const IDENTITY = "https://contoso.sharepoint.com/Shared%20Documents/a.docx";
const SELECTION_FACET = {
  id: "word_selection",
  allowed_args: [...WORD_SELECTION_ARG_KEYS],
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
  const chip = () => screen.queryByTestId("word-selection-chip");
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
  });

  it("shows the selection and sends it with the word_selection facet", async () => {
    await renderInput();
    expect(chip()?.textContent).toContain("lima mike");
    expect(chip()?.textContent).toContain("Selected passage · 1 paragraph");

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

  it("keeps sending the included document, and says the selection is not sent", async () => {
    word.select({ table: 0, tableWhole: true });
    await renderInput();
    fireEvent.click(screen.getByTestId("word-include-document-chip"));
    expect(chip()?.textContent).toContain(
      "Not sent while the document is included.",
    );
    const callsBefore = word.calls().length;

    send();
    expect(lastSend()[11]?.label).toBe("Preparing document…");
    const result = await prepared();
    expect(result?.actionFacet?.id).toBe("word_document_review");
    expect(host.capture).toHaveBeenCalledTimes(1);
    expect(word.calls().slice(callsBefore)).not.toContain("Paragraph.getText");
  });

  it("sends a whole paragraph Erato can replace instead of the included document", async () => {
    word.select({ p: "PL1" });
    await renderInput();
    fireEvent.click(screen.getByTestId("word-include-document-chip"));
    expect(chip()?.textContent).toContain(
      "If this passage can be replaced, it is sent instead of the document.",
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
    await renderInput();
    fireEvent.click(screen.getByTestId("word-include-document-chip"));
    expect(chip()?.textContent).toContain(
      "If this passage can be replaced, it is sent instead of the document.",
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
      word.select(target);
      await renderInput();
      fireEvent.click(screen.getByTestId("word-include-document-chip"));
      expect(chip()?.textContent).toContain(
        "If this passage can be replaced, it is sent instead of the document.",
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

  it("sends the document when the paragraph turns out to be context only", async () => {
    word.select({ p: "MX1" });
    await renderInput();
    fireEvent.click(screen.getByTestId("word-include-document-chip"));
    send();
    const result = await prepared();
    expect(result?.actionFacet?.id).toBe("word_document_review");
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
    expect(screen.getByRole("alert").textContent).toBe(
      "Erato could not read your selection in Word, so your message was not sent. Send it again, or dismiss the selection to send without it.",
    );
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
    expect(chip()?.textContent).toContain("Shown by Erato");

    send();
    expect(lastSend()[11]).toBeUndefined();
    expect(lastSend()[4]).toBeUndefined();

    fireEvent.click(screen.getByText("Use this selection"));
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
    fireEvent.click(screen.getByLabelText("Dismiss selection"));
    act(() => word.select({ p: "MP2", text: "xray" }));
    send();
    const result = await prepared();
    expect(result?.actionFacet?.args?.selected_text).toBe("xray");
  });

  it("keeps a dismissal while a new chat gets its ID, and re-arms in another chat", async () => {
    const view = await renderInput(null);
    fireEvent.click(screen.getByLabelText("Dismiss selection"));
    expect(chip()).toBeNull();
    send();
    expect(lastSend()[11]).toBeUndefined();

    view.rerender(element("chat-new"));
    expect(chip()).toBeNull();
    send();
    expect(lastSend()[11]).toBeUndefined();

    view.rerender(element("chat-other"));
    expect(chip()).not.toBeNull();
  });

  it("re-arms a dismissed chip when the user selects again", async () => {
    await renderInput();
    fireEvent.click(screen.getByLabelText("Dismiss selection"));
    act(() => word.select({ p: "MP3", text: "zulu" }));
    await settle();
    expect(chip()?.textContent).toContain("zulu");
  });
});
