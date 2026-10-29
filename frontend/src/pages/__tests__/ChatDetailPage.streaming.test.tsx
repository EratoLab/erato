// The hooks barrel first, as the app loads it: useChatMessaging imports
// useChatHistory through it, and a cold import order leaves that undefined.
import "@/hooks";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@/components/providers/ApiProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { handleTextDelta } from "@/hooks/chat/handlers/handleTextDelta";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import ChatLayout from "@/layouts/ChatLayout";
import { server } from "@/lib/mocks/server";
import { messages as enMessages } from "@/locales/en/messages.json";
import ChatDetailPage from "@/pages/ChatDetailPage";
import { FeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import type {
  ChatMessage as ApiChatMessage,
  ChatMessagesResponse,
  MessageSubmitStreamingResponseMessage,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const markdownRenders = vi.hoisted(() => new Map<string, number>());
const rowRenders = vi.hoisted(() => new Map<string, number>());
const renders = vi.hoisted(() => ({
  historyList: 0,
  chat: 0,
  chatInput: 0,
  emptyState: 0,
}));
const listedMessages = vi.hoisted((): { latest: Record<string, unknown> } => ({
  latest: {},
}));
const editStream = vi.hoisted(() => ({
  onMessage: undefined as
    | ((event: { data: string; type: string }) => void)
    | undefined,
}));

vi.mock("@/components/ui/Chat/ChatMessage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/Chat/ChatMessage")>();
  const { memo, createElement } = await import("react");
  const Original = actual.ChatMessage;
  const ChatMessage = memo((props: Parameters<typeof Original>[0]) => {
    rowRenders.set(
      props.message.id,
      (rowRenders.get(props.message.id) ?? 0) + 1,
    );
    return createElement(Original, props);
  });
  return { ...actual, ChatMessage };
});

vi.mock("@/components/ui/Chat/ChatHistoryList", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/ui/Chat/ChatHistoryList")
    >();
  const { createElement } = await import("react");
  const Original = actual.ChatHistoryList;
  const ChatHistoryList = (props: Parameters<typeof Original>[0]) => {
    renders.historyList += 1;
    return createElement(Original, props);
  };
  return { ...actual, ChatHistoryList };
});

vi.mock("@/components/ui/MessageList/MessageList", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/ui/MessageList/MessageList")
    >();
  const { memo, createElement } = await import("react");
  const Original = actual.MessageList;
  const MessageList = memo((props: Parameters<typeof Original>[0]) => {
    listedMessages.latest = props.messages;
    return createElement(Original, props);
  });
  return { ...actual, MessageList };
});

// Called as functions, so the counters see renders from context changes too.
vi.mock("@/components/ui/Chat/Chat", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/Chat/Chat")>();
  const Original = actual.Chat;
  const Chat = (props: Parameters<typeof Original>[0]) => {
    renders.chat += 1;
    return Original(props);
  };
  return { ...actual, Chat };
});

vi.mock("@/components/ui/Chat/ChatInput", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/Chat/ChatInput")>();
  const Original = actual.ChatInput;
  const ChatInput = (props: Parameters<typeof Original>[0]) => {
    renders.chatInput += 1;
    return Original(props);
  };
  return { ...actual, ChatInput };
});

vi.mock("@/components/ui/Chat/ChatEmptyState", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/ui/Chat/ChatEmptyState")
    >();
  const Original = actual.ChatEmptyState;
  const ChatEmptyState = (props: Parameters<typeof Original>[0]) => {
    renders.emptyState += 1;
    return Original(props);
  };
  return { ...actual, ChatEmptyState };
});

vi.mock("react-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-markdown")>();
  const Original = actual.default;
  const CountingMarkdown = (props: Parameters<typeof Original>[0]) => {
    const text = typeof props.children === "string" ? props.children : "";
    const key = text.split("\n", 1)[0];
    markdownRenders.set(key, (markdownRenders.get(key) ?? 0) + 1);
    return Original(props);
  };
  return { ...actual, default: CountingMarkdown };
});

vi.mock("@/utils/sse/sseClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/sse/sseClient")>();
  return {
    ...actual,
    createSSEConnection: (
      url: string,
      options: Parameters<typeof actual.createSSEConnection>[1] = {},
    ) => {
      if (!url.endsWith("/editstream")) {
        return actual.createSSEConnection(url, options);
      }
      editStream.onMessage = options.onMessage;
      return () => {};
    },
  };
});

const CHAT_ID = "c0ffee00-0000-4000-8000-000000000001";
const STREAM_ID = "c0ffee00-0000-4000-8000-0000000000ff";
const EDITED_ID = "c0ffee00-0000-4000-8000-0000000000ee";
const EDITED_TEXT = "An edited question";
const MESSAGES = 20;
const TOKENS = 10;
const BODY =
  "Some **bold** text and a [link](https://example.com).\n\n- one\n- two";

function apiMessage(
  id: string,
  role: ApiChatMessage["role"],
  text: string,
  at: number,
  previousId?: string,
): ApiChatMessage {
  const iso = new Date(at).toISOString();
  return {
    id,
    chat_id: CHAT_ID,
    role,
    content: [{ content_type: "text", text }],
    created_at: iso,
    updated_at: iso,
    is_message_in_active_thread: true,
    input_files_ids: [],
    files: [],
    previous_message_id: previousId,
  };
}

const BASE = Date.UTC(2026, 0, 1);

function apiMessages(n: number): ApiChatMessage[] {
  return Array.from({ length: n }, (_, i) =>
    apiMessage(
      `msg-${i}`,
      i % 2 === 0 ? "user" : "assistant",
      `m${i}\n\n${BODY}`,
      BASE + i * 1000,
      i > 0 ? `msg-${i - 1}` : undefined,
    ),
  );
}

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

beforeEach(() => {
  editStream.onMessage = undefined;
  useMessagingStore.getState().clearAllStreaming();
  useMessagingStore.getState().clearAllApiMessages();
});

function resetCounters() {
  markdownRenders.clear();
  rowRenders.clear();
  renders.historyList = 0;
  renders.chat = 0;
  renders.chatInput = 0;
  renders.emptyState = 0;
}

async function renderChatPage(initial: ApiChatMessage[]) {
  let messages = initial;
  server.use(
    http.get("*/api/v1beta/chats/:chatId/messages", () =>
      HttpResponse.json({
        messages,
        stats: {
          total_count: messages.length,
          current_offset: 0,
          returned_count: messages.length,
          has_more: false,
        },
      } satisfies ChatMessagesResponse),
    ),
    http.get("*/api/v1beta/me/models", () => HttpResponse.json([])),
    http.get("*/api/v1beta/me/file-capabilities", () => HttpResponse.json([])),
    http.get("*/api/v1beta/me/facets", () =>
      HttpResponse.json({
        facets: [],
        global_facet_settings: {
          only_single_facet: false,
          show_facet_indicator_with_display_name: false,
        },
      }),
    ),
    http.get("*/api/v1beta/me/chats/:chatId", () =>
      HttpResponse.json({
        id: CHAT_ID,
        can_edit: true,
        created_via: "web",
        disabled_mcp_server_ids: [],
        disabled_mcp_tools: [],
        is_pinned: false,
        mcp_write_tools_enabled: false,
        title_resolved: "A chat",
      }),
    ),
    http.get("*/api/v1beta/me/budget", () =>
      HttpResponse.json({ enabled: false }),
    ),
    http.get("*/api/v1beta/assistant-hub/config", () =>
      HttpResponse.json({
        can_review: false,
        categories: [],
        default_share_with_whole_organization: false,
        enable_categories: false,
        enabled: false,
        rating_mode: "none",
      }),
    ),
    http.post(
      "*/api/v1beta/me/messages/resumestream",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  const unhandled: string[] = [];
  server.events.on("request:unhandled", ({ request }) => {
    unhandled.push(`${request.method} ${request.url}`);
  });

  const view = render(
    <ApiProvider enableDevtools={false}>
      <ThemeProvider enableCustomTheme={false}>
        <FeatureConfigProvider>
          <I18nProvider i18n={i18n}>
            <MemoryRouter initialEntries={[`/chat/${CHAT_ID}`]}>
              <Routes>
                <Route path="/chat" element={<ChatLayout />}>
                  <Route path=":id" element={<ChatDetailPage />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </I18nProvider>
        </FeatureConfigProvider>
      </ThemeProvider>
    </ApiProvider>,
  );
  await screen.findAllByTestId("message-assistant", undefined, {
    timeout: 10_000,
  });
  // The edit control waits for the chat's own permissions.
  await screen.findAllByRole("button", { name: "Edit message" });
  return {
    ...view,
    unhandled,
    serveMessages: (next: ApiChatMessage[]) => {
      messages = next;
    },
  };
}

const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(
    `[data-ui='chat-message'][data-message-id='${id}']`,
  );

const blocksOf = (container: HTMLElement, ids: string[]) =>
  ids.flatMap((id) =>
    Array.from(row(container, id)!.querySelectorAll("p, li")),
  );

const rowIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-ui='chat-message']")).map((el) =>
    el.getAttribute("data-message-id"),
  );

const emit = (event: MessageSubmitStreamingResponseMessage) =>
  act(() => {
    editStream.onMessage?.({ type: "message", data: JSON.stringify(event) });
  });

const delta = (text: string) =>
  emit({
    message_type: "text_delta",
    message_id: STREAM_ID,
    content_index: 0,
    new_text: text,
  });

function submitEdit(container: HTMLElement, id: string) {
  fireEvent.click(
    within(row(container, id)!).getByRole("button", { name: "Edit message" }),
  );
  fireEvent.change(screen.getByTestId("message-editor-input"), {
    target: { value: EDITED_TEXT },
  });
  fireEvent.click(screen.getByTestId("message-editor-submit"));
}

function startEditedReply(previousId?: string) {
  const edited = apiMessage(
    EDITED_ID,
    "user",
    EDITED_TEXT,
    Date.UTC(2026, 0, 2),
    previousId,
  );
  emit({
    message_type: "user_message_saved",
    message_id: EDITED_ID,
    message: edited,
  });
  emit({ message_type: "assistant_message_started", message_id: STREAM_ID });
  delta("Streaming");
  return edited;
}

describe("chat page while a reply streams", () => {
  it("re-renders only the streamed message, keeps the others' elements and leaves the sidebar, transcript shell and composer alone", async () => {
    const { container, unmount, unhandled } = await renderChatPage(
      apiMessages(MESSAGES),
    );

    act(() => {
      useMessagingStore.getState().setStreaming(
        {
          isStreaming: true,
          currentMessageId: STREAM_ID,
          content: [],
          createdAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
        },
        CHAT_ID,
      );
    });
    act(() => {
      handleTextDelta(
        {
          message_type: "text_delta",
          message_id: STREAM_ID,
          content_index: 0,
          new_text: "Streaming",
        },
        CHAT_ID,
      );
    });
    const oldBlocks = blocksOf(
      container,
      apiMessages(MESSAGES).map((m) => m.id),
    );

    const before = { ...renders };
    const listedBefore = listedMessages.latest;
    resetCounters();
    for (let t = 0; t < TOKENS; t += 1) {
      act(() => {
        handleTextDelta(
          {
            message_type: "text_delta",
            message_id: STREAM_ID,
            content_index: 0,
            new_text: " token",
          },
          CHAT_ID,
        );
      });
    }

    expect(unhandled).toEqual([]);
    expect(oldBlocks.length).toBe(MESSAGES * 4);
    expect(
      [...markdownRenders.keys()].every((k) => k.startsWith("Streaming")),
    ).toBe(true);
    expect([...markdownRenders.values()].reduce((a, b) => a + b, 0)).toBe(
      TOKENS,
    );
    expect(oldBlocks.every((node) => node.isConnected)).toBe(true);
    expect(Object.fromEntries(rowRenders)).toEqual({ [STREAM_ID]: TOKENS });
    expect(before.historyList).toBeGreaterThan(0);
    expect(before.chat).toBeGreaterThan(0);
    expect(before.chatInput).toBeGreaterThan(0);
    expect(renders.historyList).toBe(0);
    expect(renders.chat).toBe(0);
    expect(renders.chatInput).toBe(0);
    expect(listedMessages.latest).not.toBe(listedBefore);
    for (const { id } of apiMessages(MESSAGES)) {
      expect(listedMessages.latest[id]).toBe(listedBefore[id]);
    }
    unmount();
  }, 30_000);

  it("editing an earlier message drops the later ones, keeps the earlier elements and streams the new reply alone", async () => {
    const history = apiMessages(MESSAGES);
    const { container, unmount, unhandled, serveMessages } =
      await renderChatPage(history);
    const keptIds = history.slice(0, 10).map((m) => m.id);
    const kept = blocksOf(container, keptIds);

    submitEdit(container, "msg-10");
    expect(rowIds(container).slice(0, 10)).toEqual(keptIds);
    expect(rowIds(container)).toHaveLength(11);
    expect(screen.getAllByText(EDITED_TEXT)).toHaveLength(1);

    const edited = startEditedReply("msg-9");
    expect(rowIds(container)).toEqual([...keptIds, EDITED_ID, STREAM_ID]);
    expect(screen.getAllByText(EDITED_TEXT)).toHaveLength(1);

    resetCounters();
    for (let t = 0; t < TOKENS; t += 1) delta(" token");
    expect(Object.fromEntries(rowRenders)).toEqual({ [STREAM_ID]: TOKENS });
    expect(renders.chat).toBe(0);
    expect(renders.chatInput).toBe(0);

    const reply = apiMessage(
      STREAM_ID,
      "assistant",
      `Streaming${" token".repeat(TOKENS)}`,
      Date.UTC(2026, 0, 2, 0, 0, 1),
      EDITED_ID,
    );
    serveMessages([...history.slice(0, 10), edited, reply]);
    emit({
      message_type: "assistant_message_completed",
      message_id: STREAM_ID,
      message: reply,
      content: reply.content,
    });
    await waitFor(() =>
      expect(
        useMessagingStore.getState().getStreaming(CHAT_ID).isStreaming,
      ).toBe(false),
    );
    await waitFor(() =>
      expect(rowIds(container)).toEqual([...keptIds, EDITED_ID, STREAM_ID]),
    );
    expect(screen.getAllByText(EDITED_TEXT)).toHaveLength(1);
    expect(kept.every((node) => node.isConnected)).toBe(true);
    expect(unhandled).toEqual([]);
    unmount();
  }, 30_000);

  it("editing the first message never shows the empty chat", async () => {
    const { container, unmount, unhandled } = await renderChatPage(
      apiMessages(4),
    );
    resetCounters();

    submitEdit(container, "msg-0");
    expect(rowIds(container)).toHaveLength(1);
    expect(screen.getAllByText(EDITED_TEXT)).toHaveLength(1);

    startEditedReply();
    expect(rowIds(container)).toEqual([EDITED_ID, STREAM_ID]);
    renders.chat = 0;
    for (let t = 0; t < TOKENS; t += 1) delta(" token");
    expect(renders.chat).toBe(0);
    expect(renders.emptyState).toBe(0);
    expect(unhandled).toEqual([]);
    unmount();
  }, 30_000);
});
