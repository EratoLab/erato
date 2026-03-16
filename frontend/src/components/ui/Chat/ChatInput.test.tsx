import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatInput } from "./ChatInput";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from "react";

const mockUseChatContext = vi.fn();
const mockUseUploadFeature = vi.fn();
const mockUseChatInputFeature = vi.fn();
const mockUseOptionalTranslation = vi.fn();
const mockUseActiveModelSelection = vi.fn();
const mockUseTokenManagement = vi.fn();
const mockUseChatInputHandlers = vi.fn();
const mockUseFileDropzone = vi.fn();
const mockUseFacets = vi.fn();

vi.mock("@/providers/ChatProvider", () => ({
  useChatContext: () => mockUseChatContext(),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUploadFeature: () => mockUseUploadFeature(),
  useChatInputFeature: () => mockUseChatInputFeature(),
}));

vi.mock("@/hooks/i18n", () => ({
  useOptionalTranslation: (id: string) => mockUseOptionalTranslation(id),
}));

vi.mock("@/hooks/chat", () => ({
  useTokenManagement: () => mockUseTokenManagement(),
  useActiveModelSelection: () => mockUseActiveModelSelection(),
}));

vi.mock("@/hooks/ui", () => ({
  useChatInputHandlers: (...args: unknown[]) =>
    mockUseChatInputHandlers(...args),
}));

vi.mock("@/hooks/files", () => ({
  useFileDropzone: (...args: unknown[]) => mockUseFileDropzone(...args),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useFacets: (...args: unknown[]) => mockUseFacets(...args),
}));

vi.mock("@/components/ui/FileUpload", () => ({
  FileAttachmentsPreview: ({
    attachedFiles,
  }: {
    attachedFiles: FileUploadItem[];
  }) => <div data-testid="attachments-preview">{attachedFiles.length}</div>,
}));

vi.mock("@/components/ui/FileUpload/FileUploadWithTokenCheck", () => ({
  FileUploadWithTokenCheck: () => <div data-testid="file-upload-control" />,
}));

vi.mock("./ChatInputTokenUsage", () => ({
  ChatInputTokenUsage: () => null,
}));

vi.mock("./FacetSelector", () => ({
  FacetSelector: () => null,
}));

vi.mock("./ModelSelector", () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock("../Controls/Button", () => ({
  Button: ({
    children,
    icon,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactNode;
  }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
}));

vi.mock("../Feedback/Alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../Feedback/ChatWarnings/BudgetWarning", () => ({
  BudgetWarning: () => null,
}));

vi.mock("../icons", () => ({
  ArrowUpIcon: () => <span>send</span>,
  StopIcon: () => <span>stop</span>,
}));

describe("ChatInput", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");

    mockUseChatContext.mockReturnValue({
      isPendingResponse: false,
      isMessagingLoading: false,
      isUploading: false,
      cancelMessage: vi.fn(),
    });

    mockUseUploadFeature.mockReturnValue({ enabled: false });
    mockUseChatInputFeature.mockReturnValue({ autofocus: false });
    mockUseOptionalTranslation.mockReturnValue(null);
    mockUseActiveModelSelection.mockReturnValue({
      availableModels: [],
      selectedModel: null,
      setSelectedModel: vi.fn(),
      isSelectionReady: true,
    });
    mockUseTokenManagement.mockReturnValue({
      isAnyTokenLimitExceeded: false,
      handleMessageTokenLimitExceeded: vi.fn(),
      handleFileTokenLimitExceeded: vi.fn(),
      resetTokenLimits: vi.fn(),
      resetTokenLimitsOnFileRemoval: vi.fn(),
    });
    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles: [],
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });
    mockUseFileDropzone.mockReturnValue({
      uploadedFiles: [],
      error: null,
      uploadFiles: vi.fn(),
    });
    mockUseFacets.mockReturnValue({
      data: { facets: [], global_facet_settings: undefined },
      error: null,
    });
  });

  it("re-focuses the chat textarea when a response finishes streaming", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onSendMessage = vi.fn();

    const { i18n } = await import("@lingui/core");
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const textarea = screen.getByPlaceholderText("Type a message...");
    const otherButton = document.createElement("button");
    otherButton.type = "button";
    document.body.appendChild(otherButton);

    mockUseChatContext.mockReturnValue({
      isPendingResponse: true,
      isMessagingLoading: false,
      isUploading: false,
      cancelMessage: vi.fn(),
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      otherButton.focus();
    });
    expect(otherButton).toHaveFocus();

    mockUseChatContext.mockReturnValue({
      isPendingResponse: false,
      isMessagingLoading: false,
      isUploading: false,
      cancelMessage: vi.fn(),
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(undefined)),
      );
    });

    expect(textarea).toHaveFocus();
    otherButton.remove();
  });

  it("exposes stable shell hooks for theme.css selectors", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onSendMessage = vi.fn();

    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(
      container.querySelector('[data-ui="chat-input-shell"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-ui="chat-input-controls"]'),
    ).toBeTruthy();

    expect(container.firstElementChild).toHaveStyle({
      maxWidth: "var(--theme-layout-chat-input-max-width)",
    });
    expect(container.querySelector('[data-ui="chat-input-shell"]')).toHaveStyle(
      {
        backgroundColor: "var(--theme-shell-chat-input)",
        borderRadius: "var(--theme-radius-input)",
        boxShadow: "var(--theme-elevation-input)",
        padding:
          "var(--theme-spacing-input-padding-y) var(--theme-spacing-input-padding-x)",
        gap: "var(--theme-spacing-input-gap)",
      },
    );
    expect(
      container.querySelector('[data-ui="chat-input-controls"] > div'),
    ).toHaveStyle({
      gap: "var(--theme-spacing-control-gap)",
    });
  });
});
