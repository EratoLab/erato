export function injectFrontendEnv() {
  window.API_ROOT_URL ??= import.meta.env.VITE_API_ROOT_URL;
  window.FRONTEND_PLATFORM ??= "platform-office-addin";
  window.FRONTEND_PUBLIC_BASE_PATH ??= "/public/platform-office-addin";
  window.COMMON_PUBLIC_BASE_PATH ??= "/public/common";

  if (import.meta.env.VITE_CUSTOMER_NAME) {
    window.THEME_CUSTOMER_NAME ??= import.meta.env.VITE_CUSTOMER_NAME;
  }
  if (import.meta.env.VITE_THEME_PATH) {
    window.THEME_PATH ??= import.meta.env.VITE_THEME_PATH;
  }
  if (import.meta.env.VITE_THEME_CONFIG_PATH) {
    window.THEME_CONFIG_PATH ??= import.meta.env.VITE_THEME_CONFIG_PATH;
  }
  if (import.meta.env.VITE_LOGO_PATH) {
    window.THEME_LOGO_PATH ??= import.meta.env.VITE_LOGO_PATH;
  }
  if (import.meta.env.VITE_LOGO_DARK_PATH) {
    window.THEME_LOGO_DARK_PATH ??= import.meta.env.VITE_LOGO_DARK_PATH;
  }
  if (import.meta.env.VITE_ASSISTANT_AVATAR_PATH) {
    window.THEME_ASSISTANT_AVATAR_PATH ??=
      import.meta.env.VITE_ASSISTANT_AVATAR_PATH;
  }
  if (import.meta.env.VITE_MSAL_CLIENT_ID) {
    window.MSAL_CLIENT_ID ??= import.meta.env.VITE_MSAL_CLIENT_ID;
  }
  if (import.meta.env.VITE_MSAL_AUTHORITY) {
    window.MSAL_AUTHORITY ??= import.meta.env.VITE_MSAL_AUTHORITY;
  }
}
