import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutlookEmailSourceProvider } from "../../providers/OutlookEmailSourceProvider";
import { AddinChat } from "../AddinChat";

import type { ReactNode } from "react";

// The SE crash regression test for ERMAIN-353: AddinChat used to call the
// THROWING useGraphToken() at render time, while EntraGraphTokenProvider only
// mounts in entra-msal mode — so the moment a non-Graph session (Exchange SE)
// authenticated, the whole tree threw "Graph auth is not available on this
// host". This file renders AddinChat (and the real OutlookEmailSourceProvider
// around it) with NO Graph provider and NO session provider mounted at all —
// auth contexts sit at their defaults (mode "unsupported", no Graph token) —
// and asserts the tree still renders.
//
// The shared library is stubbed to its render-relevant surface; everything
// the regression exercises (the fetcher hook, both providers' wiring, the
// drop plumbing) runs for real.

// Hoisted so the dropzone stub can record the options AddinChat passes —
// the `.msg` advertising test below asserts on `extraAcceptMimeTypes`.
const { useConversationDropzoneMock } = vi.hoisted(() => ({
  useConversationDropzoneMock: vi.fn(
    (_options: { extraAcceptMimeTypes?: Record<string, string[]> }) => ({
      getRootProps: () => ({}),
      getInputProps: () => ({}),
      isDragActive: false,
      isDragAccept: false,
    }),
  ),
}));

vi.mock("@erato/frontend/library", () => ({
  // Transitive needs of the real SessionAuthProvider / EntraGraphTokenProvider
  // modules (imported via useOutlookMessageFetcher, not mounted here).
  setAuthRecoveryHandler: vi.fn(),
  // Client-tool registry used by useOutlookClientTools; returns an unregister.
  registerClientToolExecutor: vi.fn(() => vi.fn()),
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  // AddinChat's own imports.
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
  MessageList: () => null,
  chatMessagesQuery: vi.fn(() => ({ queryKey: ["chat-messages"] })),
  componentRegistry: {},
  extractTextFromContent: vi.fn(() => ""),
  transformEmailFencesForCopy: (text: string) => text,
  getSupportedFileTypes: vi.fn(() => ({})),
  resolveComponentOverride: (override: unknown, fallback: unknown) =>
    override ?? fallback,
  useActiveModelSelection: () => ({
    availableModels: [],
    selectedModel: null,
    setSelectedModel: vi.fn(),
    isSelectionReady: true,
  }),
  useChatContext: () => ({
    messages: {},
    messageOrder: [],
    sendMessage: vi.fn(async () => {}),
    editMessage: vi.fn(async () => {}),
    regenerateMessage: vi.fn(async () => {}),
    isMessagingLoading: false,
    isPendingResponse: false,
    chats: [],
    currentChatId: null,
    createNewChat: vi.fn(async () => {}),
    refetchHistory: vi.fn(async () => {}),
    currentChatLastModel: undefined,
  }),
  useConversationDropzone: useConversationDropzoneMock,
  useFileCapabilitiesContext: () => ({ capabilities: {} }),
  useFilePreviewModal: () => ({
    isPreviewModalOpen: false,
    fileToPreview: null,
    openPreviewModal: vi.fn(),
    closePreviewModal: vi.fn(),
  }),
  useFacets: () => ({ data: { action_facets: [] } }),
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

// Both chat-input children pull large library surfaces of their own; they are
// not part of the regression under test.
vi.mock("../AddinChatInput", () => ({
  AddinChatInput: () => <div data-testid="addin-chat-input" />,
}));
vi.mock("../AddinSettingsDialog", () => ({
  AddinSettingsDialog: () => null,
}));

function renderWithoutGraphProvider(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe("AddinChat without any Graph provider mounted (Exchange SE / unsupported hosts)", () => {
  beforeEach(() => {
    i18n.activate("en");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders instead of throwing 'Graph auth is not available on this host'", () => {
    expect(() => renderWithoutGraphProvider(<AddinChat />)).not.toThrow();

    expect(screen.getByText("New Chat")).toBeInTheDocument();
    expect(screen.getByTestId("addin-chat-input")).toBeInTheDocument();
  });

  it("renders inside the real OutlookEmailSourceProvider without throwing either", () => {
    expect(() =>
      renderWithoutGraphProvider(
        <OutlookEmailSourceProvider>
          <AddinChat />
        </OutlookEmailSourceProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByText("New Chat")).toBeInTheDocument();
  });

  // With no backend a dropped `.msg` could never be resolved (parseMsgFile
  // only extracts the Message-ID and needs a fetcher for the lookup), so the
  // dropzone must not advertise it — the drop then gets the regular
  // unsupported-file feedback instead of being accepted and silently dropped.
  it("does not advertise .msg drops when no message fetcher is available", () => {
    renderWithoutGraphProvider(<AddinChat />);

    expect(useConversationDropzoneMock).toHaveBeenCalled();
    const dropzoneOptions = useConversationDropzoneMock.mock.calls.at(-1)?.[0];
    expect(dropzoneOptions?.extraAcceptMimeTypes).toEqual({
      "message/rfc822": [".eml"],
    });
  });
});
