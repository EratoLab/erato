/**
 * Single source of truth for host-shared modules exposed to component kits
 * via the import map. Each entry becomes (1) an extra rollup input whose
 * chunk is shared with the app entry (one evaluation = one module/context
 * instance), (2) an import-map entry emitted at build time
 * (import-map.manifest.json, injected into served HTML by the backend) and
 * in dev (specifier -> /src/shared/<file>), and (3) for erato specifiers a
 * `./shared/*` types export consumed by kits.
 *
 * Third-party specifiers are the bare package names so kits can write plain
 * `import { useState } from "react"` with the package marked external.
 */
export interface SharedModuleEntry {
  /** Bare specifier kits import (import-map key). */
  specifier: string;
  /** Rollup input name; also the emitted chunk's [name]. */
  entryName: string;
  /** Expose file under src/shared/. */
  file: string;
}

const THIRD_PARTY: Record<string, string> = {
  "react.ts": "react",
  "react-jsx-runtime.ts": "react/jsx-runtime",
  "react-dom.ts": "react-dom",
  "lingui-core.ts": "@lingui/core",
  "lingui-react.ts": "@lingui/react",
  "tanstack-react-query.ts": "@tanstack/react-query",
  "react-router.ts": "react-router",
  "react-router-dom.ts": "react-router-dom",
};

const ERATO_SHARED_FILES = [
  "alert.ts",
  "api-files.ts",
  "audio-input-device-store.ts",
  "avatar.ts",
  "button.ts",
  "chat-history-list.ts",
  "chat-input-controls.ts",
  "chat-provider.ts",
  "dropdown-menu.ts",
  "feature-config.ts",
  "file-capabilities-provider.ts",
  "file-preview-button.ts",
  "file-preview-loading.ts",
  "image-lightbox.ts",
  "interactive-container.ts",
  "loading-indicator.ts",
  "message-content.ts",
  "message-controls.ts",
  "message-timestamp.ts",
  "messaging-store.ts",
  "meta.ts",
  "model-selector.ts",
  "profile-provider.ts",
  "starter-prompts.ts",
  "theme-provider.ts",
  "themed-icon.ts",
  "token-store.ts",
  "ui-store.ts",
  "voice-runtime-provider.ts",
];

const entryNameFor = (file: string): string =>
  `shared-${file.replace(/\.ts$/, "")}`;

export const SHARED_MODULES: SharedModuleEntry[] = [
  ...Object.entries(THIRD_PARTY).map(([file, specifier]) => ({
    specifier,
    entryName: entryNameFor(file),
    file,
  })),
  ...ERATO_SHARED_FILES.map((file) => ({
    specifier: `@erato/frontend/shared/${file.replace(/\.ts$/, "")}`,
    entryName: entryNameFor(file),
    file,
  })),
];

export const IMPORT_MAP_MANIFEST_FILE_NAME = "import-map.manifest.json";
