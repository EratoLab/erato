import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  eratoComponentKitLiveStorybook,
  eratoComponentKitStorybook,
} from "@erato/frontend/component-kit/storybook";
import type { StorybookConfig } from "@storybook/react-vite";

type AliasEntry = {
  find: string | RegExp;
  replacement: string;
};
type AliasConfig = AliasEntry[] | Record<string, string> | undefined;

const mode =
  process.env.STORYBOOK_COMPONENT_KIT_MODE === "built" ? "built" : "live";

const storybookDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(storybookDir, "../dist");
const modeLoaderPath = path.resolve(
  storybookDir,
  `component-kit-loader.${mode}.ts`,
);
const componentKitRuntimeDir = path.resolve(storybookDir, "../src/runtime");
const frontendSharedDir = path.resolve(
  storybookDir,
  "../../frontend/src/shared",
);
const frontendSrcDir = path.resolve(storybookDir, "../../frontend/src");

// In the app these specifiers resolve through the host's import map; inside
// Storybook we alias them to the frontend's expose sources so live mode
// bundles them directly. Built mode uses the frontend package's reusable
// Storybook host plugin and its generated import-map manifest.
const sharedSpecifierAlias: AliasEntry = {
  find: "@erato/frontend/shared",
  replacement: `${frontendSharedDir}/index.ts`,
};

const normalizeAliasEntries = (alias: AliasConfig): AliasEntry[] => {
  if (Array.isArray(alias)) {
    return alias;
  }
  if (alias && typeof alias === "object") {
    return Object.entries(alias).map(([find, replacement]) => ({
      find,
      replacement,
    }));
  }
  return [];
};

const withoutComponentKitRuntimeAliases = (alias: AliasConfig): AliasConfig => {
  if (Array.isArray(alias)) {
    return alias.filter(
      (entry) => !entry.replacement.startsWith(componentKitRuntimeDir),
    );
  }

  if (alias && typeof alias === "object") {
    return Object.fromEntries(
      Object.entries(alias).filter(
        ([, replacement]) => !replacement.startsWith(componentKitRuntimeDir),
      ),
    );
  }

  return alias;
};

const config: StorybookConfig = {
  stories: ["./*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  typescript: {
    check: false,
    reactDocgen: false,
  },
  viteFinal: (config) => {
    const existingAliases = normalizeAliasEntries(
      withoutComponentKitRuntimeAliases(config.resolve?.alias as AliasConfig),
    );

    return {
      ...config,
      define: {
        ...config.define,
        "import.meta.env.STORYBOOK_COMPONENT_KIT_MODE": JSON.stringify(mode),
      },
      resolve: {
        ...config.resolve,
        alias: [
          {
            find: "virtual:component-kit-mode-loader",
            replacement: modeLoaderPath,
          },
          ...(mode === "live"
            ? [sharedSpecifierAlias, { find: "@", replacement: frontendSrcDir }]
            : []),
          ...existingAliases,
        ],
        dedupe: [
          ...(config.resolve?.dedupe ?? []),
          "@lingui/core",
          "@lingui/react",
          "@tanstack/react-query",
          "react",
          "react-dom",
          "react-router",
          "react-router-dom",
        ],
      },
      plugins: [
        ...(config.plugins ?? []),
        ...(mode === "built"
          ? [eratoComponentKitStorybook({ componentKitDirectory: distDir })]
          : eratoComponentKitLiveStorybook()),
      ],
    };
  },
};

export default config;
