import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render as testingRender,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { MessageContent } from "@/components/ui/Message/MessageContent";
import { useWordHistoryMessage } from "@/components/ui/WordReview/useWordHistoryMessage";
import { server } from "@/lib/mocks/server";
import { messages as enMessages } from "@/locales/en/messages.json";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { MessageList } from "./MessageList";
import { useConversationMessage } from "../Message/ConversationMessages";

import type { ChatMessageProps } from "../Chat/ChatMessage";
import type { MessageAction } from "@/types/message-controls";
import type { Messages } from "@lingui/core";
import type { ReactElement, ReactNode } from "react";

const render = (ui: ReactElement) =>
  testingRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StaticFeatureConfigProvider>
        <ThemeProvider enableCustomTheme={false}>{ui}</ThemeProvider>
      </StaticFeatureConfigProvider>
    </QueryClientProvider>,
  );

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const userContent = [{ content_type: "text" as const, text: "Question" }];

// Shaped the way the chat providers rebuild them on every streamed update:
// new message and loading objects, the unchanged message's content kept.
const streamedMessages = (streamedText: string) => ({
  user1: {
    id: "user1",
    role: "user" as const,
    content: userContent,
    createdAt: "2026-01-01T00:00:00.000Z",
    sender: "user",
    authorId: "author-1",
  },
  assistant1: {
    id: "assistant1",
    role: "assistant" as const,
    content: [{ content_type: "text" as const, text: streamedText }],
    createdAt: "2026-01-01T00:01:00.000Z",
    sender: "assistant",
    authorId: "assistant",
    previous_message_id: "user1",
    loading: { state: "typing" as const },
  },
});

const streamingListWrapper = () => {
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <StaticFeatureConfigProvider>
          <ThemeProvider enableCustomTheme={false}>
            <I18nProvider i18n={i18n}>{children}</I18nProvider>
          </ThemeProvider>
        </StaticFeatureConfigProvider>
      </QueryClientProvider>
    );
  };
};

const streamingList = (
  streamedText: string,
  messageRenderer: (props: ChatMessageProps) => ReactElement,
  onMessageAction: (action: MessageAction) => Promise<boolean> = vi.fn(
    async () => true,
  ),
) => (
  <MessageList
    messages={streamedMessages(streamedText)}
    messageOrder={["user1", "assistant1"]}
    loadOlderMessages={vi.fn()}
    hasOlderMessages={false}
    isPending={false}
    currentSessionId="chat-1"
    controlsContext={{ canEdit: true }}
    onMessageAction={onMessageAction}
    messageRenderer={messageRenderer}
  />
);

describe("MessageList", () => {
  it.each([false, true])(
    "resolves generated documents for this and later messages (metadata loaded: %s)",
    async (metadataLoaded) => {
      const file = {
        id: "generated-file",
        filename: "values.xlsx",
        preview_url: "https://files.example/preview",
        download_url: "https://files.example/download",
        file_contents_unavailable_missing_permissions: false,
        is_sharepoint_file: false,
      };
      const fetchFile = vi.fn(() => HttpResponse.json(file));
      server.use(http.get("*/api/v1beta/files/generated-file", fetchFile));
      const preview = vi.fn();
      function Renderer({ message, allFilesById }: ChatMessageProps) {
        return (
          <MessageContent
            content={message.content}
            filesById={allFilesById}
            onFileLinkPreview={preview}
          />
        );
      }
      const generated = {
        id: "generated",
        role: "assistant" as const,
        sender: "assistant",
        authorId: "assistant",
        createdAt: "2026-01-01T00:00:00Z",
        files: metadataLoaded ? [file] : [],
        content: [
          {
            content_type: "text_file_pointer" as const,
            file_upload_id: file.id,
          },
          {
            content_type: "text" as const,
            text: "[Download values](erato-file://generated-file)",
          },
        ],
      };
      const later = {
        ...generated,
        id: "later",
        content: [
          {
            content_type: "text" as const,
            text: "[Earlier file](erato-file://generated-file)",
          },
        ],
      };
      render(
        <I18nProvider i18n={i18n}>
          <MessageList
            messages={{ generated, later }}
            messageOrder={["generated", "later"]}
            loadOlderMessages={vi.fn()}
            hasOlderMessages={false}
            isPending={false}
            currentSessionId="chat"
            controlsContext={{}}
            onMessageAction={vi.fn(async () => true)}
            messageRenderer={Renderer}
          />
        </I18nProvider>,
      );
      await waitFor(() =>
        expect(
          screen.getByRole("link", { name: "Download values" }),
        ).toHaveAttribute("href", file.preview_url),
      );
      expect(
        screen.getByRole("link", { name: "Earlier file" }),
      ).toHaveAttribute("href", file.preview_url);
      fireEvent.click(screen.getByRole("link", { name: "Download values" }));
      expect(preview).toHaveBeenCalledWith(file);
      expect(fetchFile).toHaveBeenCalledTimes(metadataLoaded ? 0 : 1);
    },
  );

  it("re-renders a message whose stored facet arrives under the same id", () => {
    const seen: (string | undefined)[] = [];
    function Renderer({ message }: ChatMessageProps) {
      seen.push(message.action_facet_args?.document_name);
      return null;
    }
    const base = {
      id: "user-1",
      role: "user" as const,
      sender: "user",
      authorId: "user",
      createdAt: "2026-01-01T00:00:00Z",
      content: [{ content_type: "text" as const, text: "Summarize" }],
    };
    const props = {
      messageOrder: ["user-1"],
      loadOlderMessages: vi.fn(),
      hasOlderMessages: false,
      isPending: false,
      currentSessionId: "chat",
      controlsContext: {},
      onMessageAction: vi.fn(async () => true),
      messageRenderer: Renderer,
    };
    const { rerender } = render(
      <MessageList messages={{ "user-1": base }} {...props} />,
    );
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <StaticFeatureConfigProvider>
          <ThemeProvider enableCustomTheme={false}>
            <MessageList
              messages={{
                "user-1": {
                  ...base,
                  action_facet_id: "word_document_review",
                  action_facet_args: { document_name: "Report.docx" },
                },
              }}
              {...props}
            />
          </ThemeProvider>
        </StaticFeatureConfigProvider>
      </QueryClientProvider>,
    );
    expect(seen.at(-1)).toBe("Report.docx");
  });

  it("centers empty state components independently from message width", () => {
    render(
      <MessageList
        messages={{}}
        messageOrder={[]}
        loadOlderMessages={vi.fn()}
        hasOlderMessages={false}
        isPending={false}
        currentSessionId={null}
        controlsContext={{}}
        onMessageAction={vi.fn(async () => true)}
        emptyStateComponent={<div>Empty state</div>}
      />,
    );

    const chatBody = screen.getByTestId("message-list");
    const emptyStateShell = chatBody.lastElementChild;

    expect(chatBody).toHaveClass("chat-body-skin");
    expect(chatBody.className).toContain(
      "[padding:var(--theme-spacing-shell-padding-y)_calc(var(--theme-spacing-shell-padding-x)/2)]",
    );
    expect(chatBody.className).toContain(
      "gap-[var(--theme-spacing-shell-gap)]",
    );
    expect(emptyStateShell?.className).toContain("w-full");
    expect(emptyStateShell?.className).toContain("justify-center");
    expect(screen.getByText("Empty state")).toBeTruthy();
  });

  it("uses the theme layout token for the default chat content width", () => {
    render(
      <MessageList
        messages={{}}
        messageOrder={[]}
        loadOlderMessages={vi.fn()}
        hasOlderMessages={false}
        isPending={false}
        currentSessionId={null}
        controlsContext={{}}
        onMessageAction={vi.fn(async () => true)}
      />,
    );

    const chatBody = screen.getByTestId("message-list");
    const contentShell = chatBody.lastElementChild;

    expect(chatBody).toHaveClass("chat-body-skin");
    expect(chatBody.className).toContain(
      "[padding:var(--theme-spacing-shell-padding-y)_calc(var(--theme-spacing-shell-padding-x)/2)]",
    );
    expect(contentShell).toHaveStyle({
      maxWidth: "var(--theme-layout-chat-content-max-width)",
    });
  });

  it("renders a model-switch marker only on the turn it belongs to", () => {
    const messages = {
      user1: {
        id: "user1",
        role: "user" as const,
        content: [{ content_type: "text" as const, text: "first" }],
        createdAt: "2026-01-01T00:00:00.000Z",
        sender: "user",
        authorId: "author-1",
      },
      user2: {
        id: "user2",
        role: "user" as const,
        content: [{ content_type: "text" as const, text: "second" }],
        createdAt: "2026-01-01T00:01:00.000Z",
        sender: "user",
        authorId: "author-1",
      },
    };

    render(
      <I18nProvider i18n={i18n}>
        <MessageList
          messages={messages}
          messageOrder={["user1", "user2"]}
          loadOlderMessages={vi.fn()}
          hasOlderMessages={false}
          isPending={false}
          currentSessionId="chat-1"
          controlsContext={{}}
          onMessageAction={vi.fn(async () => true)}
          messageRenderer={({ message }) => <div>{message.id}</div>}
          modelSwitches={{
            user2: { fromModel: "Model One", toModel: "Model Two" },
          }}
        />
      </I18nProvider>,
    );

    const markers = screen.getAllByTestId("model-switch-marker");

    expect(markers).toHaveLength(1);
    // The marker introduces the turn that changed model, so it must precede it.
    expect(markers[0].nextElementSibling?.textContent).toBe("user2");
  });

  it("lets a message renderer read the request its answer replied to", () => {
    const messages = {
      user1: {
        id: "user1",
        role: "user" as const,
        content: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        sender: "user",
        authorId: "author-1",
        action_facet_id: "word_document_review",
      },
      assistant1: {
        id: "assistant1",
        role: "assistant" as const,
        content: [],
        createdAt: "2026-01-01T00:01:00.000Z",
        sender: "assistant",
        authorId: "assistant",
        previous_message_id: "user1",
      },
    };
    function Renderer({
      message,
    }: {
      message: { id: string; previous_message_id?: string };
    }) {
      const previous = useConversationMessage(message.previous_message_id);
      return (
        <div>
          {message.id}:{previous?.action_facet_id ?? "none"}
        </div>
      );
    }

    render(
      <I18nProvider i18n={i18n}>
        <MessageList
          messages={messages}
          messageOrder={["user1", "assistant1"]}
          loadOlderMessages={vi.fn()}
          hasOlderMessages={false}
          isPending={false}
          currentSessionId="chat-1"
          controlsContext={{}}
          onMessageAction={vi.fn(async () => true)}
          messageRenderer={Renderer}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("assistant1:word_document_review")).toBeTruthy();
    expect(screen.getByText("user1:none")).toBeTruthy();
  });

  it("re-renders only the streamed message when the host rebuilds every message", () => {
    const rendered: string[] = [];
    function Renderer({ message, onMessageAction }: ChatMessageProps) {
      rendered.push(message.id);
      return (
        <button
          type="button"
          onClick={() =>
            void onMessageAction({ type: "copy", messageId: message.id })
          }
        >
          {message.id}
        </button>
      );
    }
    const firstAction = vi.fn(async () => true);
    const latestAction = vi.fn(async () => true);
    const { rerender } = testingRender(
      streamingList("Hel", Renderer, firstAction),
      { wrapper: streamingListWrapper() },
    );

    rendered.length = 0;
    rerender(streamingList("Hello", Renderer, latestAction));

    expect(rendered).toContain("assistant1");
    expect(rendered).not.toContain("user1");
    fireEvent.click(screen.getByText("user1"));
    expect(latestAction).toHaveBeenCalledWith({
      type: "copy",
      messageId: "user1",
    });
    expect(firstAction).not.toHaveBeenCalled();
  });

  it("renders a streamed message once per update while it looks up its Word request", () => {
    let renders = 0;
    function Renderer({ message }: ChatMessageProps) {
      useWordHistoryMessage(message.id, undefined);
      if (message.id === "assistant1") renders += 1;
      return <div>{message.id}</div>;
    }
    const { rerender } = testingRender(streamingList("Hel", Renderer), {
      wrapper: streamingListWrapper(),
    });

    renders = 0;
    rerender(streamingList("Hello", Renderer));

    expect(renders).toBe(1);
  });

  it("preserves an explicit numeric width override when provided", () => {
    render(
      <MessageList
        messages={{}}
        messageOrder={[]}
        loadOlderMessages={vi.fn()}
        hasOlderMessages={false}
        isPending={false}
        currentSessionId={null}
        controlsContext={{}}
        onMessageAction={vi.fn(async () => true)}
        maxWidth={640}
      />,
    );

    const chatBody = screen.getByTestId("message-list");
    const contentShell = chatBody.lastElementChild;

    expect(contentShell).toHaveStyle({
      maxWidth: "640px",
    });
  });
});
