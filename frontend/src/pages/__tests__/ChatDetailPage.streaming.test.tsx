// The hooks barrel first, as the app loads it: useChatMessaging imports
// useChatHistory through it, and a cold import order leaves that undefined.
import "@/hooks";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";

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
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const markdownRenders = vi.hoisted(() => new Map<string, number>());
const rowRenders = vi.hoisted(() => new Map<string, number>());
const historyListRenders = vi.hoisted(() => ({ count: 0 }));

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
    historyListRenders.count += 1;
    return createElement(Original, props);
  };
  return { ...actual, ChatHistoryList };
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

const CHAT_ID = "c0ffee00-0000-4000-8000-000000000001";
const STREAM_ID = "c0ffee00-0000-4000-8000-0000000000ff";
const MESSAGES = 20;
const TOKENS = 10;
const BODY =
  "Some **bold** text and a [link](https://example.com).\n\n- one\n- two";

function apiMessages(n: number): ApiChatMessage[] {
  const base = Date.UTC(2026, 0, 1);
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(base + i * 1000).toISOString();
    return {
      id: `msg-${i}`,
      chat_id: CHAT_ID,
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ content_type: "text", text: `m${i}\n\n${BODY}` }],
      created_at: at,
      updated_at: at,
      is_message_in_active_thread: true,
      input_files_ids: [],
      files: [],
      previous_message_id: i > 0 ? `msg-${i - 1}` : undefined,
    };
  });
}

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const delta = (text: string) =>
  act(() => {
    handleTextDelta(
      {
        message_type: "text_delta",
        message_id: STREAM_ID,
        content_index: 0,
        new_text: text,
      },
      CHAT_ID,
    );
  });

describe("chat page while a reply streams", () => {
  it("re-renders only the streamed message, keeps the others' elements and leaves the sidebar alone", async () => {
    const response: ChatMessagesResponse = {
      messages: apiMessages(MESSAGES),
      stats: {
        total_count: MESSAGES,
        current_offset: 0,
        returned_count: MESSAGES,
        has_more: false,
      },
    };
    server.use(
      http.get("*/api/v1beta/chats/:chatId/messages", () =>
        HttpResponse.json(response),
      ),
      http.get("*/api/v1beta/me/models", () => HttpResponse.json([])),
      http.get("*/api/v1beta/me/file-capabilities", () =>
        HttpResponse.json([]),
      ),
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
        HttpResponse.json({}, { status: 404 }),
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
    useMessagingStore.getState().clearAllStreaming();
    useMessagingStore.getState().clearAllApiMessages();

    const { container, unmount } = render(
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
    delta("Streaming");
    const oldBlocks = Array.from(
      container.querySelectorAll(
        `[data-ui='chat-message']:not([data-message-id='${STREAM_ID}'])`,
      ),
    ).flatMap((el) => Array.from(el.querySelectorAll("p, li")));

    const historyListsRendered = historyListRenders.count;
    markdownRenders.clear();
    rowRenders.clear();
    historyListRenders.count = 0;
    for (let t = 0; t < TOKENS; t += 1) delta(" token");

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
    expect(historyListsRendered).toBeGreaterThan(0);
    expect(historyListRenders.count).toBe(0);
    unmount();
  }, 30_000);
});
