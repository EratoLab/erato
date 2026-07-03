import "./styles.css";
import "non.geist";
import "non.geist/mono";

export { Trans, useLingui } from "@lingui/react";
export {
  ThemeProvider,
  useTheme,
  type ThemeMode,
  type ThemeProviderProps,
} from "@/components/providers/ThemeProvider";
export { ApiProvider } from "@/components/providers/ApiProvider";
export * from "@/components/ui/Chat";
export { ChatInputControlsProvider } from "@/components/ui/Chat/ChatInputControlsContext";
export {
  ChatMessage,
  type ChatMessageProps,
} from "@/components/ui/Chat/ChatMessage";
export * from "@/components/ui/MessageList";
export {
  MessageContent,
  useOutlookArtifact,
} from "@/components/ui/Message/MessageContent";
export type { OutlookArtifact } from "@/types/chat";
export { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
export { DefaultMessageControls } from "@/components/ui/Message/DefaultMessageControls";
export { DefaultEratoEmailCodeBlock } from "@/components/ui/Message/EratoEmailSuggestion";
export { FilePreviewModal } from "@/components/ui/Modal/FilePreviewModal";
export { ModalBase } from "@/components/ui/Modal/ModalBase";
export {
  ActionConfirmationCard,
  type ActionConfirmationStatus,
} from "@/components/ui/Message/ActionConfirmationCard";
export { AppearanceTabContent } from "@/components/ui/Settings/AppearanceTabContent";
export { AudioInputTabContent } from "@/components/ui/Settings/AudioInputTabContent";
export {
  AssistantWelcomeScreen,
  type AssistantWelcomeScreenProps,
} from "@/components/ui/Assistant/AssistantWelcomeScreen";
export {
  ChatHistoryList,
  type ChatHistoryListProps,
} from "@/components/ui/Chat/ChatHistoryList";
export type { ChatTopLeftAccessoryProps } from "@/components/ui/Chat/ChatTopLeftAccessory";
export { FilePreviewButton } from "@/components/ui/FileUpload/FilePreviewButton";
export { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";
export {
  DefaultStarterPromptsSection,
  type StarterPromptsRendererProps,
} from "@/components/ui/Chat/StarterPromptsSection";
export {
  FileSourceSelector,
  type FileSourceSelectorProps,
} from "@/components/ui/FileUpload/FileSourceSelector";
export {
  DefaultGroupedFileAttachmentsPreview,
  GroupedFileAttachmentsPreview,
} from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
export {
  WelcomeScreen,
  type WelcomeScreenProps,
} from "@/components/ui/WelcomeScreen";
export { AnchoredPopover } from "@/components/ui/Controls/AnchoredPopover";
export { Button } from "@/components/ui/Controls/Button";
export { RadioCard } from "@/components/ui/Controls/RadioCard";
export {
  DropdownMenu,
  type DropdownMenuItem,
  type DropdownMenuProps,
} from "@/components/ui/Controls/DropdownMenu";
export { Alert } from "@/components/ui/Feedback/Alert";
export {
  Toaster,
  toast,
  type ToasterPlacement,
  type ToastDescriptor,
  type ToastInput,
  type ToastVariant,
  type ToastAction,
} from "@/components/ui/Toast";
export {
  FormField,
  Input,
  Textarea,
  type FormFieldProps,
  type InputProps,
  type TextareaProps,
} from "@/components/ui/Input";
export { ChatErrorBoundary } from "@/components/ui/Feedback/ChatErrorBoundary";
export { FeedbackCommentDialog } from "@/components/ui/Feedback/FeedbackCommentDialog";
export { FeedbackViewDialog } from "@/components/ui/Feedback/FeedbackViewDialog";
export { I18nProvider } from "@/providers/I18nProvider";
export { ProfileProvider } from "@/providers/ProfileProvider";
export {
  FileCapabilitiesProvider,
  useFileCapabilitiesContext,
} from "@/providers/FileCapabilitiesProvider";
export {
  ChatProvider,
  ChatContext,
  useChatContext,
  type ChatContextValue,
} from "@/providers/ChatProvider";
export {
  defaultLocale,
  dynamicActivate,
  getValidLocale,
  i18n,
} from "@/lib/i18n";
export {
  VoiceRuntimeProvider,
  Ricky0123VadEngine,
  getDefaultVoiceRuntimeBasePath,
  resolveVoiceRuntimeAssets,
  createRicky0123VadAssetOptions,
  createRicky0123VadEngine,
  useVoiceRuntimeAssets,
  type Ricky0123VadAssetOptions,
  type Ricky0123VadEngineOptions,
  type Ricky0123VadRuntimeAssets,
  type VoiceVadEngine,
  type VoiceVadEngineOptions,
  type VoiceVadEvent,
  type VoiceVadEventListener,
  type VoiceVadFrame,
  type VoiceVadFrameProbabilities,
  type VoiceVadModel,
  type VoiceRuntimeAssetOverrides,
  type VoiceRuntimeAssets,
  type VoiceRuntimeProviderProps,
} from "@/lib/voice-runtime";
export { env, type Env } from "@/app/env";
export {
  useChat,
  useChatActions,
  useChatHistory,
  useChatMessaging,
  useModelHistory,
  useStandardMessageActions,
  useTokenManagement,
  useActiveModelSelection,
  type EditMessageState,
} from "@/hooks/chat";
export { useBudgetStatus } from "@/hooks/budget/useBudgetStatus";
export {
  useConversationDropzone,
  useFileDropzone,
  useFileUploadStore,
  useFileUploadWithTokenCheck,
  useStandaloneFileUpload,
} from "@/hooks/files";
export {
  ComputerIcon,
  DocumentIcon,
  MoonIcon,
  SunIcon,
} from "@/components/ui/icons";
export {
  useChatInputHandlers,
  useSidebar,
  usePaginatedData,
  useMessageListVirtualization,
  useScrollEvents,
  useFilePreviewModal,
  useThemedIcon,
  usePageAlignment,
} from "@/hooks/ui";
export { useMessageFeedback } from "@/hooks/chat/useMessageFeedback";
export { useMessagingStore } from "@/hooks/chat/store/messagingStore";
export { useProfile } from "@/hooks/useProfile";
export {
  usePersistedState,
  type PersistedStateOptions,
} from "@/hooks/usePersistedState";
export {
  selectAddinSessionAction,
  type AddinSessionMode,
  type AddinSessionTrigger,
  type AddinSessionAction,
  type AddinSessionState,
  type AddinSessionPolicy,
  type AddinSessionActionInput,
} from "@/lib/addinSession";
export {
  chatMessagesQuery,
  fetchUpdateProfilePreferences,
  fetchUploadFile,
  profileQuery,
  recentChatsQuery,
  useArchiveChatEndpoint,
  useFacets,
  useRecentChats,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
export {
  FeatureConfigProvider,
  StaticFeatureConfigProvider,
  defaultStaticFeatureConfig,
  useAudioConversationalFeature,
  useFeatureConfig,
  useMessageFeedbackFeature,
  useUploadFeature,
  type FeatureConfig,
  type MessageFeedbackFeatureConfig,
} from "@/providers/FeatureConfigProvider";
export { EratoUiProvider, type EratoUiProviderProps } from "./EratoUiProvider";
export {
  componentRegistry,
  resolveComponentOverride,
  type ComponentRegistry,
  type ComponentKitComponentRegistration,
  type ComponentKitRegistration,
  type EratoEmailCodeBlockProps,
  type ChatAddMenuExtraContentProps,
} from "@/config/componentRegistry";
export { createLogger } from "@/utils/debugLogger";
export {
  copyEmailToClipboard,
  htmlToPlainText,
  transformEmailFencesForCopy,
} from "@/utils/emailClipboard";
export { sanitizeHtmlPreview } from "@/utils/sanitizeHtmlPreview";
export {
  extractTextFromContent,
  parseContent,
} from "@/utils/adapters/contentPartAdapter";
export { getSupportedFileTypes } from "@/utils/capabilitiesToFileTypes";
export {
  mapMessageToUiMessage,
  type UiChatMessage,
} from "@/utils/adapters/messageAdapter";
export { getIdToken, setIdToken } from "@/auth/tokenStore";
export {
  setAuthRecoveryHandler,
  tryRecoverAuth,
  type AuthRecoveryHandler,
} from "@/auth/authRecovery";

export type { Message } from "@/types/chat";
export type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";
export type { ChatInputControlsHandle } from "@/components/ui/Chat/ChatInputControlsContext";
export type { ChatInputAttachmentPreviewProps } from "@/types/chat-input-attachment-preview";
export type {
  ActionFacetInfo,
  ActionFacetRequest,
  ChatModel,
  ContentPart,
  FacetsResponse,
  FileUploadItem,
  UpdateProfilePreferencesRequest,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
export { FileTypeUtil, type FileType } from "@/utils/fileTypes";
export type { LocalFilePreviewItem } from "@/components/ui/FileUpload/FilePreviewBase";
export type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
  GroupedFileAttachmentsPreviewProps,
  ThreadMessageAttachmentItem,
} from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
