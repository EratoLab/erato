export type Env = {
  apiRootUrl: string;
  themeCustomerName: string | null;
  themePath: string | null;
  themeConfigPath: string | null;
  themeLogoPath: string | null;
  themeLogoDarkPath: string | null;
  themeAssistantAvatarPath: string | null;
  disableUpload: boolean;
  disableChatInputAutofocus: boolean;
  disableLogout: boolean;
  assistantsEnabled: boolean;
  promptOptimizerEnabled: boolean;
  sharepointEnabled: boolean;
  messageFeedbackEnabled: boolean;
  messageFeedbackCommentsEnabled: boolean;
  messageFeedbackEditTimeLimitSeconds: number | null;
  maxUploadSizeBytes: number;
};

declare global {
  // These are injected from the backend (see frontend_environment.rs and related)
  interface Window {
    API_ROOT_URL?: string;
    THEME_CUSTOMER_NAME?: string;
    THEME_PATH?: string;
    THEME_CONFIG_PATH?: string;
    THEME_LOGO_PATH?: string;
    THEME_LOGO_DARK_PATH?: string;
    THEME_ASSISTANT_AVATAR_PATH?: string;
    DISABLE_UPLOAD?: boolean;
    DISABLE_CHAT_INPUT_AUTOFOCUS?: boolean;
    DISABLE_LOGOUT?: boolean;
    ASSISTANTS_ENABLED?: boolean;
    PROMPT_OPTIMIZER_ENABLED?: boolean;
    SHAREPOINT_ENABLED?: boolean;
    MESSAGE_FEEDBACK_ENABLED?: boolean;
    MESSAGE_FEEDBACK_COMMENTS_ENABLED?: boolean;
    MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS?: number;
    MAX_UPLOAD_SIZE_BYTES?: number;
  }
}

// Default maximum body limit in bytes (20MB) - must match backend default
const DEFAULT_MAX_BODY_LIMIT_BYTES = 20 * 1024 * 1024;

export const env = (): Env => {
  const apiRootUrl = import.meta.env.VITE_API_ROOT_URL ?? window.API_ROOT_URL;
  if (!apiRootUrl) {
    throw new Error(
      "API_ROOT_URL not set (checked VITE_API_ROOT_URL and window.API_ROOT_URL)",
    );
  }
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
  const disableLogout =
    import.meta.env.VITE_DISABLE_LOGOUT === "true"
      ? true
      : (window.DISABLE_LOGOUT ?? false);
  const assistantsEnabled =
    import.meta.env.VITE_ASSISTANTS_ENABLED === "true"
      ? true
      : (window.ASSISTANTS_ENABLED ?? false);
  const promptOptimizerEnabled =
    import.meta.env.VITE_PROMPT_OPTIMIZER_ENABLED === "true"
      ? true
      : (window.PROMPT_OPTIMIZER_ENABLED ?? false);
  const sharepointEnabled =
    import.meta.env.VITE_SHAREPOINT_ENABLED === "true"
      ? true
      : (window.SHAREPOINT_ENABLED ?? false);
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

  return {
    apiRootUrl,
    themeCustomerName: customerName,
    themePath,
    themeConfigPath,
    themeLogoPath,
    themeLogoDarkPath,
    themeAssistantAvatarPath,
    disableUpload,
    disableChatInputAutofocus,
    disableLogout,
    assistantsEnabled,
    promptOptimizerEnabled,
    sharepointEnabled,
    messageFeedbackEnabled,
    messageFeedbackCommentsEnabled,
    messageFeedbackEditTimeLimitSeconds,
    maxUploadSizeBytes,
  };
};
