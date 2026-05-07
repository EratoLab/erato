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
} from "@/providers/FeatureConfigProvider";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import { resolveChatSendErrorMessage } from "@/utils/chatSendErrorMessage";
import { createLogger } from "@/utils/debugLogger";

import { ArrowUpIcon, LoadingIcon, StopIcon, VoiceIcon } from "../icons";
import { ChatInputTokenUsage } from "./ChatInputTokenUsage";
import { FacetSelector } from "./FacetSelector";
import { ModelSelector } from "./ModelSelector";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { BudgetWarning } from "../Feedback/ChatWarnings/BudgetWarning";

import type { ChatInputControlsHandle } from "./ChatInputControlsContext";
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
const DICTATION_WAVEFORM_MAX_BAR_HEIGHT_PX = 14;

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
}

interface ComposeDraftState {
  message: string;
  attachedFiles: FileUploadItem[];
}

type DictationTarget =
  | {
      mode: "compose";
      draftKey: string;
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

// eslint-disable-next-line lingui/no-unlocalized-strings -- internal key used only for local draft state
const NEW_CHAT_DRAFT_KEY = "__new-chat__";

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
  ref,
}: ChatInputPropsWithRef) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousModeRef = useRef<"compose" | "edit">(mode);
  const previousEditMessageIdRef = useRef<string | undefined>(undefined);
  const composeDraftKey = chatId ?? NEW_CHAT_DRAFT_KEY;
  const composeDraftsRef = useRef<
    Record<string, ComposeDraftState | undefined>
  >({});
  const activeComposeDraftKeyRef = useRef(composeDraftKey);
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

  // Combine loading states
  const isLoading = propIsLoading ?? isMessagingLoading;

  // Get feature configurations
  const { enabled: uploadEnabled } = useUploadFeature();
  const { enabled: audioTranscriptionEnabled, maxRecordingDurationSeconds } =
    useAudioTranscriptionFeature();
  const {
    enabled: audioDictationEnabled,
    maxRecordingDurationSeconds: maxDictationDurationSeconds,
  } = useAudioDictationFeature();
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

  const {
    isRecording,
    isRecordingUpload,
    recordingError,
    setRecordingError,
    retryingAudioFileId,
    retryAudioTranscription,
    removeRecordedAudioFile,
    clearRecordedAudioFiles,
    hasRecordedAudioFile,
  } = useAudioTranscriptionRecorder({
    audioTranscriptionEnabled,
    uploadEnabled,
    maxRecordingDurationSeconds,
    chatId,
    silentChatId,
    setSilentChatId,
    assistantId,
    selectedModel,
    attachedFiles,
    setAttachedFiles,
  });

  const getComposeDraft = useCallback((draftKey: string): ComposeDraftState => {
    const existingDraft = composeDraftsRef.current[draftKey];
    if (existingDraft) {
      return existingDraft;
    }

    const emptyDraft = {
      message: "",
      attachedFiles: [],
    };
    composeDraftsRef.current[draftKey] = emptyDraft;
    return emptyDraft;
  }, []);

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
          if (
            mode === "compose" &&
            target.draftKey === activeComposeDraftKeyRef.current
          ) {
            setMessage((current) =>
              appendDictationText(current, nextTranscript),
            );
            continue;
          }

          const draft = getComposeDraft(target.draftKey);
          composeDraftsRef.current[target.draftKey] = {
            ...draft,
            message: appendDictationText(draft.message, nextTranscript),
          };
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
    [editMessageId, getComposeDraft, mode],
  );

  const {
    isDictating,
    isDictationStarting,
    isDictationCompleting,
    dictationError,
    setDictationError,
    dictationBars,
    toggleDictation,
  } = useAudioDictationRecorder({
    enabled: audioDictationEnabled,
    maxRecordingDurationSeconds: maxDictationDurationSeconds,
    onTranscriptChunk: appendDictationTranscript,
  });

  const toggleDictationForCurrentTarget = useCallback(() => {
    if (!isDictating) {
      dictationTargetRef.current =
        mode === "compose"
          ? {
              mode: "compose",
              draftKey: composeDraftKey,
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
  }, [composeDraftKey, editMessageId, isDictating, mode, toggleDictation]);

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

  // Persist compose-mode draft state for the currently active chat key.
  useEffect(() => {
    if (mode !== "compose") {
      return;
    }

    composeDraftsRef.current[activeComposeDraftKeyRef.current] = {
      message,
      attachedFiles,
    };
  }, [mode, message, attachedFiles]);

  // Persist outgoing compose draft and restore incoming compose draft on chat switch.
  useEffect(() => {
    if (mode !== "compose") {
      activeComposeDraftKeyRef.current = composeDraftKey;
      return;
    }

    const previousComposeDraftKey = activeComposeDraftKeyRef.current;
    if (previousComposeDraftKey !== composeDraftKey) {
      composeDraftsRef.current[previousComposeDraftKey] = {
        message,
        attachedFiles,
      };
    }

    const composeDraft = getComposeDraft(composeDraftKey);
    activeComposeDraftKeyRef.current = composeDraftKey;
    setMessage(composeDraft.message);
    setAttachedFiles(composeDraft.attachedFiles);
  }, [
    mode,
    composeDraftKey,
    message,
    attachedFiles,
    getComposeDraft,
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
      const composeDraft = getComposeDraft(composeDraftKey);
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
    composeDraftKey,
    getComposeDraft,
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
            status: audioTranscription.status,
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
    isLoading || isPendingResponse || hasIncompleteAudioTranscription,
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
    isDictationStarting;

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
    !hasIncompleteAudioTranscription;

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
            disabled={isLoading || isPendingResponse || disabled || isUploading}
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

          <div
            className="flex items-center justify-between"
            data-ui="chat-input-controls"
          >
            <div className="chat-input-controls-geometry flex items-center">
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

            <div className="flex items-center gap-[var(--theme-spacing-control-gap)]">
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
              {!hasTopLeftAccessoryOverride && (
                <ModelSelector
                  availableModels={availableModels}
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                  disabled={!isSelectionReady}
                />
              )}
              {audioDictationEnabled && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={clsx(
                    isDictating && "group relative overflow-hidden",
                  )}
                  icon={
                    isDictating ? undefined : isDictationStarting ||
                      isDictationCompleting ? (
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
                    isDictationStarting ||
                    isDictationCompleting ||
                    isAnyTokenLimitExceeded
                  }
                  data-testid="chat-input-record-audio"
                  aria-label={
                    isDictating
                      ? t`Stop dictation`
                      : isDictationStarting
                        ? t`Starting dictation`
                        : isDictationCompleting
                          ? t`Finishing dictation`
                          : t`Start dictation`
                  }
                >
                  {isDictating ? (
                    <>
                      <span
                        aria-label={t`Dictating audio`}
                        className="flex h-4 items-center gap-0.5 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0"
                        data-testid="chat-input-dictation-waveform"
                      >
                        {dictationBars.map((height, barIndex) => (
                          <span
                            key={barIndex}
                            className="w-1 rounded-full bg-current transition-[height] duration-75"
                            style={{
                              height: `${Math.min(
                                Math.max(height, 2) * 2,
                                DICTATION_WAVEFORM_MAX_BAR_HEIGHT_PX,
                              )}px`,
                            }}
                          />
                        ))}
                      </span>
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                        data-testid="chat-input-dictation-stop-icon"
                      >
                        <StopIcon className="size-4" />
                      </span>
                    </>
                  ) : null}
                </Button>
              )}
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
