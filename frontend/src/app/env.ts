"use client";

export const dynamic = "force-static";

export type Env = {
  apiRootUrl: string;
  themeCustomerName: string | null;
  themePath: string | null;
  themeConfigPath: string | null;
  themeLogoPath: string | null;
  themeLogoDarkPath: string | null;
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
  }
}

export const env = (): Env => {
  const apiRootUrl =
    process.env.NEXT_PUBLIC_API_ROOT_URL ?? window.API_ROOT_URL;
  if (!apiRootUrl) {
    throw new Error("API_ROOT_URL not set");
  }
  let customerName =
    process.env.NEXT_PUBLIC_CUSTOMER_NAME ?? window.THEME_CUSTOMER_NAME ?? null;
  if (customerName === "") {
    customerName = null;
  }
  let themePath =
    process.env.NEXT_PUBLIC_THEME_PATH ?? window.THEME_PATH ?? null;
  if (themePath === "") {
    themePath = null;
  }
  let themeConfigPath =
    process.env.NEXT_PUBLIC_THEME_CONFIG_PATH ??
    window.THEME_CONFIG_PATH ??
    null;
  if (themeConfigPath === "") {
    themeConfigPath = null;
  }
  let themeLogoPath =
    process.env.NEXT_PUBLIC_LOGO_PATH ?? window.THEME_LOGO_PATH ?? null;
  if (themeLogoPath === "") {
    themeLogoPath = null;
  }
  let themeLogoDarkPath =
    process.env.NEXT_PUBLIC_LOGO_DARK_PATH ??
    window.THEME_LOGO_DARK_PATH ??
    null;
  if (themeLogoDarkPath === "") {
    themeLogoDarkPath = null;
  }

  return {
    apiRootUrl,
    themeCustomerName: customerName,
    themePath,
    themeConfigPath,
    themeLogoPath,
    themeLogoDarkPath,
  };
};
