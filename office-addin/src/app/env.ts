export function injectFrontendEnv() {
  window.API_ROOT_URL ??= import.meta.env.VITE_API_ROOT_URL;
  window.FRONTEND_PLATFORM ??= "platform-office-addin";
  window.FRONTEND_PUBLIC_BASE_PATH ??= "/public/platform-office-addin";
  window.COMMON_PUBLIC_BASE_PATH ??= "/public/common";

  if (import.meta.env.VITE_DESKTOP_SIDECAR_URL) {
    window.DESKTOP_SIDECAR_URL ??= import.meta.env.VITE_DESKTOP_SIDECAR_URL;
  }

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

  // The assistants flags reach the library through `window.*`: the library
  // bundle bakes `import.meta.env` at pack time, so a tarball packed without
  // them (CI, a fresh worktree) resolves them from here. `??=` keeps the
  // backend's HTML injection authoritative when it served the page.
  if (import.meta.env.VITE_ASSISTANTS_ENABLED === "true") {
    window.ASSISTANTS_ENABLED ??= true;
  }
  if (import.meta.env.VITE_ASSISTANTS_DELEGATION_ENABLED === "true") {
    window.ASSISTANTS_DELEGATION_ENABLED ??= true;
  }
  if (import.meta.env.VITE_ASSISTANTS_DELEGATION_ALLOW_BACKGROUND === "true") {
    window.ASSISTANTS_DELEGATION_ALLOW_BACKGROUND ??= true;
  }
}
