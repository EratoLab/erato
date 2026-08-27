import { plural, t } from "@lingui/core/macro";
import clsx from "clsx";
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
} from "react";

import { FileAttachmentsPreview } from "@/components/ui/FileUpload";
import { FileUploadWithTokenCheck } from "@/components/ui/FileUpload/FileUploadWithTokenCheck";
import { ConfirmationDialog } from "@/components/ui/Modal/ConfirmationDialog";
import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";
import { useAudioDictationRecorder } from "@/hooks/audio/useAudioDictationRecorder";
import { useAudioTranscriptionRecorder } from "@/hooks/audio/useAudioTranscriptionRecorder";
import { useTokenManagement, useActiveModelSelection } from "@/hooks/chat";
import {
  useConfirmationRegistryStore,
  useHasPendingConfirmation,
} from "@/hooks/chat/store/confirmationRegistryStore";
import {
  useMessageQueueStore,
  useQueuedMessage,
} from "@/hooks/chat/store/messageQueueStore";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import {
  useComposeSession,
  type ComposeDraftState,
} from "@/hooks/chat/useComposeSession";
import {
  useMentionableAssistants,
  MENTION_SUGGESTION_LIMIT,
} from "@/hooks/chat/useMentionableAssistants";
import { UnsupportedFileTypeError } from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { useOptionalTranslation } from "@/hooks/i18n";
import { useChatInputHandlers } from "@/hooks/ui";
import { useIsMobile } from "@/hooks/useResponsive";
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
  useAssistantsFeature,
} from "@/providers/FeatureConfigProvider";
import {
  applyMentionSelection,
  detectMentionTrigger,
  pruneTrackedMentions,
  resolveMentionedAssistantIds,
  resolveMentionedAssistants,
} from "@/utils/chat/assistantMentions";
import { resolveChatSendErrorMessage } from "@/utils/chatSendErrorMessage";
import { createLogger } from "@/utils/debugLogger";
import { disambiguatePastedImageFileNames } from "@/utils/file/disambiguatePastedImageFileNames";
import { mergeUniqueFilesById } from "@/utils/file/mergeUniqueFilesById";
import { DEFAULT_MAX_FILES_PER_MESSAGE } from "@/utils/fileUploadLimits";

import {
  ArrowUpIcon,
  CloseIcon,
  EditIcon,
  LoadingIcon,
  StopIcon,
  VoiceIcon,
} from "../icons";
import { AssistantBrowserModal } from "./AssistantBrowserModal";
import { AssistantMentionBackdrop } from "./AssistantMentionBackdrop";
import { AssistantMentionPopover } from "./AssistantMentionPopover";
import { ChatInputAddControls } from "./ChatInputAddControls";
import { ChatInputAudioModeButton } from "./ChatInputAudioModeButton";
import { ChatInputTokenUsage } from "./ChatInputTokenUsage";
import { DelegationRunModePopover } from "./DelegationRunModePopover";
import { FacetSelector } from "./FacetSelector";
import { ModelSelector } from "./ModelSelector";
import { WaveformButton } from "./WaveformButton";
import { buildAssistantMentionSection } from "./assistantMentionSection";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { BudgetWarning } from "../Feedback/ChatWarnings/BudgetWarning";
import { CopyErrorButton } from "../Feedback/CopyErrorButton";
import { toast } from "../Toast/toast";

import type { AssistantMentionPopoverHandle } from "./AssistantMentionPopover";
import type { ChatInputControlsHandle } from "./ChatInputControlsContext";
import type { ToastAction } from "../Toast/types";
import type { AudioDictationTranscriptChunk } from "@/hooks/audio/useAudioDictationRecorder";
import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";
import type {
  FileUploadItem,
  ChatModel,
  DelegationRunMode,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  AssistantMention,
  MentionTrigger,
} from "@/utils/chat/assistantMentions";
import type { FileType } from "@/utils/fileTypes";
import type {
  ClipboardEvent as ReactClipboardEvent,
  FormEvent,
  Ref,
} from "react";

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
    /**
     * Resolved `{id, name}` pairs rather than bare ids: the optimistic
     * message needs the names to highlight before the server echoes them.
     */
    mentionedAssistants?: AssistantMention[],
    delegationRunMode?: DelegationRunMode,
  ) => void;
  onRegenerate?: () => void;
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

interface DictationTarget {
  sessionId: string;
  nextChunkIndex: number;
  chunkTranscripts: Map<number, string>;
}

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

// Fold two compose drafts into one, preserving both texts and de-duplicating
// files. Used to return a queued message to the composer (abort/error, or the
// "drop to draft" that happens when the user leaves a chat mid-generation)
// without clobbering anything the user has since typed. (ERMAIN-470)
function mergeComposeDrafts(
  primary: ComposeDraftState,
  secondary: ComposeDraftState,
): ComposeDraftState {
  const primaryHasText = primary.message.trim().length > 0;
  const secondaryHasText = secondary.message.trim().length > 0;
  const message =
    primaryHasText && secondaryHasText
      ? `${primary.message}\n${secondary.message}`
      : primaryHasText
        ? primary.message
        : secondary.message;
  const mentionedIds = new Set(
    primary.mentionedAssistants.map((mention) => mention.id),
  );
  return {
    message,
    attachedFiles: mergeUniqueFilesById(
      primary.attachedFiles,
      secondary.attachedFiles,
    ),
    mentionedAssistants: [
      ...primary.mentionedAssistants,
      ...secondary.mentionedAssistants.filter(
        (mention) => !mentionedIds.has(mention.id),
      ),
    ],
  };
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
  handleFileAttachments,
  isLoading: propIsLoading,
  disabled = false,
  className = "",
  placeholder = t`Type a message...`,
  showControls = true,
  maxFiles = DEFAULT_MAX_FILES_PER_MESSAGE,
  acceptedFileTypes = [],
  initialFiles = [],
  virtualFiles,
  showFileTypes = false,
  // Destructure the new props
  onFilePreview,
  chatId,
  assistantId,
  previousMessageId,
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
  const {
    sessionId: composeSessionId,
    getActiveSessionId,
    getDraft: getComposeDraftBySessionId,
    saveDraft: saveComposeDraftBySessionId,
  } = useComposeSession({ chatId });
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
  const dictationTargetRef = useRef<DictationTarget | null>(null);
  // Add state for file button processing
  const [isFileButtonProcessing, setIsFileButtonProcessing] = useState(false);
  const pendingSelectedFacetIdsRef = useRef<string[] | null>(null);
  // Compose session for which the user interactively chose facets. Once set,
  // the init effect treats that selection as authoritative so a chatId /
  // initialSelectedFacetIds change can't wipe it — notably the new-chat
  // null->real-id rename, which keeps the same composeSessionId. (ERMAIN-466)
  const userSelectedFacetsSessionRef = useRef<string | null>(null);
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
  const uploadedFiles = useFileUploadStore((state) => state.uploadedFiles);
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
    isCapturingAudio: isRecordingCapturingAudio,
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

        if (target.sessionId === getActiveSessionId()) {
          setMessage((current) => appendDictationText(current, nextTranscript));
          continue;
        }

        const draft = getComposeDraftBySessionId(target.sessionId);
        saveComposeDraftBySessionId(target.sessionId, {
          ...draft,
          message: appendDictationText(draft.message, nextTranscript),
        });
      }
    },
    [
      getActiveSessionId,
      getComposeDraftBySessionId,
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
    vadAutoStopEnabled: audioConversationalEnabled && isAudioMode,
    onVadAutoStop: handleConversationVadAutoStop,
  });

  const toggleDictationForCurrentTarget = useCallback(() => {
    if (!isDictating) {
      dictationTargetRef.current = {
        sessionId: getActiveSessionId(),
        nextChunkIndex: 0,
        chunkTranscripts: new Map(),
      };
    }

    toggleDictation();
  }, [getActiveSessionId, isDictating, toggleDictation]);

  const { data: facetsData, error: facetsError } = useFacets({});
  const { fetcherOptions: fileFetchOptions } = useV1betaApiContext();
  const fileFetchOptionsRef = useRef(fileFetchOptions);
  const availableFacets = useMemo(() => facetsData?.facets ?? [], [facetsData]);
  const globalFacetSettings = facetsData?.global_facet_settings;

  const [selectedFacetIds, setSelectedFacetIds] = useState<string[]>([]);

  // --- Assistant @-mentions ------------------------------------------------
  // The message text is the source of truth: this list only remembers which id
  // each `@Name` token stands for, and a token the user deletes stops counting.
  const [mentionedAssistants, setMentionedAssistants] = useState<
    AssistantMention[]
  >([]);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(
    null,
  );
  const dismissedMentionRef = useRef<{
    startIndex: number;
    text: string;
  } | null>(null);
  const [isAssistantBrowserOpen, setIsAssistantBrowserOpen] = useState(false);
  const mentionPopoverRef = useRef<AssistantMentionPopoverHandle>(null);
  const {
    isAvailable: canMentionAssistants,
    suggested: suggestedAssistants,
    all: mentionableAssistants,
  } = useMentionableAssistants(assistantId);

  // --- Wait-or-background for mentioned sends ------------------------------
  // Gated on the feature flags rather than `canMentionAssistants`: a restored
  // draft's tracked mentions outlive the assistant query, and whatever the
  // draft holds is what submit delegates to. Without the server-side
  // `allow_background` gate there is no popover at all — offering a choice the
  // server would downgrade to "wait" is worse than not asking.
  const {
    enabled: assistantsFeatureEnabled,
    delegationEnabled,
    delegationAllowBackground,
  } = useAssistantsFeature();
  const canChooseDelegationRunMode = Boolean(
    assistantsFeatureEnabled && delegationEnabled && delegationAllowBackground,
  );
  // Which pending action the open popover decides for: a direct send or a
  // queue snapshot. Null = closed.
  const [delegationRunModeIntent, setDelegationRunModeIntent] = useState<
    "send" | "queue" | null
  >(null);
  // A made choice for the submit that follows it: null = nothing decided,
  // `{ runMode: undefined }` = the user chose "wait".
  const pendingRunModeChoiceRef = useRef<{
    runMode?: DelegationRunMode;
  } | null>(null);

  const shouldAskDelegationRunMode = useCallback(
    (candidateMessage: string, tracked: AssistantMention[]) =>
      canChooseDelegationRunMode &&
      resolveMentionedAssistantIds(candidateMessage, tracked).length > 0,
    [canChooseDelegationRunMode],
  );

  // --- Queue-the-next-message (ERMAIN-470) ---------------------------------
  // The queued payload lives in the messageQueueStore keyed by the stable
  // compose session (so it survives the new-chat null->real-id rename and stays
  // isolated per chat). Reading it through a store selector keeps the chip and
  // drain reactive without a manual invalidation token.
  const queuedMessage = useQueuedMessage(composeSessionId);
  const setQueuedBySessionId = useMessageQueueStore((state) => state.setQueued);
  const clearQueuedBySessionId = useMessageQueueStore(
    (state) => state.clearQueued,
  );
  const getQueuedBySessionId = useMessageQueueStore((state) => state.getQueued);
  // A queued message is "armed" the moment its turn ends; the actual send is
  // deferred one frame so a just-completed add-in turn's confirmation card can
  // register and hold the drain.
  const [isDrainArmed, setIsDrainArmed] = useState(false);
  // Depth-1 overwrite guard: a message is already queued and the user is trying
  // to queue another. We ask for confirmation (data-loss safety) before
  // replacing, rather than silently clobbering the earlier draft. The pending
  // record carries the delegation run mode already chosen for the replacing
  // draft, so confirming snapshots it with the queued message.
  const [queueReplacePending, setQueueReplacePending] = useState<
    false | { runMode?: DelegationRunMode }
  >(false);
  const hasPendingConfirmation = useHasPendingConfirmation(chatId);

  // Enter-while-a-turn-is-generating queues the draft instead of sending.
  // Gated on isPendingResponse specifically (a turn is in flight) — not the
  // broader send lock, which also covers the initial history load that produces
  // no completion edge to drain on. Returns true when it consumed the event.
  //
  // A mentioned draft first asks wait-or-background; the resolved choice
  // re-enters through `decidedDelegation` and is snapshotted with the queued
  // message — the mode belongs to that draft, not to whatever is selected when
  // the drain later fires.
  const enqueueCurrentMessage = useCallback(
    (decidedDelegation?: { runMode?: DelegationRunMode }): boolean => {
      if (!isPendingResponse || isAnyTokenLimitExceeded) {
        return false;
      }
      // Leave the audio/dictation auto-send flows untouched.
      if (
        isDictating ||
        isDictationStarting ||
        isDictationCompleting ||
        isCapturingAudio
      ) {
        return false;
      }
      const trimmedMessage = message.trim();
      if (!trimmedMessage && attachedFiles.length === 0) {
        return false;
      }
      if (
        !decidedDelegation &&
        shouldAskDelegationRunMode(trimmedMessage, mentionedAssistants)
      ) {
        setDelegationRunModeIntent("queue");
        return true;
      }
      // Depth-1: a message is already queued — confirm before overwriting it
      // (data-loss safety) rather than silently replacing. Both Enter and the
      // Send/Queue button reach this choke point, so the guard covers both.
      if (getQueuedBySessionId(composeSessionId)) {
        setQueueReplacePending({ runMode: decidedDelegation?.runMode });
        return true;
      }
      setQueuedBySessionId(composeSessionId, {
        message: trimmedMessage,
        attachedFiles,
        mentionedAssistants: pruneTrackedMentions(
          trimmedMessage,
          mentionedAssistants,
        ),
        ...(decidedDelegation?.runMode
          ? { delegationRunMode: decidedDelegation.runMode }
          : {}),
      });
      setMessage("");
      handleRemoveAllFiles();
      return true;
    },
    [
      isPendingResponse,
      isAnyTokenLimitExceeded,
      isDictating,
      isDictationStarting,
      isDictationCompleting,
      isCapturingAudio,
      message,
      attachedFiles,
      mentionedAssistants,
      shouldAskDelegationRunMode,
      getQueuedBySessionId,
      setQueuedBySessionId,
      composeSessionId,
      handleRemoveAllFiles,
    ],
  );

  // Confirmed overwrite: replace the queued message with the current composer
  // draft and clear the composer.
  const commitQueueReplace = useCallback(() => {
    const trimmedMessage = message.trim();
    if (trimmedMessage || attachedFiles.length > 0) {
      const runMode = queueReplacePending
        ? queueReplacePending.runMode
        : undefined;
      setQueuedBySessionId(composeSessionId, {
        message: trimmedMessage,
        attachedFiles,
        mentionedAssistants: pruneTrackedMentions(
          trimmedMessage,
          mentionedAssistants,
        ),
        ...(runMode ? { delegationRunMode: runMode } : {}),
      });
      setMessage("");
      handleRemoveAllFiles();
    }
    setQueueReplacePending(false);
  }, [
    message,
    attachedFiles,
    mentionedAssistants,
    queueReplacePending,
    setQueuedBySessionId,
    composeSessionId,
    handleRemoveAllFiles,
  ]);

  // Return a queued payload to the composer (chip click-to-edit, abort, error),
  // merging with whatever the user has typed since so no text or file is lost.
  // An answered wait-or-background choice is deliberately NOT restored: back
  // in the composer the draft is editable again, so the next send asks afresh.
  const restoreQueuedToComposer = useCallback(
    (queued: ComposeDraftState) => {
      const merged = mergeComposeDrafts(queued, {
        message,
        attachedFiles,
        mentionedAssistants,
      });
      setMessage(merged.message);
      setAttachedFiles(merged.attachedFiles.slice(0, maxFiles));
      setMentionedAssistants(merged.mentionedAssistants);
      clearQueuedBySessionId(composeSessionId);
      setIsDrainArmed(false);
      setQueueReplacePending(false);
    },
    [
      message,
      attachedFiles,
      mentionedAssistants,
      maxFiles,
      setAttachedFiles,
      clearQueuedBySessionId,
      composeSessionId,
    ],
  );

  const cancelQueuedMessage = useCallback(() => {
    clearQueuedBySessionId(composeSessionId);
    setIsDrainArmed(false);
    setQueueReplacePending(false);
  }, [clearQueuedBySessionId, composeSessionId]);

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

      userSelectedFacetsSessionRef.current = composeSessionId;
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
      composeSessionId,
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
      clearQueuedMessage: () => clearQueuedBySessionId(composeSessionId),
    }),
    [
      clearQueuedBySessionId,
      composeSessionId,
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

  const hasPersistedInitialDraftRef = useRef(false);

  // Persist draft state for the currently active session.
  useEffect(() => {
    // The mount write only echoes the draft we seeded from, and on a remount
    // it would land after the outgoing instance folded its queued message into
    // that same draft — clobbering it with the empty composer. Skip it.
    if (!hasPersistedInitialDraftRef.current) {
      hasPersistedInitialDraftRef.current = true;
      return;
    }
    saveComposeDraftBySessionId(activeComposeSessionIdRef.current, {
      message,
      attachedFiles,
      mentionedAssistants,
    });
  }, [
    message,
    attachedFiles,
    mentionedAssistants,
    saveComposeDraftBySessionId,
  ]);

  // Seed the composer from this session's stored draft, so a remount (New Chat
  // bumping ChatProvider's mountKey, or the empty-state → messages layout flip)
  // doesn't present an empty composer for a chat that has one. This has to be a
  // layout effect: the outgoing instance's teardown below runs in the same
  // phase, and seeding any earlier would read the draft before it folds its
  // queued message in.
  useLayoutEffect(() => {
    const draft = getComposeDraftBySessionId(activeComposeSessionIdRef.current);
    if (draft.message) {
      setMessage(draft.message);
    }
    if (draft.attachedFiles.length) {
      setAttachedFiles(draft.attachedFiles);
    }
    if (draft.mentionedAssistants.length) {
      setMentionedAssistants(draft.mentionedAssistants);
    }
    // Mount-only: later session switches are handled by the switch effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A remount tears this component down without a session switch, so the
  // switch effect below never runs. Fold any queued message back into the
  // chat's draft here, or it stays in the queue store waiting for a turn that
  // this chat is no longer showing — and would auto-send on return. (ERMAIN-470)
  useLayoutEffect(() => {
    return () => {
      const sessionId = activeComposeSessionIdRef.current;
      const queued = getQueuedBySessionId(sessionId);
      if (!queued) {
        return;
      }
      saveComposeDraftBySessionId(
        sessionId,
        mergeComposeDrafts(queued, getComposeDraftBySessionId(sessionId)),
      );
      clearQueuedBySessionId(sessionId);
    };
  }, [
    getQueuedBySessionId,
    getComposeDraftBySessionId,
    saveComposeDraftBySessionId,
    clearQueuedBySessionId,
  ]);

  // On chat switch, persist outgoing draft against the previous session and
  // restore the incoming draft for the new session. Because the session id
  // *follows* the chat across a sentinel → real-chatId rename, that
  // transition does NOT trigger a switch here — the session stays the same.
  useEffect(() => {
    const previousSessionId = activeComposeSessionIdRef.current;
    if (previousSessionId === composeSessionId) {
      return;
    }

    // Leaving a chat with a queued message drops it back to a draft on that
    // chat (ERMAIN-470): it never auto-sends in the background and reappears in
    // the composer when the user returns.
    const outgoingQueued = getQueuedBySessionId(previousSessionId);
    const outgoingComposer = {
      message,
      attachedFiles,
      mentionedAssistants,
    };
    const outgoingDraft = outgoingQueued
      ? mergeComposeDrafts(outgoingQueued, outgoingComposer)
      : outgoingComposer;
    saveComposeDraftBySessionId(previousSessionId, outgoingDraft);
    if (outgoingQueued) {
      clearQueuedBySessionId(previousSessionId);
      setIsDrainArmed(false);
      setQueueReplacePending(false);
    }
    const incoming = getComposeDraftBySessionId(composeSessionId);
    activeComposeSessionIdRef.current = composeSessionId;
    setMessage(incoming.message);
    setAttachedFiles(incoming.attachedFiles);
    setMentionedAssistants(incoming.mentionedAssistants);
  }, [
    composeSessionId,
    message,
    attachedFiles,
    mentionedAssistants,
    getComposeDraftBySessionId,
    saveComposeDraftBySessionId,
    getQueuedBySessionId,
    clearQueuedBySessionId,
    setAttachedFiles,
  ]);

  const hasReconciledMentionsRef = useRef(false);

  // Deleting a token drops the mention: reconcile against the text on every
  // change. `pruneTrackedMentions` returns the same array when nothing was
  // dropped, so this settles in one pass.
  useEffect(() => {
    // The mount run still closes over the pre-seed empty text while the seed
    // above has already restored the draft's mentions, so it would prune every
    // one of them. The seed changes `message`, which re-runs this in the same
    // flush against the text they belong to.
    if (!hasReconciledMentionsRef.current) {
      hasReconciledMentionsRef.current = true;
      return;
    }
    setMentionedAssistants((tracked) =>
      tracked.length === 0 ? tracked : pruneTrackedMentions(message, tracked),
    );
  }, [message]);

  useEffect(() => {
    if (availableFacets.length === 0) {
      setSelectedFacetIds((previousSelectedFacetIds) =>
        previousSelectedFacetIds.length === 0 ? previousSelectedFacetIds : [],
      );
      onFacetSelectionChange?.([]);
      return;
    }

    const hasPendingSelection = pendingSelectedFacetIdsRef.current !== null;

    // A facet the user picked for this compose session outranks re-init: don't
    // let a chatId / initialSelectedFacetIds change wipe it (the new-chat
    // null->real-id rename keeps the session, so a tool chosen mid-generation
    // survives). Genuine chat switches change the session and still re-init; an
    // explicit imperative push always applies. (ERMAIN-466)
    if (
      !hasPendingSelection &&
      !enforceSelectedFacetIds &&
      userSelectedFacetsSessionRef.current === composeSessionId
    ) {
      setSelectedFacetIds((previousSelectedFacetIds) => {
        const sanitized = sanitizeFacetSelection(previousSelectedFacetIds);
        return areFacetIdListsEqual(previousSelectedFacetIds, sanitized)
          ? previousSelectedFacetIds
          : sanitized;
      });
      return;
    }

    const hasExplicitInitialSelection = initialSelectedFacetIds !== undefined;
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
    composeSessionId,
    enforceSelectedFacetIds,
    facetIdsByDefault,
    initialSelectedFacetIds,
    onFacetSelectionChange,
    sanitizeFacetSelection,
  ]);

  // Log attachedFiles received from the hook
  logger.log("Received attachedFiles from hook:", attachedFiles);

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

      const resolvedMentions = resolveMentionedAssistants(
        messageContent,
        mentionedAssistants,
      );
      // Set for the duration of this synchronous submit by the wrapper below;
      // "wait" stays undefined so the request omits the field.
      const delegationRunMode = pendingRunModeChoiceRef.current?.runMode;

      logger.log("Submit:", {
        messagePreview:
          messageContent.substring(0, 20) +
          (messageContent.length > 20 ? "..." : ""),
        files: inputFileIds,
        model: selectedModel?.chat_provider_id,
        selectedFacetIds,
        mentionedAssistantIds: resolvedMentions.map((mention) => mention.id),
        delegationRunMode,
      });
      if (delegationRunMode) {
        onSendMessage(
          messageContent,
          inputFileIds,
          selectedModel?.chat_provider_id,
          selectedFacetIds,
          resolvedMentions,
          delegationRunMode,
        );
      } else {
        onSendMessage(
          messageContent,
          inputFileIds,
          selectedModel?.chat_provider_id,
          selectedFacetIds,
          resolvedMentions,
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

    if (wasPendingResponse && !isPendingResponse) {
      // The turn just ended (completed, closed, aborted, or errored — the
      // falling edge covers them all). Arm the drain if a message is queued for
      // this session; the drain effect decides send-vs-restore and holds while
      // a confirmation card is pending. Abort clears the queue before this fires
      // (Stop restores it), so an aborted turn never arms. (ERMAIN-470)
      if (getQueuedBySessionId(composeSessionId)) {
        setIsDrainArmed(true);
      }
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [isPendingResponse, getQueuedBySessionId, composeSessionId]);

  // Drain the queued message once its turn has fully finished (ERMAIN-470).
  // Runs on the armed edge and whenever the hold inputs change (a confirmation
  // card resolving, an error arriving). The send is deferred one frame so a
  // just-completed add-in turn's confirmation card — which registers in a
  // post-commit effect — can hold the drain before we commit to sending.
  useEffect(() => {
    if (!isDrainArmed) {
      return;
    }
    const queued = getQueuedBySessionId(composeSessionId);
    if (!queued) {
      setIsDrainArmed(false);
      return;
    }
    // A fresh turn started before we could drain — wait for its edge.
    if (isPendingResponse) {
      return;
    }
    // The turn failed — return the queued content to the composer, never send.
    if (messagingError) {
      restoreQueuedToComposer(queued);
      return;
    }
    // Hold on a new chat's first turn until its real id has propagated. The
    // confirmation registry is keyed by chatId (the add-in card only knows the
    // real id), while the queue is keyed by composeSessionId which exists
    // before chatId does — so draining while chatId is still null could send
    // past a consent card about to register under the real id. chatId always
    // becomes non-null after chat_created, so this only defers, never wedges.
    if (!chatId) {
      return;
    }
    // Hold while a tool-consent card is unresolved (add-in). This effect
    // re-runs when the card resolves and hasPendingConfirmation flips false.
    if (hasPendingConfirmation) {
      return;
    }
    // Hold while the composer surface is busy (the add-in raises `disabled`
    // during email drop/expansion and upload). Draining now would send ahead of
    // attachments still being staged; the effect re-runs when `disabled` clears.
    if (disabled) {
      return;
    }
    // Defer past this commit's post-render effects (a just-completed add-in
    // turn registers its confirmation card in one of them) before deciding.
    const timer = setTimeout(() => {
      // Re-check imperatively: a confirmation card may have registered in the
      // tick we just waited out.
      if (useConfirmationRegistryStore.getState().hasPending(chatId)) {
        return;
      }
      const stillQueued = getQueuedBySessionId(composeSessionId);
      if (!stillQueued) {
        setIsDrainArmed(false);
        return;
      }
      // Clear before sending so a re-render during the (async, in the add-in)
      // onSendMessage can't re-drain the same payload.
      clearQueuedBySessionId(composeSessionId);
      setIsDrainArmed(false);
      setQueueReplacePending(false);
      // Model/facets are read live (not snapshotted at enqueue) so a selection
      // the user changes while the message waits applies to the sent message.
      // Mentions are the exception: they are part of the queued text — and the
      // delegation run mode travels with them, answered for this draft when it
      // was queued.
      const queuedInputFileIds =
        stillQueued.attachedFiles.length > 0
          ? stillQueued.attachedFiles.map((file) => file.id)
          : undefined;
      const queuedMentionedAssistants = resolveMentionedAssistants(
        stillQueued.message,
        stillQueued.mentionedAssistants,
      );
      if (stillQueued.delegationRunMode) {
        onSendMessage(
          stillQueued.message,
          queuedInputFileIds,
          selectedModel?.chat_provider_id,
          selectedFacetIds,
          queuedMentionedAssistants,
          stillQueued.delegationRunMode,
        );
      } else {
        onSendMessage(
          stillQueued.message,
          queuedInputFileIds,
          selectedModel?.chat_provider_id,
          selectedFacetIds,
          queuedMentionedAssistants,
        );
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [
    isDrainArmed,
    isPendingResponse,
    messagingError,
    hasPendingConfirmation,
    disabled,
    getQueuedBySessionId,
    composeSessionId,
    chatId,
    clearQueuedBySessionId,
    restoreQueuedToComposer,
    onSendMessage,
    selectedModel,
    selectedFacetIds,
  ]);

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

  // Split so the composer stays live during generation (ERMAIN-466): only
  // sendLocked gates Send/Enter; composeLocked gates the draft surfaces.
  const sendLocked = isLoading || isPendingResponse;
  const composeLocked =
    disabled ||
    isUploading ||
    isFileButtonProcessing ||
    isRecording ||
    isRecordingUpload;
  const isDisabled = composeLocked || sendLocked;

  const handleTextareaPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (composeLocked || !externalUploadFiles) {
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
      const existingFileNames = [
        ...uploadedFiles.map((file) => file.filename),
        ...attachedFiles.map((file) => file.filename),
      ];
      void uploadFiles(
        disambiguatePastedImageFileNames(imageFiles, existingFileNames),
      );
    },
    [
      attachedFiles,
      composeLocked,
      externalUploadFiles,
      uploadedFiles,
      uploadFiles,
    ],
  );

  // Keep the caret-derived trigger current: typing moves it, and so does a
  // plain caret move, which can leave or re-enter a half-typed mention.
  const syncMentionTrigger = useCallback(
    (element: HTMLTextAreaElement) => {
      if (!canMentionAssistants) {
        return;
      }
      const trigger = detectMentionTrigger(
        element.value.slice(0, element.selectionStart),
      );
      const dismissed = dismissedMentionRef.current;
      const isDismissed =
        trigger !== null &&
        dismissed !== null &&
        dismissed.startIndex === trigger.startIndex &&
        dismissed.text === element.value;
      setMentionTrigger(isDismissed ? null : trigger);
    },
    [canMentionAssistants],
  );

  // Escape and click-outside dismiss the picker for one fragment. Without
  // remembering which, the keyup of that very Escape — or any later caret move
  // over the same untouched text — re-detects it and pops the picker back.
  const dismissMentionTrigger = useCallback(() => {
    dismissedMentionRef.current = mentionTrigger
      ? { startIndex: mentionTrigger.startIndex, text: message }
      : null;
    setMentionTrigger(null);
  }, [mentionTrigger, message]);

  const insertAssistantMention = useCallback(
    (assistant: MentionableAssistant) => {
      // Without a live trigger the mention was picked from a menu rather than
      // typed, so it lands at the end of the draft instead of at the caret.
      const hasTrigger = mentionTrigger !== null;
      const text =
        hasTrigger || message.length === 0 || /\s$/.test(message)
          ? message
          : `${message} `;
      const caret = hasTrigger
        ? (textareaRef.current?.selectionStart ?? text.length)
        : text.length;
      const trigger = mentionTrigger ?? { query: "", startIndex: text.length };
      const next = applyMentionSelection(text, caret, trigger, assistant.name);

      setMessage(next.text);
      setMentionedAssistants((tracked) =>
        tracked.some(
          (mention) =>
            mention.id === assistant.id && mention.name === assistant.name,
        )
          ? tracked
          : [...tracked, { id: assistant.id, name: assistant.name }],
      );
      setMentionTrigger(null);
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(next.caret, next.caret);
      });
    },
    [message, mentionTrigger],
  );

  // A typed query searches everything accessible; an empty one shows the
  // suggestions, which is what the menus offer too.
  const mentionMatches = useMemo(() => {
    if (!mentionTrigger) {
      return [];
    }
    const query = mentionTrigger.query.toLowerCase();
    if (!query) {
      return suggestedAssistants;
    }
    return mentionableAssistants
      .filter((assistant) => assistant.name.toLowerCase().includes(query))
      .slice(0, MENTION_SUGGESTION_LIMIT);
  }, [mentionTrigger, mentionableAssistants, suggestedAssistants]);

  // The browse dialog is opened from the picker and keeps the in-progress
  // trigger alive, so that a pick there still replaces the typed fragment.
  const isMentionPickerOpen =
    canMentionAssistants &&
    !composeLocked &&
    !isAssistantBrowserOpen &&
    mentionMatches.length > 0;

  const assistantMentionSection = useMemo(
    () =>
      canMentionAssistants
        ? buildAssistantMentionSection({
            assistants: suggestedAssistants,
            onSelect: insertAssistantMention,
            onBrowse: () => setIsAssistantBrowserOpen(true),
            disabled: composeLocked,
          })
        : undefined,
    [
      canMentionAssistants,
      composeLocked,
      insertAssistantMention,
      suggestedAssistants,
    ],
  );

  // Collapse the file-upload button and the Tools dropdown into a single "+"
  // menu (ChatInputAddControls): on mobile, or whenever a host registers extra
  // add-menu content (e.g. the Outlook add-in's email-content sources, which
  // ride in via componentRegistry.ChatAddMenuExtraContent regardless of width).
  // Still skipped when a host overrides the whole selector (ChatFileSourceSelector).
  const isMobile = useIsMobile();
  const canUploadFiles = Boolean(handleFileAttachments) && uploadEnabled;
  const hasFacets = availableFacets.length > 0;
  const hasAddMenuExtraContent =
    componentRegistry.ChatAddMenuExtraContent != null;
  const useUnifiedMobileMenu =
    (isMobile || hasAddMenuExtraContent) &&
    componentRegistry.ChatFileSourceSelector == null &&
    (canUploadFiles ||
      hasFacets ||
      hasAddMenuExtraContent ||
      canMentionAssistants);

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

  // Like canSendMessage but for queuing the next message DURING a streaming
  // turn (ERMAIN-470): valid only while a turn is in flight, gated on real
  // content, and suppressed during any audio/dictation capture (which own their
  // own send path) so the trailing controls never exceed Stop + one action.
  const canQueueMessage =
    isPendingResponse &&
    hasComposeContent &&
    !isAnyTokenLimitExceeded &&
    !disabled &&
    !isUploading &&
    !isRecording &&
    !hasIncompleteAudioTranscription &&
    !isDictationCompleting &&
    !isConversationalAudioActive &&
    !isDictating &&
    !isDictationStarting &&
    !isCapturingAudio;

  // Chokepoint in front of handleSubmit (form submit, Enter, and the
  // post-choice resubmit all pass through): a mentioned send that has not
  // answered wait-or-background yet opens the popover INSTEAD of submitting,
  // leaving the draft untouched so a cancel costs nothing. Only a send that
  // would actually fire is intercepted — the popover must never outlive a
  // submit that handleSubmit would have dropped. Not memoized for the same
  // reason as handleSubmit above.
  const handleComposerSubmit = (e: FormEvent) => {
    const decided = pendingRunModeChoiceRef.current;
    if (
      !decided &&
      Boolean(canSendMessage) &&
      !isSendDisabled &&
      shouldAskDelegationRunMode(message.trim(), mentionedAssistants)
    ) {
      e.preventDefault();
      setDelegationRunModeIntent("send");
      return;
    }
    try {
      // The submit callback inside handleSubmit reads the choice from the ref
      // synchronously; clearing in `finally` keeps a submit that never reaches
      // the callback (guards, empty draft) from leaking the choice into a
      // later, unrelated send.
      handleSubmit(e);
    } finally {
      pendingRunModeChoiceRef.current = null;
    }
  };

  // A popover choice resumes the intercepted action with the chosen mode.
  const resolveDelegationRunModeChoice = useCallback(
    (runMode?: DelegationRunMode) => {
      const intent = delegationRunModeIntent;
      setDelegationRunModeIntent(null);
      if (!intent) {
        return;
      }
      focusInput();
      if (intent === "queue" && enqueueCurrentMessage({ runMode })) {
        return;
      }
      // Direct send — or the turn ended while the queue choice was open, in
      // which case the draft can simply be sent now.
      pendingRunModeChoiceRef.current = { runMode };
      formRef.current?.requestSubmit();
    },
    [delegationRunModeIntent, enqueueCurrentMessage, focusInput],
  );

  // Escape/click-away: the send is abandoned entirely and the draft stays.
  const cancelDelegationRunModeChoice = useCallback(() => {
    setDelegationRunModeIntent(null);
    focusInput();
  }, [focusInput]);

  const shouldShowAudioModeSelector =
    audioConversationalEnabled && audioTranscriptionEnabled;

  // The send button slot becomes the audio entry point when the compose
  // input is clean. If both audio paths are enabled, it asks the user which
  // mode to start; otherwise it starts the one available audio flow.
  const showAudioModeButton =
    (audioConversationalEnabled || audioTranscriptionEnabled) &&
    (isAudioMode ||
      // Don't offer to START an audio mode while a response streams — the
      // trailing slot is Stop (+ Send/Queue). An already-active session keeps
      // its own live control (render further up). (ERMAIN-470)
      (!isPendingResponse &&
        !hasComposeContent &&
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
    if (!audioConversationalEnabled) {
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
    toggleDictationForCurrentTarget,
  ]);

  useEffect(() => {
    if (!shouldRestartAudioModeAfterResponseRef.current) {
      return;
    }
    if (!audioModeRestartSawPendingResponseRef.current) {
      return;
    }
    if (!isAudioMode || isPendingResponse) {
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
  const AttachmentsPreview = resolveComponentOverride(
    componentRegistry.ChatAttachmentsPreview,
    FileAttachmentsPreview,
  );
  const hasTopLeftAccessoryOverride =
    componentRegistry.ChatTopLeftAccessory !== null;

  // Whether the model selector should render at all. When the controls are
  // collapsed into the unified "+" menu (mobile / add-in), the selector is
  // rendered in the left control group so it left-aligns next to the "+";
  // otherwise it stays in the right group, right-aligned next to Send.
  const showModelSelector =
    !hasTopLeftAccessoryOverride &&
    !(isAudioMode && !showModelSelectorInAudioMode);

  const shellWrapperStyle = {
    maxWidth: "var(--theme-layout-chat-input-max-width)",
  } as const;

  return (
    <div className="mx-auto w-full" style={shellWrapperStyle}>
      <form
        ref={formRef}
        className={clsx("w-full ", className, {
          "pb-0 sm:pb-0": aiUsageAdvisory,
        })}
        onSubmit={handleComposerSubmit}
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
          disabled={composeLocked}
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
            <p>{sendErrorText}</p>
            <CopyErrorButton
              error={messagingError}
              reportOptions={{ chatId }}
              className="mt-3"
            />
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

        {/* Queued next message: auto-sends when the current turn finishes.
            Geometry and surface tokens match the sibling attachment preview;
            `data-ui` lets kits restyle it. */}
        {queuedMessage && (
          <div
            className="theme-transition mb-2 flex items-center gap-2 border bg-theme-bg-primary text-sm [border-color:var(--theme-border-attachment)]"
            style={{
              borderRadius: "var(--theme-radius-message)",
              padding:
                "var(--theme-spacing-message-padding-y) var(--theme-spacing-message-padding-x)",
            }}
            data-ui="chat-input-queued-message"
            data-testid="chat-input-queued-message"
            role="status"
            aria-live="polite"
          >
            {/* flex-auto, not flex-1: a zero basis would collapse the message
                to nothing in the add-in's ~320px pane. */}
            <span className="min-w-0 truncate text-theme-fg-muted">
              {hasPendingConfirmation
                ? t`Queued — sends after you respond to the confirmation`
                : t`Queued — sends when response finishes`}
            </span>
            <button
              type="button"
              onClick={() => restoreQueuedToComposer(queuedMessage)}
              className="theme-transition focus-ring-tight flex min-w-0 flex-auto items-center gap-1 text-left text-theme-fg-primary hover:underline"
              aria-label={t`Edit queued message`}
              title={t`Edit queued message`}
              data-testid="chat-input-queued-message-edit"
            >
              <EditIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {queuedMessage.message.trim() ||
                  plural(queuedMessage.attachedFiles.length, {
                    one: "# attachment ready to send",
                    other: "# attachments ready to send",
                  })}
              </span>
            </button>
            <Button
              variant="icon-only"
              size="sm"
              icon={<CloseIcon className="size-4" />}
              onClick={cancelQueuedMessage}
              aria-label={t`Cancel queued message`}
              className="shrink-0"
              data-testid="chat-input-queued-message-cancel"
            />
          </div>
        )}

        {/* Depth-1 overwrite guard: replacing a queued message is a data-loss
            action, so confirm it (danger) rather than silently clobbering.
            Shared across web + add-in via ModalBase. (ERMAIN-470) */}
        <ConfirmationDialog
          isOpen={queueReplacePending && queuedMessage !== null}
          onClose={() => setQueueReplacePending(false)}
          onConfirm={commitQueueReplace}
          title={t`Replace the queued message?`}
          message={t`Only one message can be queued. Replacing discards the message you queued earlier.`}
          confirmButtonText={t`Replace`}
          cancelButtonText={t`Keep queued`}
          confirmButtonVariant="danger"
        />

        {canMentionAssistants && (
          <AssistantBrowserModal
            isOpen={isAssistantBrowserOpen}
            onClose={() => {
              setIsAssistantBrowserOpen(false);
              // Dismissing the dialog leaves focus nowhere; a pick lands the
              // caret after the inserted token instead.
              focusInput();
            }}
            assistants={mentionableAssistants}
            onSelect={insertAssistantMention}
          />
        )}

        <div
          className={clsx(
            "relative w-full",
            "border border-[var(--theme-border-chat-input)]",
            "theme-transition focus-within:border-[var(--theme-border-chat-input-focus)]",
            "flex flex-col",
            "chat-input-shell-geometry",
            "chat-input-shell-skin",
          )}
          data-ui="chat-input-shell"
        >
          {/* Out of flow on purpose: the shell is a gapped flex column, so an
              in-flow anchor would add a row of spacing to every composer. */}
          {canMentionAssistants && (
            <div className="pointer-events-none absolute inset-x-0 top-0 h-0">
              <AssistantMentionPopover
                ref={mentionPopoverRef}
                isOpen={isMentionPickerOpen}
                onOpenChange={(open) => {
                  if (!open) {
                    dismissMentionTrigger();
                  }
                }}
                assistants={mentionMatches}
                onSelect={insertAssistantMention}
                onBrowse={() => setIsAssistantBrowserOpen(true)}
                onRestoreFocus={focusInput}
              />
            </div>
          )}

          {/* The picker leaves the caret in the textarea, so nothing else tells
              a screen reader it opened or that Enter now inserts instead of
              sending. Mounted unconditionally because a live region only
              announces content that changes after it exists, and deliberately
              countless so filtering does not re-announce on every keystroke. */}
          {canMentionAssistants && (
            <div className="sr-only" role="status" aria-live="polite">
              {isMentionPickerOpen
                ? t({
                    id: "chatInput.mentions.pickerAnnouncement",
                    message:
                      "Assistant suggestions available. Press the down arrow to browse them, or Enter to mention the first.",
                  })
                : ""}
            </div>
          )}

          {/* Staged attachments belong inside the shell, above the textarea:
              they are part of what is about to be sent, not a separate card
              floating over the composer. The shell's own gap spaces them. */}
          {ChatInputAttachmentPreview ? (
            <ChatInputAttachmentPreview
              attachedFiles={attachedFiles}
              maxFiles={maxFiles}
              onRemoveFile={handleRemoveFileById}
              onRemoveAllFiles={handleRemoveAllFilesWithTokenReset}
              onFilePreview={onFilePreview}
              disabled={composeLocked}
              showFileTypes={showFileTypes}
            />
          ) : (
            <AttachmentsPreview
              attachedFiles={attachedFiles}
              maxFiles={maxFiles}
              onRemoveFile={handleRemoveFileById}
              onRemoveAllFiles={handleRemoveAllFilesWithTokenReset}
              onFilePreview={onFilePreview}
              disabled={composeLocked}
              showFileTypes={showFileTypes}
              surfaceVariant="message"
            />
          )}

          {!isAudioMode && (
            // isolate keeps the backdrop's negative layer above the shell's own
            // background instead of behind it; flex keeps the textarea from
            // gaining an inline-block descender now that it is wrapped.
            <div className="relative isolate flex w-full">
              {/* Gated on the tracked list, not on the mention affordances: the
                  list is restored from the draft and outlives the assistant
                  query, and whatever it holds is what submit delegates to. */}
              {mentionedAssistants.length > 0 && (
                <AssistantMentionBackdrop
                  text={message}
                  tracked={mentionedAssistants}
                  textareaRef={textareaRef}
                  dimmed={composeLocked}
                />
              )}
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  syncMentionTrigger(e.target);
                }}
                onSelect={(e) => syncMentionTrigger(e.currentTarget)}
                onClick={(e) => syncMentionTrigger(e.currentTarget)}
                onKeyUp={(e) => syncMentionTrigger(e.currentTarget)}
                onPaste={handleTextareaPaste}
                onKeyDown={(e) => {
                  // The open picker owns Enter, Tab and the arrows — it has to
                  // run before Enter reaches send/queue.
                  if (mentionPopoverRef.current?.handleComposerKeyDown(e)) {
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    // While a turn is generating, Enter queues the draft to
                    // auto-send when the turn finishes (ERMAIN-470); otherwise it
                    // submits normally.
                    if (enqueueCurrentMessage()) {
                      return;
                    }
                    handleComposerSubmit(e);
                  }
                }}
                placeholder={
                  isAnyTokenLimitExceeded
                    ? t`Message exceeds token limit. Please reduce length or remove files.`
                    : placeholder
                }
                rows={1}
                disabled={composeLocked}
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
            </div>
          )}

          <div
            className="flex flex-wrap items-center justify-between gap-[calc(var(--theme-spacing-control-gap)/2)]"
            data-ui="chat-input-controls"
          >
            <div className="chat-input-controls-geometry flex min-w-0 flex-wrap items-center">
              {showControls &&
                (useUnifiedMobileMenu ? (
                  <ChatInputAddControls
                    canUpload={canUploadFiles}
                    upload={{
                      message,
                      chatId,
                      assistantId,
                      previousMessageId,
                      chatProviderId: selectedModel?.chat_provider_id,
                      onFilesUploaded: handleFilesUploaded,
                      onTokenLimitExceeded: handleFileTokenLimitExceeded,
                      performFileUpload: uploadFiles,
                      uploadError:
                        externalUploadError instanceof Error
                          ? externalUploadError
                          : null,
                      onProcessingChange: handleFileButtonProcessingChange,
                      acceptedFileTypes,
                      multiple: maxFiles > 1,
                      maxFiles,
                    }}
                    facets={availableFacets}
                    selectedFacetIds={selectedFacetIds}
                    onToggleFacet={toggleFacetId}
                    assistantSection={assistantMentionSection}
                    disabled={composeLocked}
                    uploadDisabled={attachedFiles.length >= maxFiles}
                    toolsDisabled={enforceSelectedFacetIds}
                  />
                ) : (
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
                          attachedFiles.length >= maxFiles || composeLocked
                        }
                      />
                    )}
                    {(availableFacets.length > 0 ||
                      assistantMentionSection) && (
                      <FacetSelector
                        facets={availableFacets}
                        selectedFacetIds={selectedFacetIds}
                        assistantSection={assistantMentionSection}
                        onSelectionChange={(nextSelectedFacetIds) => {
                          userSelectedFacetsSessionRef.current =
                            composeSessionId;
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
                        disabled={composeLocked}
                        toolsDisabled={enforceSelectedFacetIds}
                      />
                    )}
                  </>
                ))}
              {useUnifiedMobileMenu && showModelSelector && (
                <ModelSelector
                  availableModels={availableModels}
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                  disabled={!isSelectionReady}
                  align="left"
                  className="ms-[var(--theme-spacing-control-gap)]"
                />
              )}
            </div>

            <div className="relative flex min-w-0 flex-wrap items-center gap-[var(--theme-spacing-control-gap)]">
              {/* Out of flow like the mention popover's anchor: the popover
                  positions off a measurable element, and the right edge of
                  this cluster is where the Send/Queue button that triggered
                  the choice sits. */}
              {canChooseDelegationRunMode && (
                <div className="pointer-events-none absolute right-0 top-0 size-0">
                  <DelegationRunModePopover
                    isOpen={delegationRunModeIntent !== null}
                    onChoose={resolveDelegationRunModeChoice}
                    onCancel={cancelDelegationRunModeChoice}
                  />
                </div>
              )}
              {isAudioMode && (
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
              {!useUnifiedMobileMenu && showModelSelector && (
                <ModelSelector
                  availableModels={availableModels}
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                  disabled={!isSelectionReady}
                />
              )}
              {isAudioMode &&
                isPendingResponse &&
                isConversationalAudioActive &&
                (isCapturingAudio && isDictating ? (
                  <WaveformButton
                    onClick={handleAudioModeButtonToggle}
                    bars={dictationBars}
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
                ) : (
                  // Re-arming between turns: the mic is being re-acquired
                  // and is not yet capturing — show the spinner, not a
                  // live-looking waveform.
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={
                      <LoadingIcon
                        className="size-4 animate-spin text-[var(--theme-fg-primary)]"
                        data-testid="chat-input-audio-mode-pending-loading-icon"
                      />
                    }
                    onClick={handleAudioModeButtonToggle}
                    disabled={disabled || isLoading || isDictationCompleting}
                    data-testid="chat-input-audio-mode-pending-recording"
                    aria-label={t`Stop audio mode`}
                    title={t`Stop audio mode`}
                  />
                ))}
              {audioTranscriptionEnabled &&
                !isAudioMode &&
                isRecording &&
                isRecordingCapturingAudio && (
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
                (isRecordingUpload ||
                  (isRecording && !isRecordingCapturingAudio)) && (
                  // The spinner covers the session handshake AND the mic
                  // warm-up: the waveform appears only once real audio is
                  // flowing, so its appearance is the "speak now" cue.
                  // During warm-up the button stays clickable to stop.
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
                    onClick={isRecording ? toggleAudioRecording : undefined}
                    disabled={!isRecording}
                    data-testid="chat-input-record-audio-transcript"
                    aria-label={
                      isRecording
                        ? t`Starting audio transcript recording`
                        : t`Finishing audio transcript`
                    }
                    title={
                      isRecording
                        ? t`Starting audio transcript recording`
                        : t`Finishing audio transcript`
                    }
                  />
                )}
              {audioDictationEnabled &&
                !isAudioMode &&
                !isRecording &&
                !isRecordingUpload &&
                // Keep the trailing controls at ≤2 (ERMAIN-470): while a
                // response streams with composer content, the Send/Queue button
                // takes this slot, so hide the idle dictation start — but keep
                // the live waveform, which is its own stop control.
                ((isCapturingAudio && isDictating) ||
                  !(hasComposeContent && isPendingResponse)) &&
                // Spinner until capture is live; the waveform appears only
                // once real audio is flowing.
                (isCapturingAudio && isDictating ? (
                  <WaveformButton
                    onClick={toggleDictationForCurrentTarget}
                    bars={dictationBars}
                    disabled={
                      disabled ||
                      isLoading ||
                      isUploading ||
                      isFileButtonProcessing ||
                      isAnyTokenLimitExceeded
                    }
                    ariaLabel={t`Stop dictation`}
                    statusLabel={t`Dictating audio`}
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
                    geometry="icon"
                    icon={
                      isDictationStarting ||
                      isDictating ||
                      isCapturingAudio ||
                      isDictationCompleting ? (
                        <LoadingIcon
                          className="size-4 animate-spin text-[var(--theme-fg-primary)]"
                          data-testid="chat-input-dictation-loading-icon"
                        />
                      ) : (
                        <VoiceIcon className="size-4 text-[var(--theme-fg-primary)]" />
                      )
                    }
                    onClick={toggleDictationForCurrentTarget}
                    disabled={
                      disabled ||
                      isLoading ||
                      isUploading ||
                      isFileButtonProcessing ||
                      isDictationCompleting ||
                      isAnyTokenLimitExceeded
                    }
                    data-testid="chat-input-record-audio"
                    aria-label={
                      isDictationStarting || isDictating || isCapturingAudio
                        ? t`Starting dictation`
                        : isDictationCompleting
                          ? t`Finishing dictation`
                          : t`Start dictation`
                    }
                    title={
                      isDictationStarting || isDictating || isCapturingAudio
                        ? t`Starting dictation`
                        : isDictationCompleting
                          ? t`Finishing dictation`
                          : t`Start dictation`
                    }
                  />
                ))}
              {isPendingResponse ? (
                <>
                  {/* Queue the next message while the response streams — same
                      arrow as Send; the tooltip and the "Queued…" chip explain
                      the deferred behavior. Routes through enqueueCurrentMessage
                      (like Enter), NOT a submit, which handleSubmit would no-op
                      during streaming. (ERMAIN-470) */}
                  {canQueueMessage && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      geometry="icon"
                      icon={<ArrowUpIcon className="size-5" />}
                      onClick={() => enqueueCurrentMessage()}
                      data-testid="chat-input-queue-message"
                      aria-label={t`Queue message`}
                      title={t`Queue — sends when the response finishes`}
                    />
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    geometry="icon"
                    icon={<StopIcon />}
                    onClick={() => {
                      // Stopping never auto-sends: return any queued draft to the
                      // composer, then abort. Clearing the queue here also means
                      // the completion edge won't arm a drain. (ERMAIN-470)
                      const queued = getQueuedBySessionId(composeSessionId);
                      if (queued) {
                        restoreQueuedToComposer(queued);
                      }
                      cancelMessage();
                    }}
                    data-testid="chat-input-stop-generation"
                    aria-label={t`Stop`}
                  />
                </>
              ) : showAudioModeButton ? (
                isConversationalAudioActive ? (
                  <ChatInputAudioModeButton
                    isRecording
                    recordingBars={dictationBars}
                    // Spinner until capture is live; waveform once real audio flows.
                    isStarting={!isCapturingAudio || !isDictating}
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
                  geometry="icon"
                  icon={<ArrowUpIcon className="size-5" />}
                  disabled={!canSendMessage || isSendDisabled}
                  data-testid="chat-input-send-message"
                  aria-label={
                    isAnyTokenLimitExceeded
                      ? t`Cannot send: Token limit exceeded`
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
