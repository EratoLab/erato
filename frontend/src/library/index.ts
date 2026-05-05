import "./styles.css";
import "non.geist";
import "non.geist/mono";

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
export { MessageContent } from "@/components/ui/Message/MessageContent";
export { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
export { DefaultMessageControls } from "@/components/ui/Message/DefaultMessageControls";
export { FilePreviewModal } from "@/components/ui/Modal/FilePreviewModal";
export { ModalBase } from "@/components/ui/Modal/ModalBase";
export { AppearanceTabContent } from "@/components/ui/Settings/AppearanceTabContent";
export { FilePreviewButton } from "@/components/ui/FileUpload/FilePreviewButton";
export { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";
export { GroupedFileAttachmentsPreview } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
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
  useRecentChats,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
export {
  FeatureConfigProvider,
  StaticFeatureConfigProvider,
  defaultStaticFeatureConfig,
  useFeatureConfig,
  useMessageFeedbackFeature,
  type FeatureConfig,
  type MessageFeedbackFeatureConfig,
} from "@/providers/FeatureConfigProvider";
export { EratoUiProvider, type EratoUiProviderProps } from "./EratoUiProvider";
export {
  componentRegistry,
  resolveComponentOverride,
  type ComponentRegistry,
  type EratoEmailCodeBlockProps,
} from "@/config/componentRegistry";
export { createLogger } from "@/utils/debugLogger";
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

export type { Message } from "@/types/chat";
export type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";
export type { ChatInputControlsHandle } from "@/components/ui/Chat/ChatInputControlsContext";
export type {
  ActionFacetRequest,
  ChatModel,
  ContentPart,
  FileUploadItem,
  UpdateProfilePreferencesRequest,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
export type { FileType } from "@/utils/fileTypes";
export type { LocalFilePreviewItem } from "@/components/ui/FileUpload/FilePreviewBase";
export type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
  GroupedFileAttachmentsPreviewProps,
} from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
