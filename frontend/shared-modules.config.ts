/**
 * Single source of truth for host-shared modules exposed to component kits
 * via the import map. Each entry becomes (1) an extra rollup input whose
 * chunk is shared with the app entry (one evaluation = one module/context
 * instance), (2) an import-map entry emitted at build time
 * (import-map.manifest.json, injected into served HTML by the backend) and
 * in dev (specifier -> /src/shared/<file>), and (3) a `./shared` types export
 * consumed by kits for the Erato-owned barrel.
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
  "react-jsx-dev-runtime.ts": "react/jsx-dev-runtime",
  "react-dom.ts": "react-dom",
  "lingui-core.ts": "@lingui/core",
  "lingui-react.ts": "@lingui/react",
  "tanstack-react-query.ts": "@tanstack/react-query",
  "react-router.ts": "react-router",
  "react-router-dom.ts": "react-router-dom",
};

const entryNameFor = (file: string): string =>
  `shared-${file.replace(/\.ts$/, "")}`;

export const SHARED_MODULES: SharedModuleEntry[] = [
  ...Object.entries(THIRD_PARTY).map(([file, specifier]) => ({
    specifier,
    entryName: entryNameFor(file),
    file,
  })),
  {
    specifier: "@erato/frontend/shared",
    entryName: "shared-erato",
    file: "index.ts",
  },
];

export const IMPORT_MAP_MANIFEST_FILE_NAME = "import-map.manifest.json";
