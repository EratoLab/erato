import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { WordChatInput } from "../WordChatInput";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type { MockWordHost } from "../../../test/mocks/word/document";
import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";

const advertised = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({
      data: { action_facets: advertised.ids.map((id) => ({ id })) },
    }),
  });
});

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
  }: {
    onSendMessage: (message: string, inputFileIds?: string[]) => void;
  }) => (
    <button
      type="button"
      data-testid="send"
      onClick={() => onSendMessage("hi")}
    >
      send
    </button>
  ),
}));

type SendCall = Parameters<AddinChatInputRenderProps["onSendMessage"]>;

const BOTH_FACETS = ["word_document_review", "word_compose"];
const IDENTITY =
  "https://contoso.sharepoint.com/Shared%20Documents/report.docx";

describe("WordChatInput", () => {
  let word: MockWordHost;
  let sends: SendCall[];
  let staged: (WordDocumentCapture | null)[];

  const chatInputProps = (chatId: string | null): AddinChatInputRenderProps =>
    ({
      chatId,
      onSendMessage: (...args: SendCall) => sends.push(args),
    }) as unknown as AddinChatInputRenderProps;

  const renderInput = (
    chatId: string | null = "chat-1",
    documentIdentity: string = IDENTITY,
  ) =>
    render(
      <WordChatInput
        chatInputProps={chatInputProps(chatId)}
        documentIdentity={documentIdentity}
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

  const chip = () => screen.getByTestId("word-include-document-chip");
  const send = () => fireEvent.click(screen.getByTestId("send"));
  const lastFacet = () => sends.at(-1)?.[4];
  const lastIdentity = () => sends.at(-1)?.[5];

  beforeEach(() => {
    i18n.activate("en");
    advertised.ids = [...BOTH_FACETS];
    sends = [];
    staged = [];
    word = installMockWordDocument([
      { text: "The Annual Report", styleBuiltIn: "Title" },
      { text: "" },
      { text: "Revenue grew." },
    ]);
  });

  afterEach(() => {
    cleanup();
    uninstallMockWordDocument();
    vi.clearAllMocks();
  });

  it("is off by default and turns on with one gesture", async () => {
    renderInput();

    expect(chip()).toHaveTextContent("Include this document");
    expect(chip()).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chip());

    expect(chip()).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(chip()).toHaveTextContent("Document included"));
  });

  it("is not rendered at all when neither facet is advertised", () => {
    advertised.ids = [];
    renderInput();

    expect(screen.queryByTestId("word-include-document-chip")).toBeNull();
    expect(screen.getByTestId("send")).toBeInTheDocument();
  });

  it("sends with no action facet while the chip is off", async () => {
    renderInput();

    send();

    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()).toBeUndefined();
    expect(lastIdentity()).toBeNull();
    expect(staged).toEqual([null]);
    expect(word.word.run).not.toHaveBeenCalled();
  });

  it("attaches word_document_review and the identity once the chip is on", async () => {
    renderInput();
    fireEvent.click(chip());

    send();

    await waitFor(() => expect(sends).toHaveLength(1));
    const facet = lastFacet();
    expect(facet?.id).toBe("word_document_review");
    expect(facet?.args?.document_text).toBe(
      "[1|H1] The Annual Report\n[3] Revenue grew.",
    );
    expect(facet?.args?.document_name).toBe("report.docx");
    expect(facet?.args?.document_identity).toBe(IDENTITY);
    expect(facet?.args?.paragraphs_sent).toBe("3");
    expect(facet?.args?.paragraphs_total).toBe("3");
    expect(lastIdentity()).toBe(IDENTITY);
    expect(staged.at(-1)?.identity).toBe(IDENTITY);
    expect(staged.at(-1)?.ordinalMap.get(3)).toEqual({
      uniqueLocalId: "id-3",
      text: "Revenue grew.",
    });
    expect([...(staged.at(-1)?.renderedOrdinals ?? [])]).toEqual([1, 3]);
    expect(staged.at(-1)?.partialOrdinal).toBeNull();
  });

  it("attaches word_compose for an empty document", async () => {
    word.word.setParagraphs([{ text: "" }]);
    renderInput();
    fireEvent.click(chip());

    await waitFor(() => expect(chip()).toHaveTextContent("New document"));
    send();

    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()?.id).toBe("word_compose");
    expect(lastFacet()?.args).toEqual({
      document_name: "report.docx",
      document_identity: IDENTITY,
    });
  });

  it("still sends when the document cannot be read", async () => {
    renderInput();
    fireEvent.click(chip());
    word.word.run.mockRejectedValue(new Error("GeneralException"));

    send();

    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()).toBeUndefined();
    expect(lastIdentity()).toBeNull();
    expect(staged.at(-1)).toBeNull();
    await waitFor(() =>
      expect(chip()).toHaveTextContent("Document not included"),
    );
  });

  it("carries the document on every send, unchanged document included", async () => {
    renderInput();
    fireEvent.click(chip());

    send();
    await waitFor(() => expect(sends).toHaveLength(1));
    send();
    await waitFor(() => expect(sends).toHaveLength(2));

    for (const call of sends) {
      const facet = call[4];
      expect(facet?.id).toBe("word_document_review");
      expect(facet?.args?.document_text).toContain("Revenue grew.");
    }
  });

  it("states the coverage in paragraph counts when the window is cut", async () => {
    word.word.setParagraphs(
      Array.from({ length: 200 }, () => ({ text: "x".repeat(1_000) })),
    );
    renderInput();

    fireEvent.click(chip());

    await waitFor(() =>
      expect(chip()).toHaveTextContent(
        /Document included \(first \d+ of 200 paragraphs\)/,
      ),
    );
  });

  it("keeps the chip on when a new chat receives its id on first send", async () => {
    const { rerender } = renderInput(null);
    fireEvent.click(chip());
    expect(chip()).toHaveAttribute("aria-pressed", "true");

    rerender(
      <WordChatInput
        chatInputProps={chatInputProps("chat-created-on-send")}
        documentIdentity={IDENTITY}
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

    expect(chip()).toHaveAttribute("aria-pressed", "true");
    send();
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()?.id).toBe("word_document_review");
  });

  it("resets to off when the chat genuinely changes", () => {
    const { rerender } = renderInput("chat-1");
    fireEvent.click(chip());

    rerender(
      <WordChatInput
        chatInputProps={chatInputProps("chat-2")}
        documentIdentity={IDENTITY}
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

    expect(chip()).toHaveAttribute("aria-pressed", "false");
    expect(chip()).toHaveTextContent("Include this document");
  });

  it("resets to off when the pane's document identity changes", () => {
    const { rerender } = renderInput("chat-1");
    fireEvent.click(chip());

    rerender(
      <WordChatInput
        chatInputProps={chatInputProps("chat-1")}
        documentIdentity="pane-session:11111111-2222-3333-4444-555555555555"
        stagePendingCapture={(capture) => staged.push(capture)}
      />,
    );

    expect(chip()).toHaveAttribute("aria-pressed", "false");
  });

  it("never persists the read gate anywhere", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    renderInput();
    fireEvent.click(chip());
    send();
    await waitFor(() => expect(sends).toHaveLength(1));
    fireEvent.click(chip());

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(word.document.settings.set).not.toHaveBeenCalled();
    expect(word.document.settings.saveAsync).not.toHaveBeenCalled();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});
