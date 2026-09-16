// The hand-maintained half of `@erato/frontend/shared`. `./index.ts` re-exports
// this module next to the generated registry star; splitting them keeps the
// deliberate contract reviewable on its own, separate from whatever the import
// graph happens to drag along.

// Primitives the component kits actually build on.
//
// The generated registry already exports most of these — but only because some
// registry-reachable component happens to import them. That makes the contract
// a byproduct of an unrelated import graph: a refactor elsewhere can drop one
// without anyone noticing, and a kit is a single flat named-import, so one
// missing name fails module linking and takes the WHOLE kit offline (every
// override silently reverting to its default). `Tooltip` left the surface
// exactly this way when the attachments preview was rewritten.
//
// Naming them here makes the dependency explicit and lets the type checker
// enforce it: if one of these stops existing, the build fails here instead of
// in a customer's browser.
//
// `./index.ts` re-exports this module and the generated registry as two stars,
// so a name carried by both is fine only while both resolve to the SAME symbol.
// Should a pin here ever resolve to a different symbol than the registry's,
// TypeScript drops the ambiguous name from the surface without an error — the
// build stays green and the name vanishes. The export-set diff in
// `__tests__/kitSurface.test.ts` is what catches that.
export { InteractiveContainer } from "@/components/ui/Container/InteractiveContainer";
export { Button } from "@/components/ui/Controls/Button";
export { DropdownMenu } from "@/components/ui/Controls/DropdownMenu";
export type { DropdownMenuItem } from "@/components/ui/Controls/DropdownMenu";
export {
  PopoverChrome,
  PopoverPanel,
  PopoverSectionHeader,
  PopoverSeparator,
  resolvePopoverViewportPadding,
} from "@/components/ui/Controls/PopoverPanel";
export type {
  PopoverChromeProps,
  PopoverPanelProps,
  PopoverSectionHeaderProps,
  PopoverSeparatorProps,
} from "@/components/ui/Controls/PopoverPanel";
export { Row } from "@/components/ui/Controls/Row";
export type { RowProps } from "@/components/ui/Controls/Row";
export { TabRail } from "@/components/ui/Controls/TabRail";
export type {
  TabRailOption,
  TabRailProps,
} from "@/components/ui/Controls/TabRail";
export { Alert } from "@/components/ui/Feedback/Alert";
export { Avatar } from "@/components/ui/Feedback/Avatar";
export { CopyErrorButton } from "@/components/ui/Feedback/CopyErrorButton";
export { LoadingIndicator } from "@/components/ui/Feedback/LoadingIndicator";
export { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
export { AttachmentNotice } from "@/components/ui/FileUpload/AttachmentNotice";
export { AttachmentTile } from "@/components/ui/FileUpload/AttachmentTile";
export { AttachmentTileList } from "@/components/ui/FileUpload/AttachmentTileList";
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
// The gating lives in the menu hook, so a kit renders the items it returns
// rather than deciding anything about archiving, runs or pin limits itself.
export {
  useChatHistoryRow,
  useChatHistoryRowMenuItems,
  useChatHistoryRowPresentation,
} from "@/components/ui/Chat/ChatHistoryList";
export type {
  ChatHistoryRow,
  ChatHistoryRowMenuOptions,
  ChatHistoryRowPresentation,
} from "@/components/ui/Chat/ChatHistoryList";
export { CHAT_HISTORY_ROW_MENU_ID } from "@/components/ui/Chat/chatHistoryRowMenuIds";
export type { ChatHistoryRowMenuId } from "@/components/ui/Chat/chatHistoryRowMenuIds";
// The contract test for these rows is NOT here: it is test infrastructure and
// everything on this surface ships to end users. It lives in "@erato/frontend/conformance".
export { CHAT_HISTORY_ROW_TEST_ID } from "@/components/ui/Chat/chatHistoryRowTestIds";
// Pinned alongside the hook that feeds it: only two registry-reachable
// importers keep it on the generated surface, and a kit rendering its own
// rows needs both halves or neither.
export { ChatAttentionStatusDot } from "@/components/ui/Chat/ChatAttentionStatusDot";
export { ArchivedChatPill } from "@/components/ui/Chat/chatArchiveActions";
// The loading state an override still has to draw: a list that ignores
// `isLoading` shows its last rows as if they were final.
export { ChatHistoryListSkeleton } from "@/components/ui/Chat/ChatHistoryList";

// Declared dependencies of shipped kits that still reached the surface only as
// an import-graph byproduct. Same failure mode as the block above, except these
// are already load-bearing for a deployed kit rather than a near miss.
export { Card } from "@/components/ui/Container/Card";
export type {
  CardControl,
  CardProps,
  CardSize,
  CardTag,
  CardTone,
  CardVariant,
} from "@/components/ui/Container/Card";
export { ThreadMessageCard } from "@/components/ui/FileUpload/ThreadMessageCard";
export type { ThreadMessageCardProps } from "@/components/ui/FileUpload/ThreadMessageCard";
export { FileUploadLoading } from "@/components/ui/FileUpload/FileUploadStates";
export type { FileUploadLoadingProps } from "@/components/ui/FileUpload/FileUploadStates";
export { MailIcon, PinIcon } from "@/components/ui/icons/index";
export type { IconProps } from "@/components/ui/icons/index";
export { ThemeProvider } from "@/components/providers/ThemeProvider";
export type { ThemeProviderProps } from "@/components/providers/ThemeProvider";
// The three a custom message renderer needs to draw a tool call itself. Nothing
// but the host's own tool-call renderers keeps them on the generated surface, so
// one change to how tool calls are drawn can drop all three at once.
export { JsonDisplay } from "@/components/ui/ToolCall/JsonDisplay";
export type { JsonDisplayProps } from "@/components/ui/ToolCall/JsonDisplay";
export { ToolCallInput } from "@/components/ui/ToolCall/ToolCallInput";
export type { ToolCallInputProps } from "@/components/ui/ToolCall/ToolCallInput";
export { ToolCallOutput } from "@/components/ui/ToolCall/ToolCallOutput";
export type { ToolCallOutputProps } from "@/components/ui/ToolCall/ToolCallOutput";

// Reachable from `@/library` but never from here, so a kit could not import
// them at all. Kits that render their own sidebar, settings or option rows need
// the host's versions to inherit its geometry and skin channels.
export { CountBadge } from "@/components/ui/Controls/CountBadge";
export type {
  CountBadgeProps,
  CountBadgeVariant,
} from "@/components/ui/Controls/CountBadge";
export { DisclosureChevron } from "@/components/ui/Controls/DisclosureChevron";
export type {
  DisclosureChevronProps,
  DisclosureChevronSize,
} from "@/components/ui/Controls/DisclosureChevron";
export { RadioCard } from "@/components/ui/Controls/RadioCard";
export type { RadioCardProps } from "@/components/ui/Controls/RadioCard";
export { PageHeader } from "@/components/ui/Container/PageHeader";
export type { PageHeaderProps } from "@/components/ui/Container/PageHeader";
export { EntityRow } from "@/components/ui/Settings/EntityRow";
export type {
  EntityRowProps,
  EntityRowStatus,
  EntityRowTone,
} from "@/components/ui/Settings/EntityRow";
export { SidebarBand } from "@/components/ui/Chat/SidebarBand";
export type {
  SidebarBandEdge,
  SidebarBandProps,
} from "@/components/ui/Chat/SidebarBand";
// No exported props type: the component types its props inline.
export { SidebarCollapsibleSection } from "@/components/ui/Chat/SidebarCollapsibleSection";
export { SidebarNavigationItem } from "@/components/ui/Chat/SidebarNavigationItem";
export type { SidebarNavigationItemProps } from "@/components/ui/Chat/SidebarNavigationItem";
export { SidebarToggle } from "@/components/ui/Chat/SidebarToggle";
export type {
  SidebarToggleProps,
  SidebarToggleSurface,
} from "@/components/ui/Chat/SidebarToggle";

export {
  useGetFile,
  useGetFilePreview,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

// The class channel. Kits and themes address host surfaces by global class
// name as well as by component, and pasting those names as string literals is
// how a rename reaches a customer as a rule that silently stops matching.
// Exporting the record makes the spelling resolvable instead of copied.
export {
  ERATO_GEOMETRY_CLASS,
  type EratoGeometryClassKey,
} from "@/components/ui/styles/geometryClassNames";

export {
  ERATO_SHARED_SURFACE_MINOR,
  ERATO_SHARED_SURFACE_VERSION,
} from "./surfaceVersion";

// The string half of the same contract: every value and type this module pins,
// so tooling on either side of the boundary can diff a kit's declared needs
// against what the host actually ships without parsing TypeScript.
/* eslint-disable lingui/no-unlocalized-strings -- export identifiers, not copy */
// The host behaviour behind a message, so a `ChatMessageRenderer` override can
// consume it rather than re-implement it. Most of a kit's override is not its
// own design: it is the host's derivation copied to reach the markup, and that
// copy has already drifted into refetching files the conversation was holding,
// losing the sibling list the preview navigates by, never showing the documents
// an assistant generated, and dropping the resolved mentions so @-highlighting
// is dead kit-side. `MessageErrorAlert` renders nothing without an error and
// the hooks derive only, so all three are safe to place unconditionally.
export { MessageErrorAlert } from "@/components/ui/Chat/MessageErrorAlert";
export { useChatMessageRenderer } from "@/components/ui/Chat/ChatMessage";
export type { ChatMessageRendererState } from "@/components/ui/Chat/ChatMessage";
export { useMessageAttachmentFiles } from "@/components/ui/Chat/MessageAttachments";
export type { MessageAttachmentFiles } from "@/components/ui/Chat/MessageAttachments";

// Disclosure and pagination for grouped attachment overrides. Item presentation
// stays with the kit, including its existing chip and image components.
export { useGroupedFileAttachmentsPreview } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
export type { GroupedFileAttachmentsPreviewState } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";

export const ERATO_KIT_SURFACE_EXPORTS = [
  "Alert",
  "ArchiveIcon",
  "ArchivedChatPill",
  "AttachmentNotice",
  "AttachmentTile",
  "AttachmentTileList",
  "Avatar",
  "Button",
  "CHAT_HISTORY_ROW_MENU_ID",
  "CHAT_HISTORY_ROW_TEST_ID",
  "Card",
  "CardControl",
  "CardProps",
  "CardSize",
  "CardTag",
  "CardTone",
  "CardVariant",
  "ChatAttentionStatusDot",
  "ChatHistoryListSkeleton",
  "ChatHistoryRow",
  "ChatHistoryRowMenuId",
  "ChatHistoryRowMenuOptions",
  "ChatHistoryRowPresentation",
  "ChatMessageRendererState",
  "ChevronDownIcon",
  "ChevronRightIcon",
  "CloseIcon",
  "CopyErrorButton",
  "CountBadge",
  "CountBadgeProps",
  "CountBadgeVariant",
  "DefaultMessageControls",
  "DisclosureChevron",
  "DisclosureChevronProps",
  "DisclosureChevronSize",
  "DocumentIcon",
  "DropdownMenu",
  "DropdownMenuItem",
  "ERATO_GEOMETRY_CLASS",
  "ERATO_KIT_SURFACE_EXPORTS",
  "ERATO_SHARED_SURFACE_MINOR",
  "ERATO_SHARED_SURFACE_VERSION",
  "EditIcon",
  "EntityRow",
  "EntityRowProps",
  "EntityRowStatus",
  "EntityRowTone",
  "EratoGeometryClassKey",
  "ErrorIcon",
  "FilePreviewButton",
  "FilePreviewLoading",
  "FileUploadLoading",
  "FileUploadLoadingProps",
  "GroupedFileAttachmentsPreviewState",
  "IconProps",
  "ImageLightbox",
  "InfoIcon",
  "InteractiveContainer",
  "JsonDisplay",
  "JsonDisplayProps",
  "LoadingIndicator",
  "LogOutIcon",
  "MailIcon",
  "MediaVideoIcon",
  "MessageAttachmentFiles",
  "MessageContent",
  "MessageErrorAlert",
  "MessageTimestamp",
  "ModalBase",
  "MoreVertical",
  "MultiplePagesIcon",
  "MusicNoteIcon",
  "PageHeader",
  "PageHeaderProps",
  "PageIcon",
  "PinIcon",
  "PopoverChrome",
  "PopoverChromeProps",
  "PopoverPanel",
  "PopoverPanelProps",
  "PopoverSectionHeader",
  "PopoverSectionHeaderProps",
  "PopoverSeparator",
  "PopoverSeparatorProps",
  "RadioCard",
  "RadioCardProps",
  "ResolvedIcon",
  "Row",
  "RowProps",
  "ShareIcon",
  "SidebarBand",
  "SidebarBandEdge",
  "SidebarBandProps",
  "SidebarCollapsibleSection",
  "SidebarNavigationItem",
  "SidebarNavigationItemProps",
  "SidebarToggle",
  "SidebarToggleProps",
  "SidebarToggleSurface",
  "SpinnerIcon",
  "TabRail",
  "TabRailOption",
  "TabRailProps",
  "ThemeProvider",
  "ThemeProviderProps",
  "ThreadMessageCard",
  "ThreadMessageCardProps",
  "ToolCallInput",
  "ToolCallInputProps",
  "ToolCallOutput",
  "ToolCallOutputProps",
  "Tooltip",
  "messageStyles",
  "resolvePopoverViewportPadding",
  "useChatHistoryRow",
  "useChatHistoryRowMenuItems",
  "useChatHistoryRowPresentation",
  "useChatMessageRenderer",
  "useGetFile",
  "useGetFilePreview",
  "useGroupedFileAttachmentsPreview",
  "useMessageAttachmentFiles",
] as const;
/* eslint-enable lingui/no-unlocalized-strings */
