/// <reference types="vite/client" />

declare module "*.po" {
  import type { Messages } from "@lingui/core";

  export const messages: Messages;
}

/** The package version, baked in by vite.config.ts. */
declare const __DESKTOP_UI_VERSION__: string;

/** What the sidecar tells the page before it loads (all optional). */
interface EratoDesktopUiWindowConfig {
  /** BCP-47 tag; resolved to a bundled catalog, `en` otherwise. */
  locale?: string;
  /** `light`, `dark` or `system`; `system` otherwise. */
  themeMode?: string;
  /** The bundle version the host embeds, for display. */
  version?: string;
}

interface Window {
  ERATO_DESKTOP_UI?: EratoDesktopUiWindowConfig;
  /** wry's IPC bridge, injected by the sidecar's webview host. Absent in a browser. */
  ipc?: { postMessage: (message: string) => void };
}
