import { useState } from "react";

import type * as EratoLibrary from "@erato/frontend/library";
import type { ReactNode } from "react";

/**
 * Default module body for `vi.mock("@erato/frontend/library", ...)`.
 *
 * A factory mock replaces the barrel wholesale, so every name the tree under
 * test imports has to be present or the import throws before a single
 * assertion runs. Hand-written factories therefore grow to dozens of inert
 * entries, and each new host export has to be added to all of them by hand —
 * the same failure mode a component kit hits, except it surfaces as a red
 * suite rather than a silent revert.
 *
 * `DEFAULT_STUBS` carries the inert half once; a test spreads its own
 * assertion-bearing stubs over it. The companion test checks the set against
 * the real barrel, so a name added to the host surface cannot leave a hole
 * here.
 *
 * Stubs are shape-preserving, not just name-preserving: a consumer reading
 * `FILE_PREVIEW_STYLES.progress.container` or calling `getState()` on a store
 * needs the nesting, not a bare component. Defaults are plain functions rather
 * than `vi.fn()` so no call history is shared between `it` blocks — a test
 * asserting on a call supplies its own spy through `overrides`.
 */

type StubProps = Record<string, unknown>;

const noop = () => {};

const StubNothing = () => null;

const StubPassthrough = ({ children }: { children?: ReactNode }) => children;

const StubButton = ({
  icon: _icon,
  ...props
}: StubProps & { icon?: ReactNode; ref?: unknown }) => (
  <button {...(props as Record<string, never>)} />
);

const StubModalBase = ({
  children,
  isOpen,
}: {
  children?: ReactNode;
  isOpen?: boolean;
}) => (isOpen ? children : null);

// Mirrors the primitive's own `data-ui` default, which add-in lookups query.
const StubSidebarBand = ({
  children,
  className,
  dataUi,
  edge,
}: {
  children?: ReactNode;
  className?: string;
  dataUi?: string;
  edge?: string;
  flush?: boolean;
}) => (
  <div className={className} data-ui={dataUi ?? `sidebar-${edge}`}>
    {children}
  </div>
);

const StubSidebarToggle = ({
  label,
  expanded,
  attentionCount = 0,
  badgeTestId,
  children,
  surface: _surface,
  dataUi: _dataUi,
  ...props
}: StubProps & {
  label?: string;
  expanded?: boolean;
  attentionCount?: number;
  badgeTestId?: string;
  children?: ReactNode;
  surface?: string;
  dataUi?: string;
  ref?: unknown;
}) => (
  <button
    aria-label={label}
    aria-expanded={expanded}
    {...(props as Record<string, never>)}
  >
    {children}
    {attentionCount > 0 ? (
      // The real badge is aria-hidden; the count reaches the a11y tree
      // through the button's own label.
      <span aria-hidden="true" data-testid={badgeTestId}>
        {attentionCount}
      </span>
    ) : null}
  </button>
);

/**
 * Callable-and-inspectable store stub. `readState` runs per call so a state
 * a component mutates cannot leak into the next test.
 */
const createStoreStub = <S,>(readState: () => S) =>
  Object.assign(
    (selector?: (state: S) => unknown) => {
      const state = readState();
      return selector ? selector(state) : state;
    },
    { getState: readState },
  );

export const DEFAULT_STUBS = {
  useMessagingStore: {
    getState: () => ({
      activeStreamKey: "__new_chat__",
      getStreaming: () => ({ currentMessageId: null, isStreaming: false }),
      streamKeyAliases: {},
    }),
    subscribe: () => noop,
  },
  useMcpBrowserAuthorization: () => noop,
  Select: StubPassthrough,
  TextComparison: StubNothing,
  useThemedIcon: () => null,
  getChatUrl: () => "",
  ModelSelector: StubNothing,
  StarterPromptsSection: StubNothing,
  AssistantWelcomeUpper: StubNothing,
  splitFilenameForDisplay: () => ({ stem: "", extension: "" }),
  isImageFileResource: () => false,
  getFilePreviewUrl: () => undefined,
  FileAttachmentsPreview: StubNothing,
  // The declared kit surface. Covered wholesale so a name pinned by
  // `kit-surface.ts` can never be the one missing entry that breaks linking.
  Alert: StubNothing,
  ArchivedChatPill: StubNothing,
  ArchiveIcon: StubNothing,
  AttachmentNotice: StubNothing,
  AttachmentTile: StubNothing,
  AttachmentTileList: StubNothing,
  Avatar: StubNothing,
  Button: StubButton,
  Card: StubPassthrough,
  // Mirrored rather than left neutral: a consumer reads an id off these to
  // find a row or an action, so a blank record is a crash, not an inert stub.
  CHAT_HISTORY_ROW_MENU_ID: {
    pin: "pin",
    share: "share",
    rename: "rename",
    archive: "archive",
    unarchive: "unarchive",
  },
  CHAT_HISTORY_ROW_TEST_ID: {
    row: "data-chat-id",
    archived: "chat-history-item-archived",
    runOrigin: "chat-history-item-run-origin",
    status: "chat-generation-status",
  },
  ChatAttentionStatusDot: StubNothing,
  ChatHistoryListSkeleton: StubNothing,
  ChevronDownIcon: StubNothing,
  ChevronRightIcon: StubNothing,
  CloseIcon: StubNothing,
  CopyErrorButton: StubNothing,
  CountBadge: StubNothing,
  DefaultMessageControls: StubNothing,
  DisclosureChevron: StubNothing,
  DocumentIcon: StubNothing,
  DropdownMenu: StubNothing,
  EditIcon: StubNothing,
  EntityRow: StubNothing,
  ErrorIcon: StubNothing,
  FilePreviewButton: StubNothing,
  FilePreviewLoading: StubNothing,
  FileUploadLoading: StubNothing,
  ImageLightbox: StubNothing,
  InfoIcon: StubNothing,
  InteractiveContainer: StubPassthrough,
  JsonDisplay: StubNothing,
  LoadingIndicator: StubNothing,
  LogOutIcon: StubNothing,
  MailIcon: StubNothing,
  MediaVideoIcon: StubNothing,
  MessageContent: StubNothing,
  MessageErrorAlert: StubNothing,
  MessageTimestamp: StubNothing,
  ModalBase: StubModalBase,
  MoreVertical: StubNothing,
  MultiplePagesIcon: StubNothing,
  MusicNoteIcon: StubNothing,
  PageHeader: StubPassthrough,
  PageIcon: StubNothing,
  PinIcon: StubNothing,
  PopoverChrome: StubPassthrough,
  PopoverPanel: StubPassthrough,
  PopoverSectionHeader: StubPassthrough,
  PopoverSeparator: StubNothing,
  RadioCard: StubNothing,
  ResolvedIcon: StubNothing,
  Row: StubPassthrough,
  ShareIcon: StubNothing,
  SidebarBand: StubSidebarBand,
  SidebarCollapsibleSection: StubPassthrough,
  SidebarNavigationItem: StubNothing,
  SidebarToggle: StubSidebarToggle,
  SpinnerIcon: StubNothing,
  TabRail: StubNothing,
  ThemeProvider: StubPassthrough,
  ThreadMessageCard: StubNothing,
  ToolCallInput: StubNothing,
  ToolCallOutput: StubNothing,
  Tooltip: StubPassthrough,
  messageStyles: {
    container: { user: "", assistant: "" },
    avatar: { user: "", assistant: "" },
    hover: "",
  },
  resolvePopoverViewportPadding: () => 0,
  useChatHistoryRowPresentation: () => ({}),
  // A renderer destructures the whole state in one go, so the neutral value
  // carries every key rather than the handful a caller happens to read first.
  useChatMessageRenderer: () => ({
    isUser: false,
    role: "assistant",
    userDisplayName: "",
    isEmpty: false,
    attachmentIds: [],
    filesById: {},
    relatedFiles: [],
    contentProps: { content: [] },
    controlsProps: {},
    lightbox: {
      selectedImage: null,
      isOpen: false,
      openLightbox: noop,
      closeLightbox: noop,
    },
  }),
  useGetFile: () => ({ data: undefined, isLoading: false, error: null }),
  useGetFilePreview: () => ({ data: undefined, isLoading: false, error: null }),
  useGroupedFileAttachmentsPreview: () => [],
  getFileName: (file: { filename?: string; name?: string }) =>
    file.filename ?? file.name ?? "",
  useMessageAttachmentFiles: () => ({
    items: [],
    relatedFiles: [],
    teamsGrouping: null,
  }),
  // The surface's own metadata. Only the major is pinned to the host's value
  // and checked against it: kits compare it with a strict `!==`, so a bump is
  // a breaking change the add-in has to see. The other two are deliberately
  // neutral — copying the minor would redden this suite on every additive
  // release, and copying the export list would restate what the coverage
  // assertion already checks. A test that reads either supplies its own.
  ERATO_KIT_SURFACE_EXPORTS: [] as readonly string[],
  ERATO_SHARED_SURFACE_VERSION: 1,
  ERATO_SHARED_SURFACE_MINOR: 0,
  // Empty for the same reason as the export list: no add-in module reads a
  // class off the record, and mirroring 60-odd host class names here would be
  // a second copy to keep in step with globals.css. A test that renders
  // something reading one supplies the entry it needs.
  ERATO_GEOMETRY_CLASS: {} as Record<string, string>,

  // Host chrome the add-in compositions mount but never assert on.
  ApiProvider: StubPassthrough,
  ChatErrorBoundary: StubPassthrough,
  ChatInputControlsProvider: StubPassthrough,
  ChatMessage: StubNothing,
  DelegatedRunOpenProvider: StubPassthrough,
  DelegatedRunsSection: StubNothing,
  DesktopSidecarClientTools: StubNothing,
  DesktopSidecarProvider: StubPassthrough,
  FeatureConfigProvider: StubPassthrough,
  FeedbackCommentDialog: StubNothing,
  FeedbackViewDialog: StubNothing,
  FileCapabilitiesProvider: StubPassthrough,
  FilePreviewModal: StubNothing,
  GenerationStatusPoller: StubNothing,
  I18nProvider: StubPassthrough,
  MessageEditProvider: StubPassthrough,
  MessageList: StubNothing,
  ProfileProvider: StubPassthrough,
  SettingsIcon: StubNothing,
  Toaster: StubNothing,
  McpAuthorizationToasts: StubNothing,

  // Class names and style records the add-in pastes into its own markup.
  // `sidebarInsetClassName` is the host's `ERATO_GEOMETRY_CLASS` entry, so the
  // literal here is checked against the real export rather than trusted.
  sidebarInsetClassName: "sidebar-inset-geometry",
  FILE_PREVIEW_STYLES: {
    progress: { container: "", bar: "" },
    group: {
      header: "",
      title: "",
      meta: "",
      toggleButton: "",
      moreButton: "",
    },
  },

  // Pure helpers: the real implementations are exercised by the frontend's own
  // tests, so the add-in only needs the identity or empty result.
  chatDetailQuery: () => ({ queryKey: ["chat-detail"] }),
  chatMessagesQuery: () => ({ queryKey: ["chat-messages"] }),
  componentRegistry: {},
  createBrowserClientInfo: (info: unknown) => info,
  extractTextFromContent: () => "",
  findCapabilityByExtension: () => null,
  getSupportedFileTypes: () => ({}),
  hasSupportedOperations: () => false,
  mapMessageToUiMessage: (message: unknown) => message,
  recentChatsQuery: () => ({ queryKey: ["recent-chats"] }),
  registerClientToolExecutor: () => noop,
  removeArchivedChatFromLists: async () => noop,
  resolveComponentOverride: (override: unknown, fallback: unknown) =>
    override ?? fallback,
  seedGenerationStatusFromListing: noop,
  setAuthRecoveryHandler: noop,
  toast: { info: noop, success: noop, warning: noop, error: noop },
  transformEmailFencesForCopy: (value: string) => value,
  UploadUnknownError: class extends Error {},

  // Hooks. Shapes match what the host returns; a test that asserts on one
  // supplies its own.
  useActiveModelSelection: () => ({
    availableModels: [],
    selectedModel: null,
    setSelectedModel: noop,
    isSelectionReady: true,
  }),
  useArchiveChatEndpoint: () => ({ mutateAsync: async () => undefined }),
  useAssistantsFeature: () => ({
    enabled: false,
    delegationEnabled: false,
    delegationAllowBackground: false,
  }),
  useBudgetStatus: () => undefined,
  useChatCanEdit: () => false,
  useChatHeader: () => ({ header: null, composerLocked: false }),
  useChatHistoryRow: () => ({ menuItems: [] }),
  useChatHistoryRowMenuItems: () => [],
  useChatHistoryFilterFoldback: () => undefined,
  useConversationDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
    isDragAccept: false,
  }),
  useDesktopSidecar: () => ({ client: null }),
  useFacets: () => ({ data: { action_facets: [] } }),
  useFileCapabilitiesContext: () => ({ capabilities: [] }),
  useFileDropzone: () => ({
    uploadFiles: async () => [],
    isUploading: false,
    uploadedFiles: [],
    error: null,
    clearFiles: noop,
  }),
  useFilePreviewModal: () => ({
    isPreviewModalOpen: false,
    fileToPreview: null,
    openPreviewModal: noop,
    closePreviewModal: noop,
  }),
  useFileUploadWithTokenCheck: () => ({
    uploadFiles: async () => [],
    uploadError: null,
    isUploading: false,
  }),
  useGenerationIndicatorCount: () => 0,
  useInfiniteRecentChats: () => ({
    chats: [],
    isLoading: false,
    error: null,
    refetch: async () => undefined,
    fetchNextPage: async () => undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    queryKey: ["recent-chats"],
  }),
  useMessageFeedback: () => ({
    feedbackDialogState: { isOpen: false },
    feedbackViewDialogState: { isOpen: false, feedback: null },
    feedbackConfig: undefined,
    handleFeedbackSubmit: noop,
    handleFeedbackViewDialogRemove: noop,
    closeFeedbackDialog: noop,
    closeFeedbackViewDialog: noop,
    handleFeedbackDialogSubmit: noop,
    openFeedbackDialog: noop,
    openFeedbackViewDialog: noop,
    switchToEditMode: noop,
    canEditFeedback: () => false,
  }),
  useModelHistory: () => ({ currentChatLastModel: null }),
  useModelSwitches: () => ({}),
  usePersistedState: <T,>(_key: string, initialValue: T) =>
    useState(initialValue),
  useProfile: () => ({ profile: undefined }),
  useStandardMessageActions: () => noop,
  useUnarchiveChat: () => async () => undefined,
  useUploadFeature: () => ({
    enabled: true,
    maxSizeBytes: 20 * 1024 * 1024,
    maxSizeFormatted: "20 MB",
  }),

  // Stores: callable for the selector form, with `getState` for the
  // imperative reads the add-in makes outside render.
  createChatHistoryFilterStore: () =>
    createStoreStub(() => ({
      typeFilter: "all",
      statusFilter: "active",
      delegatedFilter: "all",
      groupBy: "date",
      setTypeFilter: noop,
      setStatusFilter: noop,
      setDelegatedFilter: noop,
      setGroupBy: noop,
      resetToDefaults: noop,
    })),
  useFileUploadStore: createStoreStub(() => ({
    silentChatId: null,
    error: null,
    setError: noop,
  })),
  useGenerationStatusStore: createStoreStub(() => ({
    setCurrentChatId: noop,
    clearStatus: noop,
  })),
} satisfies Partial<Record<keyof typeof EratoLibrary, unknown>>;

/**
 * Module body for `vi.mock("@erato/frontend/library", ...)`: the inert
 * defaults with `overrides` spread over them. The spread is shallow, so an
 * override replaces a default outright rather than merging into it.
 */
export const createEratoLibraryMock = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({ ...DEFAULT_STUBS, ...overrides });
