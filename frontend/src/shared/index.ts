// Import-map expose entry for the Erato-owned component-kit host surface.
// Keep this as a deliberate public API: kits import values from the single
// `@erato/frontend/shared` specifier and the host import map supplies the
// app-bundle module instance.
export * from "./component-registry.generated";

export * from "@/auth/tokenStore";
export * from "@/components/ui/Chat/ModelSelector";
export * from "@/hooks/chat/store/messagingStore";
export * from "@/hooks/chat/useStarterPrompts";
export * from "@/hooks/ui/useThemedIcon";
export * from "@/lib/voice-runtime/VoiceRuntimeProvider";
export * from "@/providers/ChatProvider";
export * from "@/providers/FeatureConfigProvider";
export * from "@/providers/FileCapabilitiesProvider";
export * from "@/providers/ProfileProvider";
export * from "@/state/audioInputDeviceStore";
export * from "@/state/uiStore";

// Primitives the component kits actually build on.
//
// The generated surface above already exports all of these — but only because
// some registry-reachable component happens to import them. That makes the
// contract a byproduct of an unrelated import graph: a refactor elsewhere can
// drop one without anyone noticing, and a kit is a single flat named-import,
// so one missing name fails module linking and takes the WHOLE kit offline
// (every override silently reverting to its default). `Tooltip` left the
// surface exactly this way when the attachments preview was rewritten.
//
// Naming them here makes the dependency explicit and lets the type checker
// enforce it: if one of these stops existing, the build fails here instead of
// in a customer's browser. Explicit exports take precedence over the star
// export above, so this shadows rather than duplicates.
export { InteractiveContainer } from "@/components/ui/Container/InteractiveContainer";
export { Button } from "@/components/ui/Controls/Button";
export { DropdownMenu } from "@/components/ui/Controls/DropdownMenu";
export type { DropdownMenuItem } from "@/components/ui/Controls/DropdownMenu";
export { Alert } from "@/components/ui/Feedback/Alert";
export { Avatar } from "@/components/ui/Feedback/Avatar";
export { CopyErrorButton } from "@/components/ui/Feedback/CopyErrorButton";
export { LoadingIndicator } from "@/components/ui/Feedback/LoadingIndicator";
export { FilePreviewButton } from "@/components/ui/FileUpload/FilePreviewButton";
export { FilePreviewLoading } from "@/components/ui/FileUpload/FilePreviewLoading";
export { DefaultMessageControls } from "@/components/ui/Message/DefaultMessageControls";
export { ImageLightbox } from "@/components/ui/Message/ImageLightbox";
export { MessageContent } from "@/components/ui/Message/MessageContent";
export { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
export { ModalBase } from "@/components/ui/Modal/ModalBase";
export { ResolvedIcon } from "@/components/ui/icons/ResolvedIcon";
export {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DocumentIcon,
  EditIcon,
  ErrorIcon,
  InfoIcon,
  LogOutIcon,
  MediaVideoIcon,
  MoreVertical,
  MultiplePagesIcon,
  MusicNoteIcon,
  PageIcon,
  ShareIcon,
} from "@/components/ui/icons/index";
export { messageStyles } from "@/components/ui/styles/chatMessageStyles";
export { Tooltip } from "@/components/ui/Controls/Tooltip";
// The resolved result, not the stores behind it — kits read status, never write it.
export { useChatHistoryRowPresentation } from "@/components/ui/Chat/ChatHistoryList";

export {
  useGetFile,
  useGetFilePreview,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

// Bump on breaking changes to the shared host surface. Kits compare this at
// startup and warn loudly when their expected contract does not match.
export const ERATO_SHARED_SURFACE_VERSION = 1;
