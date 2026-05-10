import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";
import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatInput } from "./ChatInput";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";
import type {
  ButtonHTMLAttributes,
  FormEvent,
  HTMLAttributes,
  ReactNode,
} from "react";

const mockUseChatContext = vi.fn();
const mockUseUploadFeature = vi.fn();
const mockUseChatInputFeature = vi.fn();
const mockUseAudioTranscriptionFeature = vi.fn();
const mockUseAudioDictationFeature = vi.fn();
const mockUseOptionalTranslation = vi.fn();
const mockUseActiveModelSelection = vi.fn();
const mockUseTokenManagement = vi.fn();
const mockUseChatInputHandlers = vi.fn();
const mockUseFacets = vi.fn();
const mockUseCreateChat = vi.fn();
const mockFetchGetFile = vi.fn();
const mockModelSelector = vi.fn();
const mockUseAudioDictationRecorder = vi.fn();
const mockUseAudioTranscriptionRecorder = vi.fn();

vi.mock("@/providers/ChatProvider", () => ({
  useChatContext: () => mockUseChatContext(),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUploadFeature: () => mockUseUploadFeature(),
  useChatInputFeature: () => mockUseChatInputFeature(),
  useAudioTranscriptionFeature: () => mockUseAudioTranscriptionFeature(),
  useAudioDictationFeature: () => mockUseAudioDictationFeature(),
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

vi.mock("@/hooks/audio/useAudioDictationRecorder", () => ({
  useAudioDictationRecorder: (...args: unknown[]) =>
    mockUseAudioDictationRecorder(...args),
}));

vi.mock("@/hooks/audio/useAudioTranscriptionRecorder", () => ({
  useAudioTranscriptionRecorder: (...args: unknown[]) =>
    mockUseAudioTranscriptionRecorder(...args),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchGetFile: (...args: unknown[]) => mockFetchGetFile(...args),
  useCreateChat: (...args: unknown[]) => mockUseCreateChat(...args),
  useFacets: (...args: unknown[]) => mockUseFacets(...args),
}));

vi.mock("@/components/ui/FileUpload", () => ({
  FileAttachmentsPreview: ({
    attachedFiles,
    onRemoveFile,
    onRemoveAllFiles,
  }: {
    attachedFiles: FileUploadItem[];
    onRemoveFile: (id: string) => void;
    onRemoveAllFiles: () => void;
  }) => (
    <div>
      <div data-testid="attachments-preview">{attachedFiles.length}</div>
      {attachedFiles.map((file) => (
        <button
          type="button"
          key={file.id}
          onClick={() => onRemoveFile(file.id)}
          data-testid={`remove-file-${file.id}`}
        >
          remove-file
        </button>
      ))}
      <button
        type="button"
        onClick={onRemoveAllFiles}
        data-testid="remove-all-files"
      >
        remove-all
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/FileUpload/FileUploadWithTokenCheck", () => ({
  FileUploadWithTokenCheck: () => <div data-testid="file-upload-control" />,
}));

const mockChatInputTokenUsage = vi.fn();
vi.mock("./ChatInputTokenUsage", () => ({
  ChatInputTokenUsage: (props: unknown) => {
    mockChatInputTokenUsage(props);
    return null;
  },
}));

vi.mock("./FacetSelector", () => ({
  FacetSelector: () => null,
}));

vi.mock("./ModelSelector", () => ({
  ModelSelector: (props: unknown) => {
    mockModelSelector(props);
    return <div data-testid="model-selector" />;
  },
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
  Alert: ({
    children,
    ...props
  }: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock("../Feedback/ChatWarnings/BudgetWarning", () => ({
  BudgetWarning: () => null,
}));

vi.mock("../icons", () => ({
  ArrowUpIcon: () => <span>send</span>,
  LoadingIcon: (props: HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>loading</span>
  ),
  StopIcon: () => <span>stop</span>,
  VoiceIcon: () => <span>record</span>,
}));

describe("ChatInput", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    componentRegistry.ChatInputAttachmentPreview = null;
    componentRegistry.ChatTopLeftAccessory = null;
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });

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
    mockUseAudioTranscriptionFeature.mockReturnValue({ enabled: false });
    mockUseAudioDictationFeature.mockReturnValue({ enabled: false });
    mockUseChatInputFeature.mockReturnValue({
      autofocus: false,
      showUsageAdvisory: true,
    });
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
    mockUseFacets.mockReturnValue({
      data: { facets: [], global_facet_settings: undefined },
      error: null,
    });
    mockUseCreateChat.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ chat_id: "silent-chat-id" }),
    });
    mockFetchGetFile.mockRejectedValue(new Error("fetchGetFile not mocked"));
    mockUseAudioDictationRecorder.mockReturnValue({
      isDictating: false,
      isDictationStarting: false,
      isDictationCompleting: false,
      dictationError: null,
      setDictationError: vi.fn(),
      dictationBars: [2, 2, 2, 2, 2],
      toggleDictation: vi.fn(),
    });
    mockUseAudioTranscriptionRecorder.mockReturnValue({
      isRecording: false,
      isRecordingUpload: false,
      recordingError: null,
      setRecordingError: vi.fn(),
      recordingBars: [2, 2, 2, 2, 2],
      retryingAudioFileId: null,
      retryAudioTranscription: vi.fn(),
      removeRecordedAudioFile: vi.fn(),
      clearRecordedAudioFiles: vi.fn(),
      hasRecordedAudioFile: () => false,
      toggleAudioRecording: vi.fn(),
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

  it("renders the AI usage advisory when enabled", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onSendMessage = vi.fn();
    const advisory =
      "You are interacting with an AI chatbot. Generated answers may contain factual errors and should be verified before use.";

    mockUseOptionalTranslation.mockReturnValue(advisory);

    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText(advisory)).toBeInTheDocument();
  });

  it("hides the AI usage advisory when disabled by feature config", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onSendMessage = vi.fn();
    const advisory =
      "You are interacting with an AI chatbot. Generated answers may contain factual errors and should be verified before use.";

    mockUseChatInputFeature.mockReturnValue({
      autofocus: false,
      showUsageAdvisory: false,
    });
    mockUseOptionalTranslation.mockReturnValue(advisory);

    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByText(advisory)).not.toBeInTheDocument();
  });

  it("uses externally controlled model selection when provided", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onSendMessage = vi.fn();
    const onControlledSelectedModelChange = vi.fn();
    const controlledModel = {
      chat_provider_id: "external-model",
      model_display_name: "External Model",
    };
    const availableModels = [controlledModel];

    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput
            onSendMessage={onSendMessage}
            controlledAvailableModels={availableModels as never}
            controlledSelectedModel={controlledModel as never}
            onControlledSelectedModelChange={
              onControlledSelectedModelChange as never
            }
            controlledIsModelSelectionReady={false}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(mockModelSelector).toHaveBeenCalled();
    const lastCallProps = mockModelSelector.mock.calls.at(-1)?.[0] as {
      availableModels: typeof availableModels;
      selectedModel: typeof controlledModel;
      onModelChange: typeof onControlledSelectedModelChange;
      disabled: boolean;
    };

    expect(lastCallProps.availableModels).toBe(availableModels);
    expect(lastCallProps.selectedModel).toBe(controlledModel);
    expect(lastCallProps.disabled).toBe(true);

    lastCallProps.onModelChange(controlledModel);
    expect(onControlledSelectedModelChange).toHaveBeenCalledWith(
      controlledModel,
    );
  });

  it("hides the inline model selector when a top-left accessory override is registered", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onSendMessage = vi.fn();

    const MockTopLeftAccessory = () => <div data-testid="top-left-accessory" />;
    MockTopLeftAccessory.displayName = "MockTopLeftAccessory";
    componentRegistry.ChatTopLeftAccessory = MockTopLeftAccessory;

    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(mockModelSelector).not.toHaveBeenCalled();
    expect(screen.queryByTestId("model-selector")).toBeNull();
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
        borderColor: "var(--theme-border-chat-input)",
        borderRadius: "var(--theme-radius-input)",
        boxShadow: "var(--theme-elevation-input)",
      },
    );
    expect(
      container.querySelector('[data-ui="chat-input-shell"]')?.className,
    ).toContain("border-[var(--theme-border-chat-input)]");
    expect(
      container.querySelector('[data-ui="chat-input-shell"]')?.className,
    ).toContain("focus-within:border-[var(--theme-border-chat-input-focus)]");
    expect(
      container.querySelector('[data-ui="chat-input-shell"]')?.className,
    ).toContain("chat-input-shell-geometry");
    expect(container.querySelector("textarea")?.className).toContain(
      "chat-input-textarea-geometry",
    );
    expect(
      container.querySelector('[data-ui="chat-input-controls"] > div')
        ?.className,
    ).toContain("chat-input-controls-geometry");
  });

  it("renders the default external attachment preview when no override is registered", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const attachedFiles = [
      {
        id: "file-1",
        filename: "report.pdf",
        download_url: "/files/report.pdf",
        preview_url: undefined,
        file_contents_unavailable_missing_permissions: false,
        file_capability: {
          extensions: ["pdf"],
          id: "pdf",
          mime_types: ["application/pdf"],
          operations: ["extract_text"],
        },
      },
    ] as unknown as FileUploadItem[];

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles,
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
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

    expect(screen.getByTestId("attachments-preview")).toHaveTextContent("1");
    expect(
      container.querySelector('[data-testid="inline-attachment-preview"]'),
    ).toBeNull();
  });

  it("renders the attachment preview override inline inside the input shell and suppresses the external preview", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const attachedFiles = [
      {
        id: "file-1",
        filename: "diagram.png",
        download_url: "/files/diagram.png",
        preview_url: undefined,
        file_contents_unavailable_missing_permissions: false,
        file_capability: {
          extensions: ["png"],
          id: "image",
          mime_types: ["image/png"],
          operations: ["analyze_image"],
        },
      },
    ] as unknown as FileUploadItem[];

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles,
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });

    const MockAttachmentPreview = ({
      attachedFiles: files,
    }: {
      attachedFiles: unknown[];
    }) => <div data-testid="inline-attachment-preview">{files.length}</div>;
    MockAttachmentPreview.displayName = "MockAttachmentPreview";
    componentRegistry.ChatInputAttachmentPreview = MockAttachmentPreview;

    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId("attachments-preview")).toBeNull();
    expect(screen.getByTestId("inline-attachment-preview")).toHaveTextContent(
      "1",
    );

    const shell = container.querySelector('[data-ui="chat-input-shell"]');
    const inlinePreview = container.querySelector(
      '[data-testid="inline-attachment-preview"]',
    );
    const textarea = container.querySelector("textarea");

    expect(shell?.firstElementChild).toBe(inlinePreview);
    expect(inlinePreview?.nextElementSibling).toBe(textarea);
  });

  // Guard against the prop chain silently breaking. The Outlook add-in
  // relies on ChatInput forwarding virtualFiles into ChatInputTokenUsage so
  // the previewed email body counts toward the estimate without going
  // through the upload pipeline.
  it("forwards virtualFiles to ChatInputTokenUsage", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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

    const previewBody = new File(["body"], "preview.eml", {
      type: "message/rfc822",
    });
    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput
            onSendMessage={onSendMessage}
            virtualFiles={[previewBody]}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(mockChatInputTokenUsage).toHaveBeenCalled();
    const lastCall =
      mockChatInputTokenUsage.mock.calls[
        mockChatInputTokenUsage.mock.calls.length - 1
      ][0];
    expect(lastCall.virtualFiles).toEqual([previewBody]);
  });

  it("blocks compose send when attached audio transcription is incomplete", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles: [
        {
          id: "audio-file-1",
          filename: "voicemail.mp3",
          download_url: "/files/voicemail.mp3",
          preview_url: undefined,
          file_contents_unavailable_missing_permissions: false,
          file_capability: {
            extensions: ["mp3"],
            id: "audio",
            mime_types: ["audio/mpeg"],
            operations: ["extract_text"],
          },
          audio_transcription: {
            status: "processing",
          },
        },
      ] as unknown as FileUploadItem[],
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });

    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(
      screen.queryByTestId("chat-audio-transcription-blocker"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-input-send-message")).toBeDisabled();
  });

  it("shows the live transcript section for attached audio files", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles: [
        {
          id: "audio-file-1",
          filename: "voicemail.mp3",
          download_url: "/files/voicemail.mp3",
          preview_url: undefined,
          file_contents_unavailable_missing_permissions: false,
          file_capability: {
            extensions: ["mp3"],
            id: "audio",
            mime_types: ["audio/mpeg"],
            operations: ["extract_text"],
          },
          audio_transcription: {
            status: "completed",
            transcript: "Hello team, this is the transcribed text for testing.",
          },
        },
      ] as unknown as FileUploadItem[],
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });

    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const transcriptSection = screen.getByTestId(
      "chat-audio-transcription-audio-file-1",
    );
    expect(transcriptSection).toBeInTheDocument();
    expect(transcriptSection).toHaveTextContent(
      "Hello team, this is the transcribed text for testing.",
    );
  });

  it("refreshes incomplete audio transcription attachment metadata", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const setAttachedFiles = vi.fn();
    const processingFile = {
      id: "audio-file-refresh",
      filename: "refresh.mp3",
      download_url: "/files/refresh.mp3",
      preview_url: undefined,
      file_contents_unavailable_missing_permissions: false,
      file_capability: {
        extensions: ["mp3"],
        id: "audio",
        mime_types: ["audio/mpeg"],
        operations: ["extract_text"],
      },
      audio_transcription: {
        status: "processing",
        progress: 0.2,
      },
    } as unknown as FileUploadItem;
    const completedFile = {
      ...processingFile,
      audio_transcription: {
        status: "completed",
        progress: 1,
        transcript: "Refreshed transcript.",
      },
    } as unknown as FileUploadItem;

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles: [processingFile],
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles,
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });
    mockFetchGetFile.mockResolvedValue(completedFile);

    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockFetchGetFile).toHaveBeenCalledWith(
        expect.objectContaining({
          pathParams: { fileId: "audio-file-refresh" },
        }),
      );
      expect(setAttachedFiles).toHaveBeenCalledWith([completedFile]);
    });
  });

  it("shows transcript section error details when transcription fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles: [
        {
          id: "audio-file-2",
          filename: "voicemail.wav",
          download_url: "/files/voicemail.wav",
          preview_url: undefined,
          file_contents_unavailable_missing_permissions: false,
          file_capability: {
            extensions: ["wav"],
            id: "audio",
            mime_types: ["audio/wav"],
            operations: ["extract_text"],
          },
          audio_transcription: {
            status: "failed",
            error: "Chunk transcription failed after all retries.",
          },
        },
      ] as unknown as FileUploadItem[],
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });

    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const transcriptSection = screen.getByTestId(
      "chat-audio-transcription-audio-file-2",
    );
    expect(transcriptSection).toBeInTheDocument();
    expect(transcriptSection).toHaveTextContent("Chunk transcription failed");
    expect(
      screen.queryByTestId("chat-audio-transcription-blocker"),
    ).not.toBeInTheDocument();
  });

  it("blocks edit send when attached audio transcription is incomplete", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles: [
        {
          id: "audio-file-2",
          filename: "voicemail.wav",
          download_url: "/files/voicemail.wav",
          preview_url: undefined,
          file_contents_unavailable_missing_permissions: false,
          file_capability: {
            extensions: ["wav"],
            id: "audio",
            mime_types: ["audio/wav"],
            operations: ["extract_text"],
          },
          audio_transcription: {
            status: "processing",
          },
        },
      ] as unknown as FileUploadItem[],
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: vi.fn(),
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });

    const onEditMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput
            onSendMessage={vi.fn()}
            mode="edit"
            onEditMessage={onEditMessage}
            editMessageId="msg-1"
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("chat-input-save-edit")).toBeDisabled();
  });

  it("shows the dictation button when audio transcription is enabled", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseUploadFeature.mockReturnValue({ enabled: false });
    mockUseAudioDictationFeature.mockReturnValue({ enabled: true });

    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("chat-input-record-audio")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input-record-audio")).toHaveAccessibleName(
      "Start dictation",
    );
    expect(screen.getByTestId("chat-input-record-audio")).not.toHaveTextContent(
      "Record",
    );
  });

  it("shows an audio-level dictation waveform that swaps to stop affordance", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseUploadFeature.mockReturnValue({ enabled: false });
    mockUseAudioDictationFeature.mockReturnValue({ enabled: true });
    mockUseAudioDictationRecorder.mockReturnValue({
      isDictating: true,
      isDictationStarting: false,
      isDictationCompleting: false,
      dictationError: null,
      setDictationError: vi.fn(),
      dictationBars: [2, 5, 8, 5, 2],
      toggleDictation: vi.fn(),
    });

    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={vi.fn()} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const button = screen.getByTestId("chat-input-record-audio");
    const waveform = screen.getByTestId("chat-input-dictation-waveform");
    const stopIcon = screen.getByTestId("chat-input-dictation-stop-icon");

    expect(button).toHaveAccessibleName("Stop dictation");
    expect(button).toHaveClass("group", "relative", "overflow-hidden");
    expect(waveform).toHaveClass(
      "group-hover:opacity-0",
      "group-focus-visible:opacity-0",
    );
    expect(waveform.children[2]).toHaveClass(
      "transition-[height]",
      "duration-75",
    );
    expect(waveform.children[2]).not.toHaveClass("dictation-wave-bar");
    expect(waveform.children[2]).toHaveStyle({ height: "14px" });
    expect(stopIcon).toHaveClass(
      "group-hover:opacity-100",
      "group-focus-visible:opacity-100",
    );
    expect(stopIcon).toHaveTextContent("stop");
  });

  it("shows a loading indicator while dictation is finishing", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseAudioDictationFeature.mockReturnValue({ enabled: true });
    mockUseAudioDictationRecorder.mockReturnValue({
      isDictating: false,
      isDictationStarting: false,
      isDictationCompleting: true,
      dictationError: null,
      setDictationError: vi.fn(),
      dictationBars: [2, 2, 2, 2, 2],
      toggleDictation: vi.fn(),
    });

    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={vi.fn()} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const button = screen.getByTestId("chat-input-record-audio");
    const textarea = screen.getByPlaceholderText("Type a message...");
    fireEvent.change(textarea, { target: { value: "Pending text" } });

    expect(button).toHaveAccessibleName("Finishing dictation");
    expect(button).toBeDisabled();
    expect(screen.getByTestId("chat-input-send-message")).toBeDisabled();
    expect(
      screen.getByTestId("chat-input-dictation-loading-icon"),
    ).toHaveTextContent("loading");
  });

  it("does not show the record button when audio transcription is disabled", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseUploadFeature.mockReturnValue({ enabled: true });
    mockUseAudioDictationFeature.mockReturnValue({ enabled: false });

    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(
      screen.queryByTestId("chat-input-record-audio"),
    ).not.toBeInTheDocument();
  });

  it("appends completed dictation chunks to the current textarea text", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockUseAudioDictationFeature.mockReturnValue({ enabled: true });

    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    const textarea = screen.getByPlaceholderText("Type a message...");
    fireEvent.change(textarea, { target: { value: "Existing" } });
    fireEvent.click(screen.getByTestId("chat-input-record-audio"));

    const dictationOptions =
      mockUseAudioDictationRecorder.mock.calls.at(-1)?.[0];
    await act(async () => {
      dictationOptions.onTranscriptChunk({
        chunkIndex: 0,
        transcript: " dictated text ",
      });
    });

    expect(textarea).toHaveValue("Existing dictated text");
  });

  it("warns before removing an audio attachment", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const removeFile = vi.fn();
    const attachedFiles = [
      {
        id: "audio-file-3",
        filename: "conference-call.mp3",
        download_url: "/files/conference-call.mp3",
        preview_url: undefined,
        file_contents_unavailable_missing_permissions: false,
        file_capability: {
          extensions: ["mp3"],
          id: "audio",
          mime_types: ["audio/mpeg"],
          operations: ["extract_text"],
        },
        audio_transcription: {
          status: "completed",
          transcript: "Transcript ready.",
        },
      },
    ] as unknown as FileUploadItem[];

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles,
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: removeFile,
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("remove-file-audio-file-3"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(removeFile).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does remove an audio attachment when confirmation is accepted", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const removeFile = vi.fn();
    const attachedFiles = [
      {
        id: "audio-file-4",
        filename: "interview.mp3",
        download_url: "/files/interview.mp3",
        preview_url: undefined,
        file_contents_unavailable_missing_permissions: false,
        file_capability: {
          extensions: ["mp3"],
          id: "audio",
          mime_types: ["audio/mpeg"],
          operations: ["extract_text"],
        },
        audio_transcription: {
          status: "completed",
          transcript: "Transcript ready.",
        },
      },
    ] as unknown as FileUploadItem[];

    mockUseChatInputHandlers.mockReturnValue({
      attachedFiles,
      fileError: null,
      setFileError: vi.fn(),
      handleFilesUploaded: vi.fn(),
      handleRemoveFile: removeFile,
      handleRemoveAllFiles: vi.fn(),
      setAttachedFiles: vi.fn(),
      createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onSendMessage = vi.fn();
    const { i18n } = await import("@lingui/core");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18n}>
          <ChatInput onSendMessage={onSendMessage} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("remove-file-audio-file-4"));
    expect(removeFile).toHaveBeenCalledWith("audio-file-4");
    confirmSpy.mockRestore();
  });

  describe("audio mode button (transcription)", () => {
    it("shows the audio-mode button instead of send when input is empty", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      expect(
        screen.getByTestId("chat-input-audio-mode-start"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("chat-input-send-message"),
      ).not.toBeInTheDocument();
    });

    it("flips to the send button when the user types and back when cleared", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      const textarea = screen.getByPlaceholderText("Type a message...");
      fireEvent.change(textarea, { target: { value: "hi" } });

      expect(
        screen.getByTestId("chat-input-send-message"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("chat-input-audio-mode-start"),
      ).not.toBeInTheDocument();

      fireEvent.change(textarea, { target: { value: "" } });

      expect(
        screen.getByTestId("chat-input-audio-mode-start"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("chat-input-send-message"),
      ).not.toBeInTheDocument();
    });

    it("does not show the audio-mode button when transcription is disabled", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      expect(
        screen.queryByTestId("chat-input-audio-mode-start"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("chat-input-send-message"),
      ).toBeInTheDocument();
    });

    it("does not show the audio-mode button in edit mode", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput
              onSendMessage={vi.fn()}
              mode="edit"
              editMessageId="m-1"
              onCancelEdit={vi.fn()}
            />
          </I18nProvider>
        </QueryClientProvider>,
      );

      expect(
        screen.queryByTestId("chat-input-audio-mode-start"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-input-save-edit")).toBeInTheDocument();
    });

    it("invokes toggleAudioRecording when the audio-mode button is clicked", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const toggleAudioRecording = vi.fn();
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });
      mockUseAudioTranscriptionRecorder.mockReturnValue({
        isRecording: false,
        isRecordingUpload: false,
        recordingError: null,
        setRecordingError: vi.fn(),
        recordingBars: [2, 2, 2, 2, 2],
        retryingAudioFileId: null,
        retryAudioTranscription: vi.fn(),
        removeRecordedAudioFile: vi.fn(),
        clearRecordedAudioFiles: vi.fn(),
        hasRecordedAudioFile: () => false,
        toggleAudioRecording,
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      fireEvent.click(screen.getByTestId("chat-input-audio-mode-start"));
      expect(toggleAudioRecording).toHaveBeenCalledTimes(1);
    });

    it("keeps the audio-mode button (in stop state) while recording", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });
      mockUseAudioTranscriptionRecorder.mockReturnValue({
        isRecording: true,
        isRecordingUpload: false,
        recordingError: null,
        setRecordingError: vi.fn(),
        recordingBars: [3, 6, 9, 6, 3],
        retryingAudioFileId: null,
        retryAudioTranscription: vi.fn(),
        removeRecordedAudioFile: vi.fn(),
        clearRecordedAudioFiles: vi.fn(),
        hasRecordedAudioFile: () => false,
        toggleAudioRecording: vi.fn(),
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      const stopButton = screen.getByTestId("chat-input-audio-mode-stop");
      expect(stopButton).toBeInTheDocument();
      expect(stopButton).toHaveAccessibleName("Stop audio recording");
      expect(
        screen.getByTestId("chat-input-audio-mode-recording-waveform"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("chat-input-audio-mode-stop-icon"),
      ).toBeInTheDocument();
    });

    it("shows the cancel-generation button (not audio-mode) while a response is pending", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });
      mockUseChatContext.mockReturnValue({
        isPendingResponse: true,
        isMessagingLoading: false,
        isUploading: false,
        cancelMessage: vi.fn(),
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      expect(
        screen.getByTestId("chat-input-stop-generation"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("chat-input-audio-mode-start"),
      ).not.toBeInTheDocument();
    });

    it("hides the audio-mode button when only an attachment is present", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });
      mockUseChatInputHandlers.mockReturnValue({
        attachedFiles: [
          {
            id: "f-1",
            filename: "notes.pdf",
            download_url: "/files/f-1",
          },
        ] as unknown as FileUploadItem[],
        fileError: null,
        setFileError: vi.fn(),
        handleFilesUploaded: vi.fn(),
        handleRemoveFile: vi.fn(),
        handleRemoveAllFiles: vi.fn(),
        setAttachedFiles: vi.fn(),
        createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      expect(
        screen.queryByTestId("chat-input-audio-mode-start"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("chat-input-send-message"),
      ).toBeInTheDocument();
    });

    it("disables the audio-mode button while dictation is active", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });
      mockUseAudioDictationFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });
      mockUseAudioDictationRecorder.mockReturnValue({
        isDictating: true,
        isDictationStarting: false,
        isDictationCompleting: false,
        dictationError: null,
        setDictationError: vi.fn(),
        dictationBars: [2, 5, 8, 5, 2],
        toggleDictation: vi.fn(),
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      expect(screen.getByTestId("chat-input-audio-mode-start")).toBeDisabled();
    });

    it("disables the audio-mode button while an attachment is still transcribing", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      mockUseAudioTranscriptionFeature.mockReturnValue({
        enabled: true,
        maxRecordingDurationSeconds: 1200,
      });
      mockUseChatInputHandlers.mockReturnValue({
        attachedFiles: [
          {
            id: "audio-in-progress",
            filename: "voice-memo.wav",
            download_url: "/files/audio-in-progress",
            audio_transcription: { status: "transcribing" },
          },
        ] as unknown as FileUploadItem[],
        fileError: null,
        setFileError: vi.fn(),
        handleFilesUploaded: vi.fn(),
        handleRemoveFile: vi.fn(),
        handleRemoveAllFiles: vi.fn(),
        setAttachedFiles: vi.fn(),
        createSubmitHandler: () => (event: FormEvent) => event.preventDefault(),
      });

      const { i18n } = await import("@lingui/core");
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider i18n={i18n}>
            <ChatInput onSendMessage={vi.fn()} />
          </I18nProvider>
        </QueryClientProvider>,
      );

      // An in-progress transcription counts as an attachment, so the slot
      // shows the send button (also disabled). The audio-mode button is not
      // available while another transcription is still running.
      expect(
        screen.queryByTestId("chat-input-audio-mode-start"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-input-send-message")).toBeDisabled();
    });
  });
});
