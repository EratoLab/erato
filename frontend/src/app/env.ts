export type Env = {
  apiRootUrl: string;
  frontendPlatform: "common" | "platform-office-addin";
  frontendPublicBasePath: string;
  commonPublicBasePath: string;
  themeCustomerName: string | null;
  themePath: string | null;
  themeConfigPath: string | null;
  themeLogoPath: string | null;
  themeLogoDarkPath: string | null;
  themeAssistantAvatarPath: string | null;
  disableUpload: boolean;
  disableChatInputAutofocus: boolean;
  chatInputEmptyStateLayout: "bottom" | "centered";
  disableLogout: boolean;
  assistantsEnabled: boolean;
  assistantsShowRecentItems: boolean;
  assistantContextWarningThreshold: number;
  assistantContextFileContributorThreshold: number;
  starterPromptsEnabled: boolean;
  promptOptimizerEnabled: boolean;
  userPreferencesEnabled: boolean;
  mcpServersTabEnabled: boolean;
  sharepointEnabled: boolean;
  chatSharingEnabled: boolean;
  messageFeedbackEnabled: boolean;
  messageFeedbackCommentsEnabled: boolean;
  messageFeedbackEditTimeLimitSeconds: number | null;
  maxUploadSizeBytes: number;
  sidebarCollapsedMode: "hidden" | "slim";
  sidebarLogoPath: string | null;
  sidebarLogoDarkPath: string | null;
  sidebarChatHistoryShowMetadata: boolean;
  msalClientId: string | null;
  msalAuthority: string | null;
};

declare global {
  // These are injected from the backend (see frontend_environment.rs and related)
  interface Window {
    API_ROOT_URL?: string;
    FRONTEND_PLATFORM?: string;
    FRONTEND_PUBLIC_BASE_PATH?: string;
    COMMON_PUBLIC_BASE_PATH?: string;
    THEME_CUSTOMER_NAME?: string;
    THEME_PATH?: string;
    THEME_CONFIG_PATH?: string;
    THEME_LOGO_PATH?: string;
    THEME_LOGO_DARK_PATH?: string;
    THEME_ASSISTANT_AVATAR_PATH?: string;
    DISABLE_UPLOAD?: boolean;
    DISABLE_CHAT_INPUT_AUTOFOCUS?: boolean;
    CHAT_INPUT_EMPTY_STATE_LAYOUT?: string;
    DISABLE_LOGOUT?: boolean;
    ASSISTANTS_ENABLED?: boolean;
    ASSISTANTS_SHOW_RECENT_ITEMS?: boolean;
    ASSISTANTS_CONTEXT_WARNING_THRESHOLD?: number;
    ASSISTANTS_CONTEXT_FILE_CONTRIBUTOR_THRESHOLD?: number;
    STARTER_PROMPTS_ENABLED?: boolean;
    PROMPT_OPTIMIZER_ENABLED?: boolean;
    USER_PREFERENCES_ENABLED?: boolean;
    MCP_SERVERS_TAB_ENABLED?: boolean;
    SHAREPOINT_ENABLED?: boolean;
    CHAT_SHARING_ENABLED?: boolean;
    MESSAGE_FEEDBACK_ENABLED?: boolean;
    MESSAGE_FEEDBACK_COMMENTS_ENABLED?: boolean;
    MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS?: number;
    MAX_UPLOAD_SIZE_BYTES?: number;
    SIDEBAR_COLLAPSED_MODE?: string;
    SIDEBAR_LOGO_PATH?: string;
    SIDEBAR_LOGO_DARK_PATH?: string;
    SIDEBAR_CHAT_HISTORY_SHOW_METADATA?: boolean;
    MSAL_CLIENT_ID?: string;
    MSAL_AUTHORITY?: string;
    __E2E_COMPONENT_VARIANT__?: string;
    __E2E_FACET_ID__?: string;
  }
}

// Default maximum body limit in bytes (20MB) - must match backend default
const DEFAULT_MAX_BODY_LIMIT_BYTES = 20 * 1024 * 1024;
// These are static runtime mount paths, not user-facing strings.
// eslint-disable-next-line lingui/no-unlocalized-strings
const COMMON_PUBLIC_BASE_PATH = "/public/common";
// eslint-disable-next-line lingui/no-unlocalized-strings
const OFFICE_ADDIN_PUBLIC_BASE_PATH = "/public/platform-office-addin";

function normalizeChatInputEmptyStateLayout(
  value: string | null | undefined,
): "bottom" | "centered" {
  return value === "centered" ? "centered" : "bottom";
}

export const env = (): Env => {
  const apiRootUrl = import.meta.env.VITE_API_ROOT_URL ?? window.API_ROOT_URL;
  if (!apiRootUrl) {
    throw new Error(
      "API_ROOT_URL not set (checked VITE_API_ROOT_URL and window.API_ROOT_URL)",
    );
  }
  const frontendPlatform =
    (import.meta.env.VITE_FRONTEND_PLATFORM ??
      window.FRONTEND_PLATFORM ??
      "common") === "platform-office-addin"
      ? "platform-office-addin"
      : "common";
  const frontendPublicBasePath =
    import.meta.env.VITE_FRONTEND_PUBLIC_BASE_PATH ??
    window.FRONTEND_PUBLIC_BASE_PATH ??
    (frontendPlatform === "platform-office-addin"
      ? OFFICE_ADDIN_PUBLIC_BASE_PATH
      : COMMON_PUBLIC_BASE_PATH);
  const commonPublicBasePath =
    import.meta.env.VITE_COMMON_PUBLIC_BASE_PATH ??
    window.COMMON_PUBLIC_BASE_PATH ??
    COMMON_PUBLIC_BASE_PATH;

  let customerName =
    import.meta.env.VITE_CUSTOMER_NAME ?? window.THEME_CUSTOMER_NAME ?? null;
  if (customerName === "") {
    customerName = null;
  }
  let themePath = import.meta.env.VITE_THEME_PATH ?? window.THEME_PATH ?? null;
  if (themePath === "") {
    themePath = null;
  }
  let themeConfigPath =
    import.meta.env.VITE_THEME_CONFIG_PATH ?? window.THEME_CONFIG_PATH ?? null;
  if (themeConfigPath === "") {
    themeConfigPath = null;
  }
  let themeLogoPath =
    import.meta.env.VITE_LOGO_PATH ?? window.THEME_LOGO_PATH ?? null;
  if (themeLogoPath === "") {
    themeLogoPath = null;
  }
  let themeLogoDarkPath =
    import.meta.env.VITE_LOGO_DARK_PATH ?? window.THEME_LOGO_DARK_PATH ?? null;
  if (themeLogoDarkPath === "") {
    themeLogoDarkPath = null;
  }
  let themeAssistantAvatarPath =
    import.meta.env.VITE_ASSISTANT_AVATAR_PATH ??
    window.THEME_ASSISTANT_AVATAR_PATH ??
    null;
  if (themeAssistantAvatarPath === "") {
    themeAssistantAvatarPath = null;
  }

  const disableUpload =
    import.meta.env.VITE_DISABLE_UPLOAD === "true"
      ? true
      : (window.DISABLE_UPLOAD ?? false);
  const disableChatInputAutofocus =
    import.meta.env.VITE_DISABLE_CHAT_INPUT_AUTOFOCUS === "true"
      ? true
      : (window.DISABLE_CHAT_INPUT_AUTOFOCUS ?? false);
  const chatInputEmptyStateLayout = normalizeChatInputEmptyStateLayout(
    import.meta.env.VITE_CHAT_INPUT_EMPTY_STATE_LAYOUT ??
      window.CHAT_INPUT_EMPTY_STATE_LAYOUT ??
      "bottom",
  );
  const disableLogout =
    import.meta.env.VITE_DISABLE_LOGOUT === "true"
      ? true
      : (window.DISABLE_LOGOUT ?? false);
  const assistantsEnabled =
    import.meta.env.VITE_ASSISTANTS_ENABLED === "true"
      ? true
      : (window.ASSISTANTS_ENABLED ?? false);
  const assistantsShowRecentItems =
    import.meta.env.VITE_ASSISTANTS_SHOW_RECENT_ITEMS === "true"
      ? true
      : (window.ASSISTANTS_SHOW_RECENT_ITEMS ?? false);
  const assistantContextWarningThreshold = import.meta.env
    .VITE_ASSISTANTS_CONTEXT_WARNING_THRESHOLD
    ? Number(import.meta.env.VITE_ASSISTANTS_CONTEXT_WARNING_THRESHOLD)
    : (window.ASSISTANTS_CONTEXT_WARNING_THRESHOLD ?? 0.5);
  const assistantContextFileContributorThreshold = import.meta.env
    .VITE_ASSISTANTS_CONTEXT_FILE_CONTRIBUTOR_THRESHOLD
    ? Number(import.meta.env.VITE_ASSISTANTS_CONTEXT_FILE_CONTRIBUTOR_THRESHOLD)
    : (window.ASSISTANTS_CONTEXT_FILE_CONTRIBUTOR_THRESHOLD ?? 0.05);
  const starterPromptsEnabled =
    import.meta.env.VITE_STARTER_PROMPTS_ENABLED === "true"
      ? true
      : (window.STARTER_PROMPTS_ENABLED ?? false);
  const promptOptimizerEnabled =
    import.meta.env.VITE_PROMPT_OPTIMIZER_ENABLED === "true"
      ? true
      : (window.PROMPT_OPTIMIZER_ENABLED ?? false);
  const userPreferencesEnabled =
    import.meta.env.VITE_USER_PREFERENCES_ENABLED === "false"
      ? false
      : (window.USER_PREFERENCES_ENABLED ?? true);
  const mcpServersTabEnabled =
    import.meta.env.VITE_MCP_SERVERS_TAB_ENABLED === "true"
      ? true
      : (window.MCP_SERVERS_TAB_ENABLED ?? false);
  const sharepointEnabled =
    import.meta.env.VITE_SHAREPOINT_ENABLED === "true"
      ? true
      : (window.SHAREPOINT_ENABLED ?? false);
  const chatSharingEnabled =
    import.meta.env.VITE_CHAT_SHARING_ENABLED === "true"
      ? true
      : (window.CHAT_SHARING_ENABLED ?? false);
  const messageFeedbackEnabled =
    import.meta.env.VITE_MESSAGE_FEEDBACK_ENABLED === "true"
      ? true
      : (window.MESSAGE_FEEDBACK_ENABLED ?? false);
  const messageFeedbackCommentsEnabled =
    import.meta.env.VITE_MESSAGE_FEEDBACK_COMMENTS_ENABLED === "true"
      ? true
      : (window.MESSAGE_FEEDBACK_COMMENTS_ENABLED ?? false);
  const messageFeedbackEditTimeLimitSeconds = import.meta.env
    .VITE_MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS
    ? Number(import.meta.env.VITE_MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS)
    : (window.MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS ?? null);
  const maxUploadSizeBytes = import.meta.env.VITE_MAX_UPLOAD_SIZE_BYTES
    ? Number(import.meta.env.VITE_MAX_UPLOAD_SIZE_BYTES)
    : (window.MAX_UPLOAD_SIZE_BYTES ?? DEFAULT_MAX_BODY_LIMIT_BYTES);

  const sidebarCollapsedMode =
    import.meta.env.VITE_SIDEBAR_COLLAPSED_MODE ??
    window.SIDEBAR_COLLAPSED_MODE ??
    "hidden";

  let sidebarLogoPath =
    import.meta.env.VITE_SIDEBAR_LOGO_PATH ?? window.SIDEBAR_LOGO_PATH ?? null;
  if (sidebarLogoPath === "") {
    sidebarLogoPath = null;
  }

  let sidebarLogoDarkPath =
    import.meta.env.VITE_SIDEBAR_LOGO_DARK_PATH ??
    window.SIDEBAR_LOGO_DARK_PATH ??
    null;
  if (sidebarLogoDarkPath === "") {
    sidebarLogoDarkPath = null;
  }

  const sidebarChatHistoryShowMetadata =
    import.meta.env.VITE_SIDEBAR_CHAT_HISTORY_SHOW_METADATA === "false"
      ? false
      : (window.SIDEBAR_CHAT_HISTORY_SHOW_METADATA ?? true);
  const msalClientId =
    import.meta.env.VITE_MSAL_CLIENT_ID ?? window.MSAL_CLIENT_ID ?? null;
  const msalAuthority =
    import.meta.env.VITE_MSAL_AUTHORITY ?? window.MSAL_AUTHORITY ?? null;

  return {
    apiRootUrl,
    frontendPlatform,
    frontendPublicBasePath,
    commonPublicBasePath,
    themeCustomerName: customerName,
    themePath,
    themeConfigPath,
    themeLogoPath,
    themeLogoDarkPath,
    themeAssistantAvatarPath,
    disableUpload,
    disableChatInputAutofocus,
    chatInputEmptyStateLayout,
    disableLogout,
    assistantsEnabled,
    assistantsShowRecentItems,
    assistantContextWarningThreshold,
    assistantContextFileContributorThreshold,
    starterPromptsEnabled,
    promptOptimizerEnabled,
    userPreferencesEnabled,
    mcpServersTabEnabled,
    sharepointEnabled,
    chatSharingEnabled,
    messageFeedbackEnabled,
    messageFeedbackCommentsEnabled,
    messageFeedbackEditTimeLimitSeconds,
    maxUploadSizeBytes,
    sidebarCollapsedMode: sidebarCollapsedMode as "hidden" | "slim",
    sidebarLogoPath,
    sidebarLogoDarkPath,
    sidebarChatHistoryShowMetadata,
    msalClientId,
    msalAuthority,
  };
};
