import { t } from "@lingui/core/macro";
import clsx from "clsx";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
} from "react";

import { FileAttachmentsPreview } from "@/components/ui/FileUpload";
import { FileUploadWithTokenCheck } from "@/components/ui/FileUpload/FileUploadWithTokenCheck";
import { componentRegistry } from "@/config/componentRegistry";
import { useAudioDictationRecorder } from "@/hooks/audio/useAudioDictationRecorder";
import { useAudioTranscriptionRecorder } from "@/hooks/audio/useAudioTranscriptionRecorder";
import { useTokenManagement, useActiveModelSelection } from "@/hooks/chat";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useComposeSession } from "@/hooks/chat/useComposeSession";
import { UnsupportedFileTypeError } from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { useOptionalTranslation } from "@/hooks/i18n";
import { useChatInputHandlers } from "@/hooks/ui";
import {
  fetchGetFile,
  useFacets,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useV1betaApiContext } from "@/lib/generated/v1betaApi/v1betaApiContext";
import { useChatContext } from "@/providers/ChatProvider";
import {
  useUploadFeature,
  useChatInputFeature,
  useAudioTranscriptionFeature,
  useAudioDictationFeature,
  useAudioConversationalFeature,
} from "@/providers/FeatureConfigProvider";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import { resolveChatSendErrorMessage } from "@/utils/chatSendErrorMessage";
import { createLogger } from "@/utils/debugLogger";

import { ArrowUpIcon, LoadingIcon, StopIcon, VoiceIcon } from "../icons";
import { ChatInputAudioModeButton } from "./ChatInputAudioModeButton";
import { ChatInputTokenUsage } from "./ChatInputTokenUsage";
import { FacetSelector } from "./FacetSelector";
import { ModelSelector } from "./ModelSelector";
import { WaveformButton } from "./WaveformButton";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { BudgetWarning } from "../Feedback/ChatWarnings/BudgetWarning";
import { toast } from "../Toast/toast";

import type { ChatInputControlsHandle } from "./ChatInputControlsContext";
import type { ToastAction } from "../Toast/types";
import type { AudioDictationTranscriptChunk } from "@/hooks/audio/useAudioDictationRecorder";
import type {
  FileUploadItem,
  ChatModel,
  ContentPart,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { ClipboardEvent as ReactClipboardEvent, Ref } from "react";

const logger = createLogger("UI", "ChatInput");
const AUDIO_TRANSCRIPTION_STATUS_POLL_INTERVAL_MS = 1000;
const AUDIO_MODE_SELECTOR_TOAST_ID = "chat-input-audio-mode-selector-toast";
const AUDIO_MODE_SELECTOR_DEDUPE_KEY = "chat-input-audio-mode-selector";
const CONVERSATIONAL_AUTO_SEND_EMPTY_TRANSCRIPT_TIMEOUT_MS = 8000;

type AudioTranscriptionAttachment = {
  fileId: string;
  filename: string;
  status: string;
  transcript?: string | null;
  error?: string | null;
  progress?: number | null;
  chunks?:
    | {
        index: number;
        start_ms: number | null;
        end_ms: number | null;
        byte_start: number | null;
        byte_end: number | null;
        status: string;
        transcript?: string | null;
        attempts: number;
        error?: string | null;
      }[]
    | null;
};

function getCompletedChunkTranscript(
  chunks?: AudioTranscriptionAttachment["chunks"],
): string | undefined {
  if (!chunks || chunks.length === 0) {
    return undefined;
  }

  const completedChunkText = chunks
    .filter((chunk) => chunk.status.toLowerCase() === "completed")
    .map((chunk) => chunk.transcript?.trim())
    .filter((transcript): transcript is string => Boolean(transcript))
    .join(" ");

  return completedChunkText.length > 0 ? completedChunkText : undefined;
}

function isAudioTranscriptionComplete(
  status?: string,
  chunks?: AudioTranscriptionAttachment["chunks"],
): boolean {
  const normalizedStatus = status?.toLowerCase();

  if (normalizedStatus) {
    return normalizedStatus === "completed";
  }

  if (!chunks || chunks.length === 0) {
    return false;
  }

  return chunks.every((chunk) => chunk.status.toLowerCase() === "completed");
}

function getDisplayTranscript(
  transcript?: string | null,
  chunks?: AudioTranscriptionAttachment["chunks"],
): string | undefined {
  if (transcript?.trim()) {
    return transcript;
  }

  return getCompletedChunkTranscript(chunks);
}

function getDisplayAudioTranscriptionStatus(status: string) {
  const normalizedStatus = status.toLowerCase();

  switch (normalizedStatus) {
    case "completed":
      return t`Completed`;
    case "failed":
      return t`Failed`;
    case "recording":
      return t`Recording`;
    case "uploading":
      return t`Uploading`;
    case "transcribing":
      return t`Transcribing`;
    case "canceled":
      return t`Canceled`;
    default:
      return status;
  }
}

function isAudioTranscriptionAttachment(file: FileUploadItem): boolean {
  return Boolean(file.audio_transcription);
}

function isAudioTranscriptionInProgress(status: string) {
  const normalizedStatus = status.toLowerCase();

  return !["completed", "failed", "canceled"].includes(normalizedStatus);
}

function areFacetIdListsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((facetId, index) => facetId === b[index]);
}

interface ChatInputProps {
  onSendMessage: (
    message: string,
    inputFileIds?: string[],
    modelId?: string,
    selectedFacetIds?: string[],
  ) => void;
  onRegenerate?: () => void;
  // Optional edit mode submit handler. When provided with mode="edit", submit will call this instead of onSendMessage
  onEditMessage?: (
    messageId: string,
    newContent: string,
    replaceInputFileIds?: string[],
    selectedFacetIds?: string[],
  ) => void;
  // Optional cancel callback for edit mode
  onCancelEdit?: () => void;
  handleFileAttachments?: (files: FileUploadItem[]) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  showControls?: boolean;
  /** Limit the total number of files that can be attached */
  maxFiles?: number;
  /** Array of accepted file types, or empty for all enabled types */
  acceptedFileTypes?: FileType[];
  /** Initial files to display (optional) */
  initialFiles?: FileUploadItem[];
  /**
   * Inline `File`s that should count toward the token estimate without
   * being persisted as uploads. The Outlook add-in passes its previewed
   * email body here. Pass a memoized array — the underlying React Query
   * cache derives a digest from each file's metadata, so an unstable
   * reference will thrash the cache.
   */
  virtualFiles?: File[];
  /** Show file type in previews */
  showFileTypes?: boolean;
  // Add prop for preview callback
  onFilePreview?: (file: FileUploadItem) => void;
  // Add prop for current chat ID
  chatId?: string | null;
  // Optional assistant ID for silent chat creation during uploads
  assistantId?: string;
  // Add prop for previous message ID
  previousMessageId?: string | null;
  // Control whether the input is editing an existing message or composing a new one
  mode?: "compose" | "edit";
  // Target message id to edit when in edit mode
  editMessageId?: string;
  // Initial content when entering edit mode (used to prefill the textarea)
  editInitialContent?: ContentPart[];
  // Initial model to use for selection (typically from chat history)
  initialModel?: ChatModel | null;
  // Initial facets to use for selection (typically from chat history)
  initialSelectedFacetIds?: string[] | undefined;
  // Prevent changes to selected facets from the chat UI
  enforceSelectedFacetIds?: boolean;
  // Optional callback whenever facet selection changes
  onFacetSelectionChange?: (selectedFacetIds: string[]) => void;
  uploadFiles?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  uploadError?: Error | string | null;
  onSelectedChatProviderIdChange?: (chatProviderId: string | null) => void;
  controlledAvailableModels?: ChatModel[];
  controlledSelectedModel?: ChatModel | null;
  onControlledSelectedModelChange?: (model: ChatModel) => void;
  controlledIsModelSelectionReady?: boolean;
  /**
   * Controlled `isAudioMode`. When the parent owns the state (e.g. to
   * survive `Chat`'s empty-state ↔ messages layout flip that otherwise
   * unmounts `ChatInput`), pass both this and
   * `onControlledIsAudioModeChange`. Omit both to use internal state.
   */
  controlledIsAudioMode?: boolean;
  onControlledIsAudioModeChange?: (isAudioMode: boolean) => void;
}

type DictationTarget =
  | {
      mode: "compose";
      sessionId: string;
      nextChunkIndex: number;
      chunkTranscripts: Map<number, string>;
    }
  | {
      mode: "edit";
      editMessageId?: string;
      nextChunkIndex: number;
      chunkTranscripts: Map<number, string>;
    };

function appendDictationText(current: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) {
    return current;
  }
  if (!current.trim()) {
    return text;
  }
  return /\s$/.test(current) ? `${current}${text}` : `${current} ${text}`;
}

/**
 * ChatInput component with file attachment capabilities
 */
type ChatInputPropsWithRef = ChatInputProps & {
  ref?: Ref<ChatInputControlsHandle>;
};

export const ChatInput = ({
  onSendMessage,
  onRegenerate: _onRegenerate,
  onEditMessage,
  onCancelEdit,
  handleFileAttachments,
  isLoading: propIsLoading,
  disabled = false,
  className = "",
  placeholder = t`Type a message...`,
  showControls = true,
  maxFiles = 5,
  acceptedFileTypes = [],
  initialFiles = [],
  virtualFiles,
  showFileTypes = false,
  // Destructure the new props
  onFilePreview,
  chatId,
  assistantId,
  previousMessageId,
  mode = "compose",
  editMessageId,
  editInitialContent,
  initialModel,
  initialSelectedFacetIds,
  enforceSelectedFacetIds = false,
  onFacetSelectionChange,
  uploadFiles: externalUploadFiles,
  uploadError: externalUploadError = null,
  onSelectedChatProviderIdChange,
  controlledAvailableModels,
  controlledSelectedModel,
  onControlledSelectedModelChange,
  controlledIsModelSelectionReady,
  controlledIsAudioMode,
  onControlledIsAudioModeChange,
  ref,
}: ChatInputPropsWithRef) => {
  const [message, setMessage] = useState("");
  const [internalIsAudioMode, setInternalIsAudioMode] = useState(false);
  const [conversationStartSignal, setConversationStartSignal] = useState(0);
  const [conversationAutoSendSignal, setConversationAutoSendSignal] =
    useState(0);
  const isAudioMode = controlledIsAudioMode ?? internalIsAudioMode;
  // Audio mode is the only piece of ChatInput state that needs to survive
  // the layout flip in `Chat` (empty-state shell → messages shell), which
  // tears down ChatInput because of position-based reconciliation. When
  // the parent passes the controlled props, writes go up to the parent
  // and the internal state stays dormant — same pattern used for the
  // controlled model selection above.
  const setIsAudioMode = useCallback(
    (next: boolean) => {
      if (onControlledIsAudioModeChange) {
        onControlledIsAudioModeChange(next);
        return;
      }
      setInternalIsAudioMode(next);
    },
    [onControlledIsAudioModeChange],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Latched intent for conversational audio mode: VAD decided the user's
  // turn ended, and the dictated text should be submitted after the final
  // dictation chunk lands.
  const pendingAutoSendRef = useRef(false);
  const pendingAutoSendTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingConversationalStartRef = useRef(false);
  const shouldRestartAudioModeAfterResponseRef = useRef(false);
  const audioModeRestartSawPendingResponseRef = useRef(false);
  const previousModeRef = useRef<"compose" | "edit">(mode);
  const previousEditMessageIdRef = useRef<string | undefined>(undefined);
  const {
    sessionId: composeSessionId,
    getActiveSessionId,
    getDraft: getComposeDraftBySessionId,
    saveDraft: saveComposeDraftBySessionId,
  } = useComposeSession({ chatId });
  const dictationTargetRef = useRef<DictationTarget | null>(null);
  // Add state for file button processing
  const [isFileButtonProcessing, setIsFileButtonProcessing] = useState(false);
  const pendingSelectedFacetIdsRef = useRef<string[] | null>(null);
  const pendingSelectedChatProviderIdRef = useRef<string | null>(null);
  const audioTranscriptionStatusLastPollAtRef = useRef(0);
  const audioTranscriptionStatusPollIndexRef = useRef(0);
  const audioTranscriptionStatusPollInFlightRef = useRef(false);

  // Get necessary state from context instead of useChat()
  // isPendingResponse is true immediately when send is clicked (before streaming starts)
  const {
    isPendingResponse,
    isMessagingLoading,
    isUploading,
    cancelMessage,
    messagingError,
  } = useChatContext();
  const setMessagingError = useMessagingStore((state) => state.setError);
  const silentChatId = useFileUploadStore((state) => state.silentChatId);
  const setSilentChatId = useFileUploadStore((state) => state.setSilentChatId);
  const sendErrorText = useMemo(
    () => resolveChatSendErrorMessage(messagingError),
    [messagingError],
  );
  const wasPendingResponseRef = useRef(isPendingResponse);

  const clearPendingAutoSendTimeout = useCallback(() => {
    if (pendingAutoSendTimeoutRef.current === null) {
      return;
    }

    clearTimeout(pendingAutoSendTimeoutRef.current);
    pendingAutoSendTimeoutRef.current = null;
  }, []);

  const handleConversationVadAutoStop = useCallback(() => {
    clearPendingAutoSendTimeout();
    pendingAutoSendRef.current = true;
    setConversationAutoSendSignal((signal) => signal + 1);
  }, [clearPendingAutoSendTimeout]);

  // Combine loading states
  const isLoading = propIsLoading ?? isMessagingLoading;

  // Get feature configurations
  const { enabled: uploadEnabled } = useUploadFeature();
  const {
    enabled: audioTranscriptionEnabled,
    maxRecordingDurationSeconds,
    showModelSelectorInAudioMode,
  } = useAudioTranscriptionFeature();
  const {
    enabled: audioDictationEnabled,
    maxRecordingDurationSeconds: maxDictationDurationSeconds,
  } = useAudioDictationFeature();
  const {
    enabled: audioConversationalEnabled,
    maxRecordingDurationSeconds: maxConversationalDurationSeconds,
  } = useAudioConversationalFeature();
  const { autofocus: shouldAutofocus, showUsageAdvisory = true } =
    useChatInputFeature();
  // Dummy for i18n:extract
  const _aiUsageAdvisoryDefault = t({
    id: "chat.ai_usage_advisory",
    message:
      "You are interacting with an AI chatbot. Generated answers may contain factual errors and should be verified before use.",
  });
  const aiUsageAdvisory = useOptionalTranslation("chat.ai_usage_advisory");

  // Use local model selection hook
  const {
    availableModels: internalAvailableModels,
    selectedModel: internalSelectedModel,
    setSelectedModel: setInternalSelectedModel,
    isSelectionReady: internalIsSelectionReady,
  } = useActiveModelSelection({
    initialModel,
  });

  const availableModels = controlledAvailableModels ?? internalAvailableModels;
  const selectedModel = controlledSelectedModel ?? internalSelectedModel;
  const isSelectionReady =
    controlledIsModelSelectionReady ?? internalIsSelectionReady;
  const setSelectedModel = useCallback(
    (model: ChatModel) => {
      if (onControlledSelectedModelChange) {
        onControlledSelectedModelChange(model);
        return;
      }
      setInternalSelectedModel(model);
    },
    [onControlledSelectedModelChange, setInternalSelectedModel],
  );

  // Use our token management hook
  const {
    // Individual token limit states are not used directly but through isAnyTokenLimitExceeded
    isAnyTokenLimitExceeded,
    handleMessageTokenLimitExceeded,
    handleFileTokenLimitExceeded,
    resetTokenLimits,
    resetTokenLimitsOnFileRemoval,
  } = useTokenManagement();

  // Use the custom hook for chat input handling
  const {
    attachedFiles,
    fileError,
    setFileError,
    handleFilesUploaded,
    handleRemoveFile,
    handleRemoveAllFiles,
    setAttachedFiles,
    createSubmitHandler,
  } = useChatInputHandlers(maxFiles, handleFileAttachments, initialFiles);

  const hasComposeContent =
    message.trim().length > 0 || attachedFiles.length > 0;

  const {
    isRecording,
    isRecordingUpload,
    recordingError,
    setRecordingError,
    recordingBars,
    retryingAudioFileId,
    retryAudioTranscription,
    removeRecordedAudioFile,
    clearRecordedAudioFiles,
    hasRecordedAudioFile,
    toggleAudioRecording,
  } = useAudioTranscriptionRecorder({
    audioTranscriptionEnabled,
    uploadEnabled,
    maxRecordingDurationSeconds,
    vadAutoStopEnabled: false,
    chatId,
    silentChatId,
    setSilentChatId,
    assistantId,
    selectedModel,
    attachedFiles,
    setAttachedFiles,
  });

  const appendDictationTranscript = useCallback(
    ({ chunkIndex, transcript }: AudioDictationTranscriptChunk) => {
      const target = dictationTargetRef.current;
      if (!target) {
        return;
      }

      target.chunkTranscripts.set(chunkIndex, transcript);

      while (target.chunkTranscripts.has(target.nextChunkIndex)) {
        const nextTranscript =
          target.chunkTranscripts.get(target.nextChunkIndex) ?? "";
        target.chunkTranscripts.delete(target.nextChunkIndex);
        target.nextChunkIndex += 1;

        if (target.mode === "compose") {
          if (mode === "compose" && target.sessionId === getActiveSessionId()) {
            setMessage((current) =>
              appendDictationText(current, nextTranscript),
            );
            continue;
          }

          const draft = getComposeDraftBySessionId(target.sessionId);
          saveComposeDraftBySessionId(target.sessionId, {
            ...draft,
            message: appendDictationText(draft.message, nextTranscript),
          });
          continue;
        }

        if (
          mode === "edit" &&
          target.editMessageId !== undefined &&
          target.editMessageId === editMessageId
        ) {
          setMessage((current) => appendDictationText(current, nextTranscript));
        }
      }
    },
    [
      editMessageId,
      getActiveSessionId,
      getComposeDraftBySessionId,
      mode,
      saveComposeDraftBySessionId,
    ],
  );

  const {
    isDictating,
    isDictationStarting,
    isDictationCompleting,
    isCapturingAudio,
    dictationError,
    setDictationError,
    dictationBars,
    toggleDictation,
  } = useAudioDictationRecorder({
    enabled: audioDictationEnabled || audioConversationalEnabled,
    mode: isAudioMode ? "conversational" : "dictation",
    maxRecordingDurationSeconds: isAudioMode
      ? maxConversationalDurationSeconds
      : maxDictationDurationSeconds,
    onTranscriptChunk: appendDictationTranscript,
    vadAutoStopEnabled:
      audioConversationalEnabled && isAudioMode && mode === "compose",
    onVadAutoStop: handleConversationVadAutoStop,
  });

  const toggleDictationForCurrentTarget = useCallback(() => {
    if (!isDictating) {
      dictationTargetRef.current =
        mode === "compose"
          ? {
              mode: "compose",
              sessionId: getActiveSessionId(),
              nextChunkIndex: 0,
              chunkTranscripts: new Map(),
            }
          : {
              mode: "edit",
              editMessageId,
              nextChunkIndex: 0,
              chunkTranscripts: new Map(),
            };
    }

    toggleDictation();
  }, [editMessageId, getActiveSessionId, isDictating, mode, toggleDictation]);

  const { data: facetsData, error: facetsError } = useFacets({});
  const { fetcherOptions: fileFetchOptions } = useV1betaApiContext();
  const fileFetchOptionsRef = useRef(fileFetchOptions);
  const availableFacets = useMemo(() => facetsData?.facets ?? [], [facetsData]);
  const globalFacetSettings = facetsData?.global_facet_settings;

  const [selectedFacetIds, setSelectedFacetIds] = useState<string[]>([]);

  const facetIdsByDefault = useMemo(() => {
    return availableFacets
      .filter((facet) => facet.default_enabled)
      .map((facet) => facet.id);
  }, [availableFacets]);

  const sanitizeFacetSelection = useCallback(
    (facetIds: string[]) => {
      const availableFacetIdSet = new Set(
        availableFacets.map((facet) => facet.id),
      );
      let nextSelectedFacetIds = facetIds.filter((facetId) =>
        availableFacetIdSet.has(facetId),
      );
      if (
        globalFacetSettings?.only_single_facet &&
        nextSelectedFacetIds.length
      ) {
        nextSelectedFacetIds = nextSelectedFacetIds.slice(0, 1);
      }
      return nextSelectedFacetIds;
    },
    [availableFacets, globalFacetSettings?.only_single_facet],
  );

  const applySelectedFacetIds = useCallback(
    (nextSelectedFacetIds: string[]) => {
      if (enforceSelectedFacetIds) {
        const lockedSelectedFacetIds = sanitizeFacetSelection(
          initialSelectedFacetIds ?? [],
        );
        pendingSelectedFacetIdsRef.current = null;
        setSelectedFacetIds(lockedSelectedFacetIds);
        onFacetSelectionChange?.(lockedSelectedFacetIds);
        return;
      }

      pendingSelectedFacetIdsRef.current = nextSelectedFacetIds;
      if (availableFacets.length === 0) {
        setSelectedFacetIds([]);
        onFacetSelectionChange?.([]);
        return;
      }
      const sanitizedSelectedFacetIds =
        sanitizeFacetSelection(nextSelectedFacetIds);
      pendingSelectedFacetIdsRef.current = null;
      setSelectedFacetIds(sanitizedSelectedFacetIds);
      onFacetSelectionChange?.(sanitizedSelectedFacetIds);
    },
    [
      availableFacets.length,
      enforceSelectedFacetIds,
      initialSelectedFacetIds,
      onFacetSelectionChange,
      sanitizeFacetSelection,
    ],
  );

  const toggleFacetId = useCallback(
    (facetId: string) => {
      if (enforceSelectedFacetIds) {
        return;
      }

      const isSelected = selectedFacetIds.includes(facetId);
      const nextSelectedFacetIds = isSelected
        ? selectedFacetIds.filter((id) => id !== facetId)
        : globalFacetSettings?.only_single_facet
          ? [facetId]
          : [...selectedFacetIds, facetId];
      applySelectedFacetIds(nextSelectedFacetIds);
    },
    [
      applySelectedFacetIds,
      enforceSelectedFacetIds,
      globalFacetSettings?.only_single_facet,
      selectedFacetIds,
    ],
  );

  const setDraftMessage = useCallback(
    (nextMessage: string, options?: { focus?: boolean }) => {
      setMessage(nextMessage);
      if (options?.focus ?? true) {
        textareaRef.current?.focus();
      }
    },
    [],
  );

  const focusInput = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const applySelectedChatProviderId = useCallback(
    (chatProviderId: string) => {
      pendingSelectedChatProviderIdRef.current = chatProviderId;
      if (availableModels.length === 0) {
        return;
      }

      const matchedModel = availableModels.find(
        (model) => model.chat_provider_id === chatProviderId,
      );
      if (!matchedModel) {
        return;
      }

      pendingSelectedChatProviderIdRef.current = null;
      setSelectedModel(matchedModel);
    },
    [availableModels, setSelectedModel],
  );

  useImperativeHandle(
    ref,
    () => ({
      setDraftMessage,
      focusInput,
      setSelectedFacetIds: applySelectedFacetIds,
      setSelectedChatProviderId: applySelectedChatProviderId,
      toggleFacetId,
      addUploadedFiles: handleFilesUploaded,
    }),
    [
      handleFilesUploaded,
      applySelectedChatProviderId,
      applySelectedFacetIds,
      focusInput,
      setDraftMessage,
      toggleFacetId,
    ],
  );

  useEffect(() => {
    const pendingSelectedChatProviderId =
      pendingSelectedChatProviderIdRef.current;
    if (!pendingSelectedChatProviderId || availableModels.length === 0) {
      return;
    }

    const matchedModel = availableModels.find(
      (model) => model.chat_provider_id === pendingSelectedChatProviderId,
    );
    if (!matchedModel) {
      return;
    }

    pendingSelectedChatProviderIdRef.current = null;
    setSelectedModel(matchedModel);
  }, [availableModels, setSelectedModel]);

  useEffect(() => {
    if (externalUploadError instanceof Error) {
      setFileError(externalUploadError.message);
    } else if (typeof externalUploadError === "string") {
      setFileError(externalUploadError);
    } else {
      setFileError(null);
    }
  }, [externalUploadError, setFileError]);

  useEffect(() => {
    onSelectedChatProviderIdChange?.(selectedModel?.chat_provider_id ?? null);
  }, [onSelectedChatProviderIdChange, selectedModel?.chat_provider_id]);

  // Tracks the session whose draft is currently mirrored into local
  // `message` / `attachedFiles`. The chat-switch effect below advances this
  // ref atomically with the swap, which means the per-change persist effect
  // always writes under the OLD session id during a switch render —
  // preventing it from polluting the incoming session's draft before the
  // swap reads it.
  const activeComposeSessionIdRef = useRef(composeSessionId);

  // Persist compose-mode draft state for the currently active session.
  useEffect(() => {
    if (mode !== "compose") {
      return;
    }
    saveComposeDraftBySessionId(activeComposeSessionIdRef.current, {
      message,
      attachedFiles,
    });
  }, [mode, message, attachedFiles, saveComposeDraftBySessionId]);

  // On chat switch, persist outgoing draft against the previous session and
  // restore the incoming draft for the new session. Because the session id
  // *follows* the chat across a sentinel → real-chatId rename, that
  // transition does NOT trigger a switch here — the session stays the same.
  useEffect(() => {
    if (mode !== "compose") {
      activeComposeSessionIdRef.current = composeSessionId;
      return;
    }

    const previousSessionId = activeComposeSessionIdRef.current;
    if (previousSessionId === composeSessionId) {
      return;
    }

    saveComposeDraftBySessionId(previousSessionId, { message, attachedFiles });
    const incoming = getComposeDraftBySessionId(composeSessionId);
    activeComposeSessionIdRef.current = composeSessionId;
    setMessage(incoming.message);
    setAttachedFiles(incoming.attachedFiles);
  }, [
    mode,
    composeSessionId,
    message,
    attachedFiles,
    getComposeDraftBySessionId,
    saveComposeDraftBySessionId,
    setAttachedFiles,
  ]);

  useEffect(() => {
    if (availableFacets.length === 0) {
      setSelectedFacetIds((previousSelectedFacetIds) =>
        previousSelectedFacetIds.length === 0 ? previousSelectedFacetIds : [],
      );
      onFacetSelectionChange?.([]);
      return;
    }

    const hasExplicitInitialSelection = initialSelectedFacetIds !== undefined;
    const hasPendingSelection = pendingSelectedFacetIdsRef.current !== null;
    const initialSelection = hasPendingSelection
      ? pendingSelectedFacetIdsRef.current
      : hasExplicitInitialSelection
        ? initialSelectedFacetIds
        : facetIdsByDefault;
    const nextSelectedFacetIds = sanitizeFacetSelection(initialSelection ?? []);

    setSelectedFacetIds((previousSelectedFacetIds) =>
      areFacetIdListsEqual(previousSelectedFacetIds, nextSelectedFacetIds)
        ? previousSelectedFacetIds
        : nextSelectedFacetIds,
    );
    if (hasPendingSelection) {
      pendingSelectedFacetIdsRef.current = null;
      onFacetSelectionChange?.(nextSelectedFacetIds);
      return;
    }
    if (
      !hasExplicitInitialSelection ||
      !areFacetIdListsEqual(initialSelectedFacetIds, nextSelectedFacetIds)
    ) {
      onFacetSelectionChange?.(nextSelectedFacetIds);
    }
  }, [
    availableFacets,
    chatId,
    facetIdsByDefault,
    initialSelectedFacetIds,
    onFacetSelectionChange,
    sanitizeFacetSelection,
  ]);

  // Log attachedFiles received from the hook
  logger.log("Received attachedFiles from hook:", attachedFiles);

  // Prefill message when entering edit mode
  useEffect(() => {
    const wasMode = previousModeRef.current;
    const enteringCompose = mode === "compose" && wasMode !== "compose";
    const editTargetChanged =
      mode === "edit" && editMessageId !== previousEditMessageIdRef.current;
    const enteringEdit = mode === "edit" && wasMode !== "edit";

    if (mode === "edit" && (enteringEdit || editTargetChanged)) {
      if (editInitialContent !== undefined) {
        setMessage(extractTextFromContent(editInitialContent));
      }
      setAttachedFiles(initialFiles);
      previousEditMessageIdRef.current = editMessageId;
    }

    if (enteringCompose) {
      const composeDraft = getComposeDraftBySessionId(composeSessionId);
      setMessage(composeDraft.message);
      setAttachedFiles(composeDraft.attachedFiles);
      previousEditMessageIdRef.current = undefined;
    }

    previousModeRef.current = mode;
  }, [
    mode,
    editMessageId,
    editInitialContent,
    initialFiles,
    composeSessionId,
    getComposeDraftBySessionId,
    setAttachedFiles,
  ]);

  const hasIncompleteAudioTranscription = attachedFiles.some(
    (file) =>
      file.audio_transcription &&
      !isAudioTranscriptionComplete(
        file.audio_transcription.status,
        file.audio_transcription.chunks,
      ),
  );

  useEffect(() => {
    fileFetchOptionsRef.current = fileFetchOptions;
  }, [fileFetchOptions]);

  const incompleteAudioTranscriptionFileIds = useMemo(
    () =>
      attachedFiles
        .filter(
          (file) =>
            file.audio_transcription &&
            !isAudioTranscriptionComplete(
              file.audio_transcription.status,
              file.audio_transcription.chunks,
            ),
        )
        .map((file) => file.id),
    [attachedFiles],
  );

  useEffect(() => {
    if (incompleteAudioTranscriptionFileIds.length === 0) {
      return;
    }

    let isCancelled = false;

    const refreshNextIncompleteAudioTranscription = async () => {
      if (audioTranscriptionStatusPollInFlightRef.current) {
        return;
      }

      const now = Date.now();
      if (
        now - audioTranscriptionStatusLastPollAtRef.current <
        AUDIO_TRANSCRIPTION_STATUS_POLL_INTERVAL_MS
      ) {
        return;
      }

      audioTranscriptionStatusLastPollAtRef.current = now;
      audioTranscriptionStatusPollInFlightRef.current = true;

      const fileId =
        incompleteAudioTranscriptionFileIds[
          audioTranscriptionStatusPollIndexRef.current %
            incompleteAudioTranscriptionFileIds.length
        ];
      audioTranscriptionStatusPollIndexRef.current += 1;

      try {
        const refreshedFile = await fetchGetFile({
          ...fileFetchOptionsRef.current,
          pathParams: { fileId },
        });

        if (isCancelled) {
          return;
        }

        setAttachedFiles(
          attachedFiles.map((file) =>
            file.id === refreshedFile.id ? refreshedFile : file,
          ),
        );
      } catch {
        // Status polling is best-effort; keep the existing attachment state
        // when a transient refresh request fails.
      } finally {
        audioTranscriptionStatusPollInFlightRef.current = false;
      }
    };

    void refreshNextIncompleteAudioTranscription();
    const intervalId = window.setInterval(
      () => void refreshNextIncompleteAudioTranscription(),
      AUDIO_TRANSCRIPTION_STATUS_POLL_INTERVAL_MS,
    );

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [attachedFiles, incompleteAudioTranscriptionFileIds, setAttachedFiles]);

  const audioTranscriptionAttachments = useMemo(
    (): AudioTranscriptionAttachment[] =>
      attachedFiles.flatMap((file) => {
        const audioTranscription = file.audio_transcription;
        if (!audioTranscription) {
          return [];
        }

        return [
          {
            fileId: file.id,
            filename: file.filename,
            status: audioTranscription.status ?? "unknown",
            transcript: getDisplayTranscript(
              audioTranscription.transcript,
              audioTranscription.chunks,
            ),
            progress: audioTranscription.progress,
            chunks: audioTranscription.chunks,
            error: audioTranscription.error,
          },
        ];
      }),
    [attachedFiles],
  );

  // Create the submit handler
  // Use isPendingResponse instead of isStreaming to block submission immediately when send is clicked
  //
  // Important: do NOT wrap this in useCallback/useMemo with narrow deps.
  // `createSubmitHandler` captures `message`, `attachedFiles`, the
  // disabled flag, and the inner submit callback at call time. The
  // audio-mode auto-send relies on `handleSubmit` being rebuilt with
  // fresh values every render so that `formRef.current?.requestSubmit()`
  // (fired from a post-commit effect) sees the just-committed state.
  // Memoizing this silently breaks auto-send.
  const handleSubmit = createSubmitHandler(
    message,
    attachedFiles,
    (messageContent, inputFileIds) => {
      // Don't allow sending if token limit is exceeded
      if (isAnyTokenLimitExceeded) {
        return;
      }
      // Don't allow sending until transcription completes for attached audio files
      if (hasIncompleteAudioTranscription) {
        return;
      }
      if (isDictationCompleting) {
        return;
      }

      logger.log("Submit:", {
        mode,
        editMessageId,
        messagePreview:
          messageContent.substring(0, 20) +
          (messageContent.length > 20 ? "..." : ""),
        files: inputFileIds,
        model: selectedModel?.chat_provider_id,
        selectedFacetIds,
      });
      if (mode === "edit" && onEditMessage && editMessageId) {
        onEditMessage(
          editMessageId,
          messageContent,
          inputFileIds,
          selectedFacetIds,
        );
      } else {
        onSendMessage(
          messageContent,
          inputFileIds,
          selectedModel?.chat_provider_id,
          selectedFacetIds,
        );
      }
    },
    isLoading ||
      isPendingResponse ||
      hasIncompleteAudioTranscription ||
      isDictating ||
      isDictationStarting ||
      isDictationCompleting,
    disabled,
    () => setMessage(""),
  );

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  useEffect(() => {
    const wasPendingResponse = wasPendingResponseRef.current;
    wasPendingResponseRef.current = isPendingResponse;

    if (wasPendingResponse && !isPendingResponse && mode === "compose") {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [isPendingResponse, mode]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!externalUploadFiles) {
        return undefined;
      }

      const uploadedFiles = await externalUploadFiles(files);
      if (uploadedFiles && uploadedFiles.length > 0) {
        handleFilesUploaded(uploadedFiles);
      }

      return uploadedFiles;
    },
    [externalUploadFiles, handleFilesUploaded],
  );

  const handleTextareaPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (
        disabled ||
        isLoading ||
        isPendingResponse ||
        isUploading ||
        !externalUploadFiles
      ) {
        return;
      }

      const imageFiles = Array.from(event.clipboardData.items)
        .filter(
          (item) =>
            item.kind === "file" &&
            // eslint-disable-next-line lingui/no-unlocalized-strings
            item.type.startsWith("image/"),
        )
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (imageFiles.length === 0) {
        return;
      }

      // Image paste should attach files, not insert text/HTML into the input.
      event.preventDefault();
      void uploadFiles(imageFiles);
    },
    [
      disabled,
      isLoading,
      isPendingResponse,
      isUploading,
      externalUploadFiles,
      uploadFiles,
    ],
  );

  // Combine disabled states
  // Use isPendingResponse instead of isStreaming to disable immediately when send is clicked
  const isDisabled =
    disabled ||
    isUploading || // From context (drag & drop)
    isLoading ||
    isPendingResponse || // True immediately when send is clicked
    isFileButtonProcessing || // From button callback
    isRecording || // Prevent edits while recording
    isRecordingUpload; // Prevent edits while uploading recording

  // Add token limit exceeded to disabled state for the send button
  const isSendDisabled =
    isDisabled ||
    isAnyTokenLimitExceeded ||
    hasIncompleteAudioTranscription ||
    isDictating ||
    isDictationStarting ||
    isDictationCompleting;

  // Enhanced file removal handler using token management hook
  const handleRemoveFileById = useCallback(
    (fileId: string) => {
      const fileToRemove = attachedFiles.find((file) => file.id === fileId);
      if (
        fileToRemove &&
        isAudioTranscriptionAttachment(fileToRemove) &&
        !window.confirm(
          t`Removing this audio attachment will also clear its transcription. Continue?`,
        )
      ) {
        return;
      }

      removeRecordedAudioFile(fileId);
      handleRemoveFile(fileId);

      // Reset token limits if this was the last file
      resetTokenLimitsOnFileRemoval(
        attachedFiles.length - 1,
        message.trim().length,
      );
    },
    [
      handleRemoveFile,
      removeRecordedAudioFile,
      attachedFiles,
      message,
      resetTokenLimitsOnFileRemoval,
    ],
  );

  // Enhanced version of handleRemoveAllFiles that also resets token limits
  const handleRemoveAllFilesWithTokenReset = useCallback(() => {
    clearRecordedAudioFiles();
    handleRemoveAllFiles();

    // Reset token limits when all files are removed
    resetTokenLimits(message.trim().length);
  }, [
    clearRecordedAudioFiles,
    handleRemoveAllFiles,
    resetTokenLimits,
    message,
  ]);

  // Callback for file button processing state change
  const handleFileButtonProcessingChange = useCallback(
    (isProcessing: boolean) => {
      setIsFileButtonProcessing(isProcessing);
    },
    [],
  );

  // Determine if send button should be enabled
  // Use isPendingResponse instead of isStreaming to disable immediately when send is clicked
  const canSendMessage =
    (message.trim() || attachedFiles.length > 0) &&
    !isLoading &&
    !isPendingResponse &&
    !disabled &&
    !isUploading &&
    !isAnyTokenLimitExceeded &&
    !isRecording &&
    !hasIncompleteAudioTranscription &&
    !isDictationCompleting;

  const isConversationalAudioActive =
    isAudioMode &&
    (isCapturingAudio ||
      isDictating ||
      isDictationStarting ||
      isDictationCompleting);

  const shouldShowAudioModeSelector =
    audioConversationalEnabled &&
    audioTranscriptionEnabled &&
    mode === "compose";

  // The send button slot becomes the audio entry point when the compose
  // input is clean. If both audio paths are enabled, it asks the user which
  // mode to start; otherwise it starts the one available audio flow.
  const showAudioModeButton =
    (audioConversationalEnabled || audioTranscriptionEnabled) &&
    mode === "compose" &&
    (isAudioMode ||
      (!hasComposeContent &&
        !isRecording &&
        !isRecordingUpload &&
        !isCapturingAudio &&
        !isDictating &&
        !isDictationStarting &&
        !isDictationCompleting));
  const isAudioModeButtonDisabled =
    disabled ||
    isLoading ||
    isUploading ||
    isFileButtonProcessing ||
    isAnyTokenLimitExceeded ||
    hasIncompleteAudioTranscription ||
    isRecording ||
    isRecordingUpload ||
    isDictationCompleting;

  const startConversationalAudioMode = useCallback(() => {
    if (!audioConversationalEnabled) {
      return;
    }

    toast.dismiss(AUDIO_MODE_SELECTOR_TOAST_ID);
    clearPendingAutoSendTimeout();
    pendingAutoSendRef.current = false;
    pendingConversationalStartRef.current = true;
    setConversationStartSignal((signal) => signal + 1);
    if (!isAudioMode) {
      setIsAudioMode(true);
    }
  }, [
    audioConversationalEnabled,
    clearPendingAutoSendTimeout,
    isAudioMode,
    setIsAudioMode,
  ]);

  useEffect(() => {
    if (!pendingConversationalStartRef.current) {
      return;
    }
    if (!audioConversationalEnabled || mode !== "compose") {
      pendingConversationalStartRef.current = false;
      return;
    }
    if (!isAudioMode) {
      return;
    }
    if (
      disabled ||
      isLoading ||
      isUploading ||
      isFileButtonProcessing ||
      isAnyTokenLimitExceeded ||
      isRecording ||
      isRecordingUpload ||
      hasIncompleteAudioTranscription ||
      attachedFiles.length > 0 ||
      message.trim().length > 0 ||
      isCapturingAudio ||
      isDictating ||
      isDictationStarting ||
      isDictationCompleting
    ) {
      pendingConversationalStartRef.current = false;
      return;
    }

    pendingConversationalStartRef.current = false;
    toggleDictationForCurrentTarget();
  }, [
    attachedFiles.length,
    audioConversationalEnabled,
    conversationStartSignal,
    disabled,
    hasIncompleteAudioTranscription,
    isAnyTokenLimitExceeded,
    isAudioMode,
    isCapturingAudio,
    isDictating,
    isDictationCompleting,
    isDictationStarting,
    isFileButtonProcessing,
    isLoading,
    isRecording,
    isRecordingUpload,
    isUploading,
    message,
    mode,
    toggleDictationForCurrentTarget,
  ]);

  const startTranscriptAudioMode = useCallback(() => {
    if (!audioTranscriptionEnabled || isRecording || isRecordingUpload) {
      return;
    }

    toast.dismiss(AUDIO_MODE_SELECTOR_TOAST_ID);
    clearPendingAutoSendTimeout();
    pendingAutoSendRef.current = false;
    pendingConversationalStartRef.current = false;
    setIsAudioMode(false);
    toggleAudioRecording();
  }, [
    audioTranscriptionEnabled,
    clearPendingAutoSendTimeout,
    isRecording,
    isRecordingUpload,
    setIsAudioMode,
    toggleAudioRecording,
  ]);

  const showAudioModeChoiceToast = useCallback(() => {
    const actions: ToastAction[] = [];

    if (audioConversationalEnabled) {
      actions.push({
        id: "conversation",
        label: t`Conversational`,
        variant: "primary",
        onClick: startConversationalAudioMode,
      });
    }

    if (audioTranscriptionEnabled) {
      actions.push({
        id: "transcript",
        label: t`Transcript`,
        variant: audioConversationalEnabled ? "secondary" : "primary",
        onClick: startTranscriptAudioMode,
      });
    }

    if (actions.length === 0) {
      return;
    }

    toast.custom({
      id: AUDIO_MODE_SELECTOR_TOAST_ID,
      variant: "info",
      hideIcon: true,
      dedupeKey: AUDIO_MODE_SELECTOR_DEDUPE_KEY,
      title: t`Choose audio mode`,
      description: t`Use conversational mode for auto-send after a pause, or transcript mode for a manual audio attachment.`,
      actions,
    });
  }, [
    audioConversationalEnabled,
    audioTranscriptionEnabled,
    startConversationalAudioMode,
    startTranscriptAudioMode,
  ]);

  // Conversational audio mode swaps the typing surface for dictation +
  // VAD. VAD owns auto-send; a manual stop cancels the conversational
  // session and returns to the normal composer so the dictated text can be
  // reviewed or sent explicitly.
  const handleAudioModeButtonToggle = useCallback(() => {
    if (isConversationalAudioActive) {
      clearPendingAutoSendTimeout();
      pendingAutoSendRef.current = false;
      pendingConversationalStartRef.current = false;
      toggleDictationForCurrentTarget();
      setIsAudioMode(false);
      return;
    }

    if (shouldShowAudioModeSelector && !isAudioMode) {
      showAudioModeChoiceToast();
      return;
    }

    if (audioConversationalEnabled) {
      startConversationalAudioMode();
      return;
    }

    startTranscriptAudioMode();
  }, [
    audioConversationalEnabled,
    clearPendingAutoSendTimeout,
    isConversationalAudioActive,
    isAudioMode,
    setIsAudioMode,
    showAudioModeChoiceToast,
    shouldShowAudioModeSelector,
    startConversationalAudioMode,
    startTranscriptAudioMode,
    toggleDictationForCurrentTarget,
  ]);

  const exitAudioMode = useCallback(() => {
    clearPendingAutoSendTimeout();
    pendingAutoSendRef.current = false;
    pendingConversationalStartRef.current = false;
    toast.dismiss(AUDIO_MODE_SELECTOR_TOAST_ID);
    shouldRestartAudioModeAfterResponseRef.current = false;
    audioModeRestartSawPendingResponseRef.current = false;
    if (isDictating || isDictationStarting) {
      toggleDictationForCurrentTarget();
    }
    if (isRecording) {
      toggleAudioRecording();
    }
    setIsAudioMode(false);
  }, [
    clearPendingAutoSendTimeout,
    isDictating,
    isDictationStarting,
    isRecording,
    setIsAudioMode,
    toggleAudioRecording,
    toggleDictationForCurrentTarget,
  ]);

  useEffect(() => {
    if (mode !== "compose") {
      toast.dismiss(AUDIO_MODE_SELECTOR_TOAST_ID);
    }

    if (mode !== "compose" && isAudioMode) {
      clearPendingAutoSendTimeout();
      pendingAutoSendRef.current = false;
      pendingConversationalStartRef.current = false;
      shouldRestartAudioModeAfterResponseRef.current = false;
      audioModeRestartSawPendingResponseRef.current = false;
      if (isDictating || isDictationStarting) {
        toggleDictationForCurrentTarget();
      }
      setIsAudioMode(false);
    }
  }, [
    mode,
    isAudioMode,
    isDictating,
    isDictationStarting,
    clearPendingAutoSendTimeout,
    setIsAudioMode,
    toggleDictationForCurrentTarget,
  ]);

  // Surface any audio error as a "drop the pending auto-send"
  // signal so the user has to consciously retry — otherwise a silent
  // failure would still trigger a stale submit when the next transcript
  // chunk resolves.
  useEffect(() => {
    if (recordingError || dictationError) {
      clearPendingAutoSendTimeout();
      pendingAutoSendRef.current = false;
      pendingConversationalStartRef.current = false;
      shouldRestartAudioModeAfterResponseRef.current = false;
      audioModeRestartSawPendingResponseRef.current = false;
    }
  }, [clearPendingAutoSendTimeout, dictationError, recordingError]);

  useEffect(() => {
    return () => {
      clearPendingAutoSendTimeout();
    };
  }, [clearPendingAutoSendTimeout]);

  // Auto-send latch: VAD marks the spoken turn complete, then dictation
  // finishes its final chunk. Only then do we submit the text draft.
  useEffect(() => {
    if (!pendingAutoSendRef.current) {
      return;
    }
    if (!isAudioMode) {
      clearPendingAutoSendTimeout();
      pendingAutoSendRef.current = false;
      return;
    }
    if (
      isDictating ||
      isDictationStarting ||
      isDictationCompleting ||
      hasIncompleteAudioTranscription
    ) {
      return;
    }
    if (isPendingResponse) {
      return;
    }
    if (
      disabled ||
      isLoading ||
      isUploading ||
      isFileButtonProcessing ||
      isAnyTokenLimitExceeded
    ) {
      return;
    }
    if (attachedFiles.length > 0) {
      clearPendingAutoSendTimeout();
      pendingAutoSendRef.current = false;
      return;
    }
    if (!message.trim()) {
      // Dictation final text can arrive just after VAD stops. Keep the latch
      // briefly, but do not let a stale speech_end auto-submit future typing.
      pendingAutoSendTimeoutRef.current ??= setTimeout(() => {
        pendingAutoSendTimeoutRef.current = null;
        pendingAutoSendRef.current = false;
      }, CONVERSATIONAL_AUTO_SEND_EMPTY_TRANSCRIPT_TIMEOUT_MS);
      return;
    }
    clearPendingAutoSendTimeout();
    pendingAutoSendRef.current = false;
    shouldRestartAudioModeAfterResponseRef.current = true;
    audioModeRestartSawPendingResponseRef.current = false;
    formRef.current?.requestSubmit();
  }, [
    message,
    isAudioMode,
    isDictating,
    isDictationStarting,
    isDictationCompleting,
    isPendingResponse,
    disabled,
    isLoading,
    isUploading,
    isFileButtonProcessing,
    isAnyTokenLimitExceeded,
    hasIncompleteAudioTranscription,
    attachedFiles.length,
    conversationAutoSendSignal,
    clearPendingAutoSendTimeout,
  ]);

  useEffect(() => {
    if (shouldRestartAudioModeAfterResponseRef.current && isPendingResponse) {
      audioModeRestartSawPendingResponseRef.current = true;
    }
  }, [isPendingResponse]);

  useEffect(() => {
    if (!shouldRestartAudioModeAfterResponseRef.current) {
      return;
    }
    if (!isPendingResponse) {
      return;
    }
    if (
      !isAudioMode ||
      mode !== "compose" ||
      disabled ||
      isLoading ||
      isUploading ||
      isFileButtonProcessing ||
      isAnyTokenLimitExceeded ||
      isRecording ||
      isRecordingUpload ||
      hasIncompleteAudioTranscription ||
      message.trim().length > 0 ||
      attachedFiles.length > 0 ||
      isCapturingAudio ||
      isDictating ||
      isDictationStarting ||
      isDictationCompleting
    ) {
      return;
    }

    shouldRestartAudioModeAfterResponseRef.current = false;
    toggleDictationForCurrentTarget();
  }, [
    attachedFiles.length,
    disabled,
    hasIncompleteAudioTranscription,
    isAnyTokenLimitExceeded,
    isAudioMode,
    isCapturingAudio,
    isDictating,
    isDictationCompleting,
    isDictationStarting,
    isFileButtonProcessing,
    isLoading,
    isPendingResponse,
    isRecording,
    isRecordingUpload,
    isUploading,
    message,
    mode,
    toggleDictationForCurrentTarget,
  ]);

  useEffect(() => {
    if (!shouldRestartAudioModeAfterResponseRef.current) {
      return;
    }
    if (!audioModeRestartSawPendingResponseRef.current) {
      return;
    }
    if (!isAudioMode || mode !== "compose" || isPendingResponse) {
      return;
    }
    if (
      disabled ||
      isLoading ||
      isUploading ||
      isFileButtonProcessing ||
      isAnyTokenLimitExceeded ||
      isRecording ||
      isRecordingUpload ||
      hasIncompleteAudioTranscription ||
      message.trim().length > 0 ||
      attachedFiles.length > 0 ||
      isCapturingAudio ||
      isDictating ||
      isDictationStarting ||
      isDictationCompleting
    ) {
      return;
    }

    shouldRestartAudioModeAfterResponseRef.current = false;
    audioModeRestartSawPendingResponseRef.current = false;
    toggleDictationForCurrentTarget();
  }, [
    attachedFiles.length,
    disabled,
    hasIncompleteAudioTranscription,
    isAnyTokenLimitExceeded,
    isAudioMode,
    isCapturingAudio,
    isDictating,
    isDictationCompleting,
    isDictationStarting,
    isFileButtonProcessing,
    isLoading,
    isPendingResponse,
    isRecording,
    isRecordingUpload,
    isUploading,
    message,
    mode,
    toggleDictationForCurrentTarget,
  ]);

  // Log just before rendering the component and its preview section
  logger.log(
    "Rendering component. Preview should render if attachedFiles > 0. attachedFiles:",
    attachedFiles,
  );

  // Helper function to get the appropriate file error message
  const getFileErrorMessage = useCallback(() => {
    if (externalUploadError instanceof UnsupportedFileTypeError) {
      const filename = externalUploadError.filenames[0];
      const filenames = externalUploadError.filenames.join(", ");
      return externalUploadError.filenames.length === 1
        ? t`The file "${filename}" cannot be processed by the AI and was not uploaded.`
        : t`The following files cannot be processed and were not uploaded: ${filenames}`;
    }
    return fileError;
  }, [externalUploadError, fileError]);

  const ChatInputAttachmentPreview =
    componentRegistry.ChatInputAttachmentPreview;
  const hasAttachmentPreviewOverride = ChatInputAttachmentPreview !== null;
  const hasTopLeftAccessoryOverride =
    componentRegistry.ChatTopLeftAccessory !== null;

  const shellWrapperStyle = {
    maxWidth: "var(--theme-layout-chat-input-max-width)",
  } as const;

  const inputShellStyle = {
    backgroundColor: "var(--theme-shell-chat-input)",
    borderRadius: "var(--theme-radius-input)",
    boxShadow: "var(--theme-elevation-input)",
  } as const;

  return (
    <div className="mx-auto w-full" style={shellWrapperStyle}>
      <form
        ref={formRef}
        className={clsx("w-full ", className, {
          "pb-0 sm:pb-0": aiUsageAdvisory,
        })}
        onSubmit={handleSubmit}
      >
        {/* Token usage warnings */}
        <ChatInputTokenUsage
          message={message}
          attachedFiles={attachedFiles}
          virtualFiles={virtualFiles}
          chatId={chatId}
          assistantId={assistantId}
          previousMessageId={previousMessageId}
          chatProviderId={selectedModel?.chat_provider_id}
          disabled={isDisabled}
          onLimitExceeded={handleMessageTokenLimitExceeded}
        />

        {/* Budget warning - shows when user approaches spending limit */}
        <BudgetWarning />

        {audioTranscriptionAttachments.length > 0 && (
          <div className="mb-2 space-y-2">
            {audioTranscriptionAttachments.map((attachment) =>
              (() => {
                const displayStatus = getDisplayAudioTranscriptionStatus(
                  attachment.status,
                );

                return (
                  <div
                    key={attachment.fileId}
                    className="mb-0 border bg-theme-bg-primary text-theme-fg-primary [border-color:var(--theme-border-attachment)]"
                    style={{
                      borderRadius: "var(--theme-radius-message)",
                      padding:
                        "var(--theme-spacing-message-padding-y) var(--theme-spacing-message-padding-x)",
                    }}
                    role="status"
                    data-testid={`chat-audio-transcription-${attachment.fileId}`}
                  >
                    <p
                      className={clsx(
                        "flex items-center gap-2 text-sm font-medium",
                        isAudioTranscriptionInProgress(attachment.status) &&
                          "animate-pulse",
                      )}
                    >
                      <VoiceIcon
                        className="size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        {t`Audio recording - Status: ${displayStatus}`}
                      </span>
                    </p>
                    {attachment.transcript?.trim() && (
                      <p className="mt-2 whitespace-pre-wrap rounded-md border border-theme-border bg-theme-bg-secondary p-2 text-sm">
                        {attachment.transcript}
                      </p>
                    )}
                    {attachment.error?.trim() && (
                      <p className="mt-1 text-sm text-theme-error-fg">
                        {attachment.error}
                      </p>
                    )}
                    {attachment.status.toLowerCase() === "failed" &&
                      hasRecordedAudioFile(attachment.fileId) && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            retryAudioTranscription(attachment.fileId)
                          }
                          disabled={
                            retryingAudioFileId === attachment.fileId ||
                            isDisabled ||
                            isRecordingUpload
                          }
                          className="mt-2"
                          data-testid={`chat-input-retry-audio-${attachment.fileId}`}
                        >
                          {retryingAudioFileId === attachment.fileId
                            ? t`Retrying...`
                            : t`Retry transcription`}
                        </Button>
                      )}
                  </div>
                );
              })(),
            )}
          </div>
        )}

        {!hasAttachmentPreviewOverride && (
          <FileAttachmentsPreview
            attachedFiles={attachedFiles}
            maxFiles={maxFiles}
            onRemoveFile={handleRemoveFileById}
            onRemoveAllFiles={handleRemoveAllFilesWithTokenReset}
            onFilePreview={onFilePreview}
            disabled={isDisabled}
            showFileTypes={showFileTypes}
            surfaceVariant="message"
          />
        )}

        {/* File error message */}
        {fileError && (
          <Alert
            type="error"
            geometryVariant="message"
            dismissible
            onDismiss={() => setFileError(null)}
            className="mb-2"
            data-testid="file-upload-error"
          >
            {getFileErrorMessage()}
          </Alert>
        )}

        {/* Send / streaming error (e.g. action-facet payload too large). */}
        {sendErrorText && (
          <Alert
            type="error"
            geometryVariant="message"
            dismissible
            onDismiss={() => setMessagingError(null)}
            className="mb-2"
            data-testid="chat-send-error"
          >
            {sendErrorText}
          </Alert>
        )}
        {(dictationError ?? recordingError) && (
          <Alert
            type="error"
            geometryVariant="message"
            dismissible
            onDismiss={() => {
              setDictationError(null);
              setRecordingError(null);
            }}
            className="mb-2"
            data-testid="chat-audio-recording-error"
          >
            {dictationError ?? recordingError}
          </Alert>
        )}

        <div
          className={clsx(
            "w-full",
            "border border-[var(--theme-border-chat-input)]",
            "theme-transition focus-within:border-[var(--theme-border-chat-input-focus)]",
            "flex flex-col",
            "chat-input-shell-geometry",
          )}
          style={inputShellStyle}
          data-ui="chat-input-shell"
        >
          {ChatInputAttachmentPreview && (
            <ChatInputAttachmentPreview
              attachedFiles={attachedFiles}
              maxFiles={maxFiles}
              onRemoveFile={handleRemoveFileById}
              onRemoveAllFiles={handleRemoveAllFilesWithTokenReset}
              onFilePreview={onFilePreview}
              disabled={isDisabled}
              showFileTypes={showFileTypes}
            />
          )}

          {!isAudioMode && (
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onPaste={handleTextareaPaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={
                isAnyTokenLimitExceeded
                  ? t`Message exceeds token limit. Please reduce length or remove files.`
                  : mode === "edit"
                    ? t`Edit your message...`
                    : placeholder
              }
              rows={1}
              disabled={
                isLoading || isPendingResponse || disabled || isUploading
              }
              tabIndex={0}
              autoFocus={shouldAutofocus} // eslint-disable-line jsx-a11y/no-autofocus -- Controlled by feature config to prevent unwanted scrolling
              className={clsx(
                "w-full resize-none overflow-y-auto",
                "chat-input-textarea-geometry",
                "bg-transparent",
                "text-[var(--theme-fg-primary)] placeholder:text-[var(--theme-fg-muted)]",
                "focus:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "max-h-[200px]",
                "text-base",
                "scrollbar-auto-hide",
                isAnyTokenLimitExceeded &&
                  "border-[var(--theme-error)] placeholder:text-[var(--theme-error-fg)]",
              )}
            />
          )}

          <div
            className="flex flex-wrap items-center justify-between gap-[calc(var(--theme-spacing-control-gap)/2)]"
            data-ui="chat-input-controls"
          >
            <div className="chat-input-controls-geometry flex min-w-0 flex-wrap items-center">
              {showControls && (
                <>
                  {/* File Upload Button with Token Check */}
                  {handleFileAttachments && uploadEnabled && (
                    <FileUploadWithTokenCheck
                      message={message}
                      chatId={chatId}
                      assistantId={assistantId}
                      previousMessageId={previousMessageId}
                      chatProviderId={selectedModel?.chat_provider_id}
                      onFilesUploaded={handleFilesUploaded}
                      onTokenLimitExceeded={handleFileTokenLimitExceeded}
                      performFileUpload={uploadFiles}
                      uploadError={
                        externalUploadError instanceof Error
                          ? externalUploadError
                          : null
                      }
                      // Pass the callback for processing state
                      onProcessingChange={handleFileButtonProcessingChange}
                      acceptedFileTypes={acceptedFileTypes}
                      multiple={maxFiles > 1}
                      iconOnly
                      className="p-1"
                      disabled={
                        attachedFiles.length >= maxFiles ||
                        isLoading ||
                        isPendingResponse ||
                        disabled ||
                        isUploading || // isUploading from context (drag & drop)
                        isFileButtonProcessing // Add button processing state
                      }
                    />
                  )}
                  {availableFacets.length > 0 && (
                    <FacetSelector
                      facets={availableFacets}
                      selectedFacetIds={selectedFacetIds}
                      onSelectionChange={(nextSelectedFacetIds) => {
                        setSelectedFacetIds(nextSelectedFacetIds);
                        onFacetSelectionChange?.(nextSelectedFacetIds);
                      }}
                      onlySingleFacet={
                        globalFacetSettings?.only_single_facet ?? false
                      }
                      showFacetIndicatorWithDisplayName={
                        globalFacetSettings?.show_facet_indicator_with_display_name ??
                        false
                      }
                      disabled={isDisabled || enforceSelectedFacetIds}
                    />
                  )}
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-[var(--theme-spacing-control-gap)]">
              {mode === "edit" && onCancelEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCancelEdit}
                  data-testid="chat-input-cancel-edit"
                >
                  {t`Cancel`}
                </Button>
              )}
              {isAudioMode && mode === "compose" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={exitAudioMode}
                  disabled={disabled || isLoading || isPendingResponse}
                  data-testid="chat-input-exit-audio-mode"
                  aria-label={t`Exit audio mode`}
                >
                  {t`Exit audio mode`}
                </Button>
              )}
              {!hasTopLeftAccessoryOverride &&
                !(isAudioMode && !showModelSelectorInAudioMode) && (
                  <ModelSelector
                    availableModels={availableModels}
                    selectedModel={selectedModel}
                    onModelChange={setSelectedModel}
                    disabled={!isSelectionReady}
                  />
                )}
              {isAudioMode &&
                isPendingResponse &&
                isConversationalAudioActive && (
                  <WaveformButton
                    onClick={handleAudioModeButtonToggle}
                    bars={dictationBars}
                    isBuffering={!isCapturingAudio || !isDictating}
                    disabled={disabled || isLoading || isDictationCompleting}
                    ariaLabel={t`Stop audio mode`}
                    statusLabel={t`Listening for your next message`}
                    testIds={{
                      root: "chat-input-audio-mode-pending-recording",
                      waveform:
                        "chat-input-audio-mode-pending-recording-waveform",
                      stopIcon:
                        "chat-input-audio-mode-pending-recording-stop-icon",
                    }}
                  />
                )}
              {audioTranscriptionEnabled && !isAudioMode && isRecording && (
                <WaveformButton
                  onClick={toggleAudioRecording}
                  bars={recordingBars}
                  disabled={disabled || isLoading}
                  ariaLabel={t`Stop audio transcript recording`}
                  statusLabel={t`Recording audio transcript`}
                  testIds={{
                    root: "chat-input-record-audio-transcript",
                    waveform: "chat-input-record-audio-transcript-waveform",
                    stopIcon: "chat-input-record-audio-transcript-stop-icon",
                  }}
                />
              )}
              {audioTranscriptionEnabled &&
                !isAudioMode &&
                isRecordingUpload && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={
                      <LoadingIcon
                        className="size-4 animate-spin text-[var(--theme-fg-primary)]"
                        data-testid="chat-input-record-audio-transcript-loading-icon"
                      />
                    }
                    disabled
                    data-testid="chat-input-record-audio-transcript"
                    aria-label={t`Finishing audio transcript`}
                  />
                )}
              {audioDictationEnabled &&
                !isAudioMode &&
                !isRecording &&
                !isRecordingUpload &&
                (isCapturingAudio || isDictating ? (
                  <WaveformButton
                    onClick={toggleDictationForCurrentTarget}
                    bars={dictationBars}
                    isBuffering={!isDictating}
                    disabled={
                      disabled ||
                      isLoading ||
                      isPendingResponse ||
                      isUploading ||
                      isFileButtonProcessing ||
                      isAnyTokenLimitExceeded
                    }
                    ariaLabel={
                      isDictating
                        ? t`Stop dictation`
                        : t`Cancel starting dictation`
                    }
                    statusLabel={
                      isDictating
                        ? t`Dictating audio`
                        : t`Capturing audio — waiting for transcription to start`
                    }
                    testIds={{
                      root: "chat-input-record-audio",
                      waveform: "chat-input-dictation-waveform",
                      stopIcon: "chat-input-dictation-stop-icon",
                    }}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={
                      isDictationStarting || isDictationCompleting ? (
                        <LoadingIcon
                          className="size-4 animate-spin text-[var(--theme-fg-primary)]"
                          data-testid="chat-input-dictation-loading-icon"
                        />
                      ) : (
                        <VoiceIcon className="text-[var(--theme-fg-primary)]" />
                      )
                    }
                    onClick={toggleDictationForCurrentTarget}
                    disabled={
                      disabled ||
                      isLoading ||
                      isPendingResponse ||
                      isUploading ||
                      isFileButtonProcessing ||
                      isDictationCompleting ||
                      isAnyTokenLimitExceeded
                    }
                    data-testid="chat-input-record-audio"
                    aria-label={
                      isDictationStarting
                        ? t`Starting dictation`
                        : isDictationCompleting
                          ? t`Finishing dictation`
                          : t`Start dictation`
                    }
                  />
                ))}
              {isPendingResponse ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<StopIcon />}
                  onClick={cancelMessage}
                  data-testid="chat-input-stop-generation"
                  aria-label={t`Stop`}
                />
              ) : showAudioModeButton ? (
                isConversationalAudioActive ? (
                  <ChatInputAudioModeButton
                    isRecording
                    recordingBars={dictationBars}
                    onToggle={handleAudioModeButtonToggle}
                    disabled={isAudioModeButtonDisabled}
                  />
                ) : (
                  <ChatInputAudioModeButton
                    isRecording={false}
                    onToggle={handleAudioModeButtonToggle}
                    disabled={isAudioModeButtonDisabled}
                  />
                )
              ) : (
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  icon={<ArrowUpIcon className="size-5" />}
                  disabled={!canSendMessage || isSendDisabled}
                  data-testid={
                    mode === "edit"
                      ? "chat-input-save-edit"
                      : "chat-input-send-message"
                  }
                  aria-label={
                    isAnyTokenLimitExceeded
                      ? t`Cannot send: Token limit exceeded`
                      : mode === "edit"
                        ? t`Save edit`
                        : t`Send message`
                  }
                />
              )}
            </div>
          </div>
          {facetsError && (
            <Alert type="error" className="mb-1">
              {t({
                id: "chat.facets.loadError",
                message: "Failed to load tools for this workspace.",
              })}
            </Alert>
          )}
        </div>
      </form>
      {showUsageAdvisory && aiUsageAdvisory && (
        <div className="relative h-10">
          <p className="absolute inset-0 flex items-center justify-center text-center text-xs text-theme-fg-muted">
            {aiUsageAdvisory}
          </p>
        </div>
      )}
    </div>
  );
};
