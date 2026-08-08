import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinChatCore } from "../AddinChatCore";

import type { ReactNode } from "react";

vi.mock("@erato/frontend/library", () => ({
  ChatErrorBoundary: ({ children }: { children?: ReactNode }) => children,
  ChatInputControlsProvider: ({ children }: { children?: ReactNode }) =>
    children,
  ChatMessage: () => null,
  DefaultMessageControls: () => null,
  DocumentIcon: () => null,
  DropdownMenu: () => null,
  FeedbackCommentDialog: () => null,
  FeedbackViewDialog: () => null,
  FilePreviewModal: () => null,
  MessageList: () => <div data-testid="neutral-message-list" />,
  MessageEditProvider: ({ children }: { children?: ReactNode }) => children,
  chatMessagesQuery: () => ({ queryKey: ["chat-messages"] }),
  componentRegistry: {},
  extractTextFromContent: () => "",
  getSupportedFileTypes: () => ({}),
  resolveComponentOverride: (override: unknown, fallback: unknown) =>
    override ?? fallback,
  transformEmailFencesForCopy: (value: string) => value,
  useActiveModelSelection: () => ({
    availableModels: [],
    selectedModel: null,
    setSelectedModel: vi.fn(),
    isSelectionReady: true,
  }),
  useChatContext: () => ({
    messages: {},
    messageOrder: [],
    sendMessage: vi.fn(async () => undefined),
    editMessage: vi.fn(async () => undefined),
    regenerateMessage: vi.fn(async () => undefined),
    isMessagingLoading: false,
    isPendingResponse: false,
    chats: [],
    currentChatId: null,
    createNewChat: vi.fn(async () => "temp-chat"),
    refetchHistory: vi.fn(async () => undefined),
    currentChatLastModel: null,
  }),
  useConversationDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
    isDragAccept: false,
  }),
  useFileCapabilitiesContext: () => ({ capabilities: {} }),
  useFilePreviewModal: () => ({
    isPreviewModalOpen: false,
    fileToPreview: null,
    openPreviewModal: vi.fn(),
    closePreviewModal: vi.fn(),
  }),
  useFileUploadWithTokenCheck: () => ({
    uploadFiles: vi.fn(async () => []),
    uploadError: null,
    isUploading: false,
  }),
  useMessageFeedback: () => ({
    feedbackDialogState: { isOpen: false },
    feedbackViewDialogState: { isOpen: false, feedback: null },
    feedbackConfig: undefined,
    handleFeedbackSubmit: vi.fn(),
    handleFeedbackViewDialogRemove: vi.fn(),
    closeFeedbackDialog: vi.fn(),
    closeFeedbackViewDialog: vi.fn(),
    handleFeedbackDialogSubmit: vi.fn(),
    openFeedbackDialog: vi.fn(),
    openFeedbackViewDialog: vi.fn(),
    switchToEditMode: vi.fn(),
    canEditFeedback: vi.fn(() => false),
  }),
  useProfile: () => ({ profile: undefined }),
  useStandardMessageActions: () => vi.fn(),
}));

vi.mock("../AddinChatInputCore", () => ({
  AddinChatInputCore: () => <div data-testid="neutral-chat-input" />,
}));
vi.mock("../AddinSettingsDialogCore", () => ({
  AddinSettingsDialogCore: () => null,
}));

describe("AddinChatCore host boundary", () => {
  const originalOffice = Object.getOwnPropertyDescriptor(globalThis, "Office");

  beforeEach(() => {
    i18n.activate("en");
    Reflect.deleteProperty(globalThis, "Office");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });

  it("renders ordinary chat without Office.js or appending its CDN script", () => {
    const appendChild = vi.spyOn(document.head, "appendChild");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    expect(() =>
      render(
        <QueryClientProvider client={queryClient}>
          <AddinChatCore />
        </QueryClientProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByText("New Chat")).toBeInTheDocument();
    expect(screen.getByTestId("neutral-message-list")).toBeInTheDocument();
    expect(screen.getByTestId("neutral-chat-input")).toBeInTheDocument();
    expect(
      appendChild.mock.calls.some(([node]) =>
        node instanceof HTMLScriptElement
          ? node.src.includes("appsforoffice.microsoft.com")
          : false,
      ),
    ).toBe(false);
  });
});
