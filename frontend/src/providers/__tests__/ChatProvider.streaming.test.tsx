// First, so the hooks barrel finishes loading before useChatMessaging imports
// it back: in that import cycle the test runner's star exports drop the names
// that load later, and useChatHistory would be missing.
import "@/hooks";

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ChatPageStructure from "@/app/chat/ChatPageStructure.client";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ChatMessage } from "@/components/ui/Chat/ChatMessage";
import { componentRegistry } from "@/config/componentRegistry";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { chatMessagesQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { server } from "@/lib/mocks/server";
import { ChatProvider, useChatSession } from "@/providers/ChatProvider";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";
import { FileCapabilitiesProvider } from "@/providers/FileCapabilitiesProvider";
import { ProfileProvider } from "@/providers/ProfileProvider";

import type { ChatMessageProps } from "@/components/ui/Chat/ChatMessage";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const CHAT_ID = "chat-1";
const LIVE_ID = "a-live";
const TURNS = 6;

const seen = {
  rows: [] as string[],
  sessions: [] as Record<string, unknown>[],
};

function CountingRenderer(props: ChatMessageProps) {
  seen.rows.push(props.message.id);
  return <ChatMessage {...props} />;
}

function SessionReader() {
  seen.sessions.push(useChatSession());
  return null;
}

const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

const apiMessage = (
  id: string,
  role: "user" | "assistant",
  text: string,
  createdAt: string,
  previousId?: string,
) => ({
  id,
  chat_id: CHAT_ID,
  role,
  content: [{ content_type: "text", text }],
  created_at: createdAt,
  updated_at: createdAt,
  files: [],
  input_files_ids: [],
  is_message_in_active_thread: true,
  ...(previousId ? { previous_message_id: previousId } : {}),
});

const storedChat = () => {
  const messages = [];
  for (let turn = 0; turn <= TURNS; turn++) {
    messages.push(
      apiMessage(
        `u${turn}`,
        "user",
        `Question ${turn}`,
        at(turn * 2),
        turn > 0 ? `a${turn - 1}` : undefined,
      ),
    );
    if (turn < TURNS)
      messages.push(
        apiMessage(
          `a${turn}`,
          "assistant",
          `Answer ${turn} with **bold** text.`,
          at(turn * 2 + 1),
          `u${turn}`,
        ),
      );
  }
  return {
    messages,
    stats: {
      total_count: messages.length,
      current_offset: 0,
      returned_count: messages.length,
      has_more: false,
    },
  };
};

const liveContent = (chunk: number): ContentPart[] => [
  {
    content_type: "reasoning",
    text: `**Compare**\n\nNow I compare${" the totals".repeat(chunk + 1)}`,
  },
];

// What the stream handlers write: the answer starts, then every delta
// replaces the streamed content.
const streamChunk = (chunk: number) =>
  useMessagingStore.getState().setStreaming(
    chunk === 0
      ? {
          isStreaming: true,
          currentMessageId: LIVE_ID,
          content: liveContent(0),
          createdAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
        }
      : { content: liveContent(chunk) },
    CHAT_ID,
  );

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

describe("the web ChatProvider while a reply streams", () => {
  beforeEach(() => {
    // No generation runs on the server, so the chat's resume check ends at once
    // instead of clearing the stream this test starts.
    server.use(
      http.all(
        "*/api/v1beta/me/messages/resumestream",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    seen.rows.length = 0;
    seen.sessions.length = 0;
    (
      componentRegistry as unknown as Record<string, unknown>
    ).ChatMessageRenderer = CountingRenderer;
  });

  afterEach(() => {
    cleanup();
    useMessagingStore.getState().clearAllStreaming();
    useMessagingStore.getState().clearAllApiMessages();
    delete (componentRegistry as unknown as Record<string, unknown>)
      .ChatMessageRenderer;
  });

  it("keeps the session and renders only the streaming answer", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(
      chatMessagesQuery({ pathParams: { chatId: CHAT_ID } }).queryKey,
      storedChat(),
    );
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <StaticFeatureConfigProvider>
          <ThemeProvider>
            <I18nProvider i18n={i18n}>
              <MemoryRouter initialEntries={[`/chat/${CHAT_ID}`]}>
                <Routes>
                  <Route
                    path="/chat/:id"
                    element={
                      <ProfileProvider>
                        <FileCapabilitiesProvider>
                          <ChatProvider>
                            <ChatPageStructure>{null}</ChatPageStructure>
                            <SessionReader />
                          </ChatProvider>
                        </FileCapabilitiesProvider>
                      </ProfileProvider>
                    }
                  />
                </Routes>
              </MemoryRouter>
            </I18nProvider>
          </ThemeProvider>
        </StaticFeatureConfigProvider>
      </QueryClientProvider>,
    );
    await settle();
    act(() => streamChunk(0));
    await settle();
    expect(container.querySelector('[data-message-id="a0"]')).not.toBeNull();
    expect(
      container.querySelector(`[data-message-id="${LIVE_ID}"]`),
    ).not.toBeNull();

    seen.rows.length = 0;
    const session = seen.sessions.at(-1)!;
    seen.sessions.length = 0;
    const CHUNKS = 5;
    for (let chunk = 1; chunk <= CHUNKS; chunk++) {
      act(() => streamChunk(chunk));
    }

    const changedSessionFields = seen.sessions.flatMap((next) =>
      Object.keys(next).filter((key) => !Object.is(next[key], session[key])),
    );
    expect(changedSessionFields).toEqual([]);
    expect(seen.rows.filter((id) => id !== LIVE_ID)).toEqual([]);
    expect(seen.rows.filter((id) => id === LIVE_ID)).toHaveLength(CHUNKS);
    expect(container.textContent).toContain(
      `Now I compare${" the totals".repeat(CHUNKS + 1)}`,
    );
  });
});
