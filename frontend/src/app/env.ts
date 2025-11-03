export type Env = {
  apiRootUrl: string;
  themeCustomerName: string | null;
  themePath: string | null;
  themeConfigPath: string | null;
  themeLogoPath: string | null;
  themeLogoDarkPath: string | null;
  disableUpload: boolean;
  disableChatInputAutofocus: boolean;
  disableLogout: boolean;
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
    DISABLE_UPLOAD?: boolean;
    DISABLE_CHAT_INPUT_AUTOFOCUS?: boolean;
    DISABLE_LOGOUT?: boolean;
  }
}

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

  return {
    apiRootUrl,
    themeCustomerName: customerName,
    themePath,
    themeConfigPath,
    themeLogoPath,
    themeLogoDarkPath,
    disableUpload,
    disableChatInputAutofocus,
    disableLogout,
  };
};
