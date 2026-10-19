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
import type { WordDocumentCapture } from "@erato/frontend/word-review";

const advertised = vi.hoisted(() => ({ ids: [] as string[] }));
const preferences = vi.hoisted(() => ({
  includeByDefault: true,
  setIncludeByDefault: vi.fn(),
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({
      data: { action_facets: advertised.ids.map((id) => ({ id })) },
    }),
  });
});

vi.mock("../../wordPreferences", () => ({
  useWordIncludeDocumentByDefault: () => [
    preferences.includeByDefault,
    preferences.setIncludeByDefault,
  ],
  useWordCommentPrecedence: () => ["selection", () => {}],
}));

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
  let handedOver: SendCall[];
  let staged: (WordDocumentCapture | null)[];

  // Mirrors AddinChatCore: a prepared send reaches the server with the facet
  // and identity its preparation resolved.
  const chatInputProps = (chatId: string | null): AddinChatInputRenderProps =>
    ({
      chatId,
      onSendMessage: (...args: SendCall) => {
        handedOver.push(args);
        const prepare = args[11];
        if (!prepare) {
          sends.push(args);
          return;
        }
        void prepare.run(new AbortController().signal).then((prepared) => {
          if (!prepared) {
            prepare.onAbandoned?.();
            return;
          }
          const effective = [...args] as SendCall;
          effective[4] = prepared.actionFacet;
          effective[5] = prepared.hostContextIdentity;
          effective[11] = undefined;
          sends.push(effective);
        });
      },
    }) as unknown as AddinChatInputRenderProps;

  const element = (
    chatId: string | null = "chat-1",
    documentIdentity: string = IDENTITY,
  ) => (
    <WordChatInput
      chatInputProps={chatInputProps(chatId)}
      documentIdentity={documentIdentity}
      stagePendingCapture={(capture) => staged.push(capture)}
    />
  );
  const renderInput = (
    chatId: string | null = "chat-1",
    documentIdentity: string = IDENTITY,
  ) => render(element(chatId, documentIdentity));

  const chip = () => screen.getByTestId("word-include-document-chip");
  const excludeButton = () => screen.queryByTestId("word-exclude-document");
  const isIncluded = () => excludeButton() !== null;
  const exclude = () =>
    fireEvent.click(screen.getByTestId("word-exclude-document"));
  const include = () => fireEvent.click(chip());
  const toggleAwayFromDefault = () =>
    preferences.includeByDefault ? exclude() : include();
  const send = () => fireEvent.click(screen.getByTestId("send"));
  const lastFacet = () => sends.at(-1)?.[4];
  const lastIdentity = () => sends.at(-1)?.[5];

  beforeEach(() => {
    i18n.activate("en");
    advertised.ids = [...BOTH_FACETS];
    preferences.includeByDefault = true;
    sends = [];
    handedOver = [];
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

  it("includes the document by default and names it in the chip", async () => {
    renderInput();

    expect(excludeButton()).toHaveAttribute(
      "aria-label",
      "Don't include this document",
    );
    await waitFor(() =>
      expect(chip()).toHaveTextContent("report.docx is included"),
    );
  });

  it("starts without the document when the preference is off, and includes it with one click", async () => {
    preferences.includeByDefault = false;
    renderInput();

    expect(chip()).toHaveTextContent("Include this document");
    expect(excludeButton()).toBeNull();

    include();

    expect(isIncluded()).toBe(true);
    await waitFor(() =>
      expect(chip()).toHaveTextContent("report.docx is included"),
    );
  });

  it("stops including the document for this chat with the ✕", async () => {
    renderInput();

    exclude();

    expect(chip()).toHaveTextContent("Include this document");
    send();
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()).toBeUndefined();
    expect(lastIdentity()).toBeNull();
  });

  it("holds the document's inclusion while the composer is locked", async () => {
    const locked = (disabled: boolean) => (
      <WordChatInput
        chatInputProps={{ ...chatInputProps("chat-1"), disabled }}
        documentIdentity={IDENTITY}
        stagePendingCapture={(capture) => staged.push(capture)}
      />
    );
    const { rerender } = render(locked(true));

    expect(excludeButton()).toBeDisabled();
    exclude();
    expect(isIncluded()).toBe(true);
    send();
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()?.id).toBe("word_document_review");

    rerender(locked(false));
    expect(excludeButton()).toBeEnabled();
    exclude();
    expect(chip()).toHaveTextContent("Include this document");

    rerender(locked(true));
    expect(chip()).toBeDisabled();
    include();
    expect(isIncluded()).toBe(false);

    rerender(locked(false));
    expect(chip()).toBeEnabled();
    include();
    expect(isIncluded()).toBe(true);
  });

  it("is not rendered at all when neither facet is advertised", () => {
    advertised.ids = [];
    renderInput();

    expect(screen.queryByTestId("word-include-document-chip")).toBeNull();
    expect(screen.getByTestId("send")).toBeInTheDocument();
  });

  it("neither reads nor attaches the document while it is not included", async () => {
    preferences.includeByDefault = false;
    renderInput();

    send();

    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()).toBeUndefined();
    expect(lastIdentity()).toBeNull();
    expect(staged).toEqual([null]);
    expect(word.word.run).not.toHaveBeenCalled();
  });

  it("attaches word_document_review and the identity by default", async () => {
    renderInput();

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

    await waitFor(() => expect(chip()).toHaveTextContent("New document"));
    send();

    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()?.id).toBe("word_compose");
    expect(lastFacet()?.args).toEqual({
      document_name: "report.docx",
      document_identity: IDENTITY,
    });
  });

  it("hands the message over, unlabelled, before a quick capture finishes", async () => {
    renderInput();

    send();

    expect(handedOver).toHaveLength(1);
    expect(handedOver[0][4]).toBeUndefined();
    expect(handedOver[0][11]).toBeDefined();
    expect(handedOver[0][11]?.label).toBeUndefined();
    expect(sends).toHaveLength(0);
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()?.id).toBe("word_document_review");
  });

  it("still sends when the document cannot be read", async () => {
    word.word.run.mockRejectedValue(new Error("GeneralException"));
    renderInput();

    await waitFor(() =>
      expect(chip()).toHaveTextContent("Document not included"),
    );
    send();

    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()).toBeUndefined();
    expect(lastIdentity()).toBeNull();
    expect(staged.at(-1)).toBeNull();
  });

  it("carries the document on every send, unchanged document included", async () => {
    renderInput();

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

    await waitFor(() =>
      expect(chip()).toHaveTextContent(
        /Document included \(first \d+ of 200 paragraphs\)/,
      ),
    );
  });

  it("keeps a dismissal when a new chat receives its id on first send", async () => {
    const { rerender } = renderInput(null);
    exclude();

    rerender(element("chat-created-on-send"));

    expect(isIncluded()).toBe(false);
    send();
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()).toBeUndefined();
  });

  it("keeps the document included when a new chat receives its id, though the preference is off", async () => {
    preferences.includeByDefault = false;
    const { rerender } = renderInput(null);
    include();

    rerender(element("chat-created-on-send"));

    expect(isIncluded()).toBe(true);
    send();
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(lastFacet()?.id).toBe("word_document_review");
  });

  it.each([true, false])(
    "returns to the default (included: %s) when the chat genuinely changes",
    (includeByDefault) => {
      preferences.includeByDefault = includeByDefault;
      const { rerender } = renderInput("chat-1");
      toggleAwayFromDefault();
      expect(isIncluded()).toBe(!includeByDefault);

      rerender(element("chat-2"));

      expect(isIncluded()).toBe(includeByDefault);
    },
  );

  it("keeps the open chat as it was when the setting for new chats changes", () => {
    const { rerender } = renderInput("chat-1");
    expect(isIncluded()).toBe(true);

    preferences.includeByDefault = false;
    rerender(element("chat-1"));
    expect(isIncluded()).toBe(true);

    rerender(element("chat-2"));
    expect(isIncluded()).toBe(false);
  });

  it("applies the setting at once to a chat that has not started yet", () => {
    const { rerender } = renderInput(null);
    expect(isIncluded()).toBe(true);

    preferences.includeByDefault = false;
    rerender(element(null));

    expect(isIncluded()).toBe(false);
  });

  it.each([true, false])(
    "returns to the default (included: %s) when the pane's document identity changes",
    (includeByDefault) => {
      preferences.includeByDefault = includeByDefault;
      const { rerender } = renderInput("chat-1");
      toggleAwayFromDefault();
      expect(isIncluded()).toBe(!includeByDefault);

      rerender(
        element("chat-1", "pane-session:11111111-2222-3333-4444-555555555555"),
      );

      expect(isIncluded()).toBe(includeByDefault);
    },
  );

  it("keeps the per-chat choice out of the saved preference and of every store", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    renderInput();
    send();
    await waitFor(() => expect(sends).toHaveLength(1));
    exclude();
    include();

    expect(preferences.setIncludeByDefault).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(word.document.settings.set).not.toHaveBeenCalled();
    expect(word.document.settings.saveAsync).not.toHaveBeenCalled();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});
