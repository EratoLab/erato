import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../test/mocks/word/document";
import {
  beginWordOwnWrite,
  nameWordOwnWriteIds,
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  resetWordChangeJournalForTests,
  wordChangePosition,
  wordChangesSince,
} from "../utils/wordChangeJournal";
import {
  getWordDocumentIdentity,
  resetWordDocumentIdentityForTests,
} from "../utils/wordDocumentIdentity";
import {
  WORD_DOCUMENT_CHATS_KEY,
  forgetWordDocumentChat,
  readWordDocumentChat,
  recordWordDocumentChat,
  wordDocumentChatKey,
} from "../wordDocumentChatMap";
import {
  LEGACY_WORD_CURRENT_CHAT_KEY,
  WordAddinSessionController,
} from "../wordSession";

import type { AddinSessionController } from "../../core/AddinChatProviderCore";
import type { MockWordHost } from "../../test/mocks/word/document";

const messagingStore = vi.hoisted(() => ({
  abortActiveSSE: vi.fn(),
  clearUserMessages: vi.fn(),
  resetStreaming: vi.fn(),
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    chatMessagesQuery: ({
      pathParams,
    }: {
      pathParams: { chatId: string };
    }) => ({
      queryKey: ["chat-messages", pathParams.chatId],
    }),
    useMessagingStore: { getState: () => messagingStore },
  });
});

const REPORT_URL =
  "https://contoso.sharepoint.com/Shared%20Documents/report.docx";
const BUDGET_URL =
  "https://contoso.sharepoint.com/Shared%20Documents/budget.docx";

const keyOf = async (url: string) => (await wordDocumentChatKey(url))!;

function renderPane(testId: string, queryClient = new QueryClient()) {
  const pane: { session: AddinSessionController | null } = { session: null };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WordAddinSessionController chats={[]}>
        {(session) => {
          pane.session = session;
          return <div data-testid={testId}>{session.currentChatId ?? ""}</div>;
        }}
      </WordAddinSessionController>
    </QueryClientProvider>,
  );
  const session = () => {
    if (pane.session === null) throw new Error("the pane has not rendered");
    return pane.session;
  };
  return { ...view, session, queryClient };
}

async function renderOpenedPane(testId = "pane", queryClient?: QueryClient) {
  const pane = renderPane(testId, queryClient);
  await screen.findByTestId(testId);
  return pane;
}

const flushLiveReads = () => act(async () => {});

describe("Word session controller", () => {
  let word: MockWordHost;

  beforeEach(() => {
    localStorage.clear();
    word = installMockWordDocument();
  });

  afterEach(() => {
    cleanup();
    uninstallMockWordDocument();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders nothing until the document's chat is known", async () => {
    renderPane("pane");

    expect(screen.queryByTestId("pane")).toBeNull();
    expect(await screen.findByTestId("pane")).toBeInTheDocument();
  });

  it("starts a new chat in a document it has not seen", async () => {
    const pane = await renderOpenedPane();

    expect(pane.session().currentChatId).toBeNull();
    expect(pane.session().effectiveChatId).toBeNull();
  });

  it("resumes the chat recorded for the document", async () => {
    recordWordDocumentChat(await keyOf(REPORT_URL), "chat-report");

    const pane = await renderOpenedPane();

    expect(pane.session().currentChatId).toBe("chat-report");
    expect(pane.session().effectiveChatId).toBe("chat-report");
  });

  it("does not resume another document's chat", async () => {
    recordWordDocumentChat(await keyOf(BUDGET_URL), "chat-budget");

    const pane = await renderOpenedPane();

    expect(pane.session().currentChatId).toBeNull();
  });

  it("drops the shared current-chat key older builds wrote", async () => {
    localStorage.setItem(LEGACY_WORD_CURRENT_CHAT_KEY, '"chat-elsewhere"');

    const pane = await renderOpenedPane();

    expect(localStorage.getItem(LEGACY_WORD_CURRENT_CHAT_KEY)).toBeNull();
    expect(pane.session().currentChatId).toBeNull();
  });

  it("records adopted and selected chats for the document", async () => {
    const key = await keyOf(REPORT_URL);
    const pane = await renderOpenedPane();

    act(() => pane.session().adoptNewChatId("chat-new"));
    expect(pane.session().currentChatId).toBe("chat-new");
    await waitFor(() => expect(readWordDocumentChat(key)).toBe("chat-new"));

    act(() => pane.session().selectChat("chat-picked"));
    expect(pane.session().currentChatId).toBe("chat-picked");
    await waitFor(() => expect(readWordDocumentChat(key)).toBe("chat-picked"));
  });

  it("records the pane's writes as the shown chat's own", async () => {
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();
    recordWordDocumentChat(await keyOf(REPORT_URL), "chat-report");
    let paragraph = 0;
    const writer = () => {
      const position = wordChangePosition();
      const id = `p${(paragraph += 1)}`;
      const write = beginWordOwnWrite("ids");
      nameWordOwnWriteIds([id]);
      recordWordParagraphEvent({
        type: "ParagraphChanged",
        source: "Local",
        uniqueLocalIds: [id],
      });
      write.end();
      const since = wordChangesSince(position);
      return since.ok ? since.entries.map((entry) => entry.chat) : [];
    };
    const pane = await renderOpenedPane();

    expect(writer()).toEqual(["chat-report"]);
    act(() => pane.session().selectChat("chat-picked"));
    expect(writer()).toEqual(["chat-picked"]);
    act(() => pane.session().beginNewChat());
    expect(writer()).toEqual([undefined]);
    resetWordChangeJournalForTests();
  });

  it("begins a new chat without forgetting the document's last one", async () => {
    const key = await keyOf(REPORT_URL);
    recordWordDocumentChat(key, "chat-report");
    const pane = await renderOpenedPane();

    act(() => pane.session().beginNewChat());

    expect(pane.session().currentChatId).toBeNull();
    expect(pane.session().newChatCounter).toBe(1);
    expect(readWordDocumentChat(key)).toBe("chat-report");
  });

  it("never stores a chat for an unsaved document", async () => {
    word.document.url = null;
    const pane = await renderOpenedPane();

    act(() => pane.session().adoptNewChatId("chat-draft"));
    await flushLiveReads();
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    await flushLiveReads();

    expect(pane.session().currentChatId).toBe("chat-draft");
    expect(word.document.getFilePropertiesAsync).toHaveBeenCalled();
    expect(localStorage.getItem(WORD_DOCUMENT_CHATS_KEY)).toBeNull();
  });

  it("records the chat under the URL a document gets when first saved", async () => {
    word.document.url = null;
    const pane = await renderOpenedPane();
    act(() => pane.session().adoptNewChatId("chat-draft"));
    await flushLiveReads();
    const identity = getWordDocumentIdentity();

    word.document.getFilePropertiesAsync.mockImplementation((callback) =>
      callback({
        status: Office.AsyncResultStatus.Succeeded,
        value: { url: REPORT_URL },
      } as Office.AsyncResult<Office.FileProperties>),
    );
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });

    const key = await keyOf(REPORT_URL);
    await waitFor(() => expect(readWordDocumentChat(key)).toBe("chat-draft"));
    expect(getWordDocumentIdentity()).toBe(identity);
  });

  it("records a chat adopted after the save under the saved URL", async () => {
    word.document.url = null;
    const pane = await renderOpenedPane();
    word.document.getFilePropertiesAsync.mockImplementation((callback) =>
      callback({
        status: Office.AsyncResultStatus.Succeeded,
        value: { url: REPORT_URL },
      } as Office.AsyncResult<Office.FileProperties>),
    );

    act(() => pane.session().adoptNewChatId("chat-after-save"));

    const key = await keyOf(REPORT_URL);
    await waitFor(() =>
      expect(readWordDocumentChat(key)).toBe("chat-after-save"),
    );
  });

  describe("after Save As", () => {
    const saveAs = (url: string) =>
      word.document.getFilePropertiesAsync.mockImplementation((callback) =>
        callback({
          status: Office.AsyncResultStatus.Succeeded,
          value: { url },
        } as Office.AsyncResult<Office.FileProperties>),
      );

    it("carries the open chat over to the new file and leaves the original's", async () => {
      const reportKey = await keyOf(REPORT_URL);
      recordWordDocumentChat(reportKey, "chat-report");
      await renderOpenedPane();

      saveAs(BUDGET_URL);
      act(() => {
        globalThis.dispatchEvent(new Event("focus"));
      });

      const budgetKey = await keyOf(BUDGET_URL);
      await waitFor(() =>
        expect(readWordDocumentChat(budgetKey)).toBe("chat-report"),
      );
      expect(readWordDocumentChat(reportKey)).toBe("chat-report");
    });

    it("records a chat started afterwards only under the new file", async () => {
      const reportKey = await keyOf(REPORT_URL);
      const budgetKey = await keyOf(BUDGET_URL);
      recordWordDocumentChat(reportKey, "chat-report");
      const pane = await renderOpenedPane();

      saveAs(BUDGET_URL);
      act(() => pane.session().beginNewChat());
      act(() => pane.session().adoptNewChatId("chat-budget"));

      await waitFor(() =>
        expect(readWordDocumentChat(budgetKey)).toBe("chat-budget"),
      );
      expect(readWordDocumentChat(reportKey)).toBe("chat-report");
    });

    it("stops writing the original's key on later returns to the pane", async () => {
      const reportKey = await keyOf(REPORT_URL);
      const budgetKey = await keyOf(BUDGET_URL);
      recordWordDocumentChat(reportKey, "chat-report");
      const pane = await renderOpenedPane();
      saveAs(BUDGET_URL);
      act(() => pane.session().beginNewChat());
      act(() => pane.session().adoptNewChatId("chat-budget"));
      await waitFor(() =>
        expect(readWordDocumentChat(budgetKey)).toBe("chat-budget"),
      );

      // Observe the focus-triggered write before this test clears storage.
      forgetWordDocumentChat(budgetKey, "chat-budget");
      act(() => {
        globalThis.dispatchEvent(new Event("focus"));
      });
      await waitFor(() =>
        expect(readWordDocumentChat(budgetKey)).toBe("chat-budget"),
      );

      expect(readWordDocumentChat(reportKey)).toBe("chat-report");
    });
  });

  it("keeps two panes on different documents independent", async () => {
    const reportKey = await keyOf(REPORT_URL);
    const budgetKey = await keyOf(BUDGET_URL);
    const reportPane = await renderOpenedPane("report-pane");
    act(() => reportPane.session().adoptNewChatId("chat-report"));
    await waitFor(() =>
      expect(readWordDocumentChat(reportKey)).toBe("chat-report"),
    );

    resetWordDocumentIdentityForTests();
    word.document.url = BUDGET_URL;
    const budgetPane = await renderOpenedPane("budget-pane");
    expect(budgetPane.session().currentChatId).toBeNull();
    act(() => budgetPane.session().adoptNewChatId("chat-budget"));
    await waitFor(() =>
      expect(readWordDocumentChat(budgetKey)).toBe("chat-budget"),
    );

    expect(screen.getByTestId("report-pane")).toHaveTextContent("chat-report");
    expect(screen.getByTestId("budget-pane")).toHaveTextContent("chat-budget");
    expect(readWordDocumentChat(reportKey)).toBe("chat-report");
    expect(readWordDocumentChat(budgetKey)).toBe("chat-budget");
  });

  describe("a recorded chat that no longer exists", () => {
    const failChatMessages = (
      queryClient: QueryClient,
      chatId: string,
      status: number,
    ) =>
      act(() =>
        queryClient.prefetchQuery({
          queryKey: ["chat-messages", chatId],
          queryFn: () => Promise.reject({ status, payload: "" }),
          retry: false,
        }),
      );

    it("forgets it and begins a new chat when its history is not found", async () => {
      const key = await keyOf(REPORT_URL);
      recordWordDocumentChat(key, "chat-gone");
      const pane = await renderOpenedPane();
      const clearNewlyCreatedChatId = vi.fn();
      pane.session().clearNewlyCreatedChatIdRef.current =
        clearNewlyCreatedChatId;

      await failChatMessages(pane.queryClient, "chat-gone", 404);

      expect(pane.session().currentChatId).toBeNull();
      expect(pane.session().newChatCounter).toBe(1);
      expect(readWordDocumentChat(key)).toBeNull();
      expect(messagingStore.abortActiveSSE).toHaveBeenCalled();
      expect(messagingStore.clearUserMessages).toHaveBeenCalled();
      expect(messagingStore.resetStreaming).toHaveBeenCalled();
      expect(clearNewlyCreatedChatId).toHaveBeenCalled();
    });

    it("begins a new chat when the history already failed before the pane opened", async () => {
      const key = await keyOf(REPORT_URL);
      recordWordDocumentChat(key, "chat-gone");
      const queryClient = new QueryClient();
      await failChatMessages(queryClient, "chat-gone", 404);

      const pane = await renderOpenedPane("pane", queryClient);

      await waitFor(() => expect(pane.session().currentChatId).toBeNull());
      expect(readWordDocumentChat(key)).toBeNull();
    });

    it("keeps the chat on any other failure", async () => {
      const key = await keyOf(REPORT_URL);
      recordWordDocumentChat(key, "chat-report");
      const pane = await renderOpenedPane();

      await failChatMessages(pane.queryClient, "chat-report", 500);

      expect(pane.session().currentChatId).toBe("chat-report");
      expect(readWordDocumentChat(key)).toBe("chat-report");
      expect(messagingStore.abortActiveSSE).not.toHaveBeenCalled();
    });
  });
});
