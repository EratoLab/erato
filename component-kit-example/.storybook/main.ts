import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";
import type { Plugin } from "vite";

const mode =
  process.env.STORYBOOK_COMPONENT_KIT_MODE === "built" ? "built" : "live";

const storybookDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(storybookDir, "../dist");

const resolveDistFile = (matcher: RegExp): string => {
  if (!fs.existsSync(distDir)) {
    throw new Error(
      `Component kit dist directory does not exist: ${distDir}. Run pnpm build first.`,
    );
  }

  const matches = fs
    .readdirSync(distDir)
    .filter((fileName) => matcher.test(fileName))
    .sort();

  if (matches.length === 0) {
    throw new Error(
      `No component kit dist file matching ${matcher} in ${distDir}`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple component kit dist files matching ${matcher} in ${distDir}: ${matches.join(", ")}`,
    );
  }

  return path.join(distDir, matches[0]);
};

const builtComponentKitPlugin = (): Plugin => {
  const builtEntryModuleId = "virtual:component-kit-built-entry";
  const builtStyleModuleId = "virtual:component-kit-built-style";
  const resolvedBuiltEntryModuleId = `\0${builtEntryModuleId}`;
  const resolvedBuiltStyleModuleId = `\0${builtStyleModuleId}`;

  return {
    name: "component-kit-built-storybook",
    resolveId(id) {
      if (id === builtEntryModuleId) {
        return resolvedBuiltEntryModuleId;
      }
      if (id === builtStyleModuleId) {
        return resolvedBuiltStyleModuleId;
      }
      return null;
    },
    load(id) {
      if (id === resolvedBuiltEntryModuleId) {
        return fs.readFileSync(resolveDistFile(/^index-.*\.js$/), "utf8");
      }

      if (id === resolvedBuiltStyleModuleId) {
        const css = fs.readFileSync(resolveDistFile(/^style\.css$/), "utf8");
        return `
const existing = document.querySelector("style[data-erato-component-kit-storybook-built]");
if (existing) {
  existing.remove();
}
const style = document.createElement("style");
style.dataset.eratoComponentKitStorybookBuilt = "true";
style.textContent = ${JSON.stringify(css)};
document.head.append(style);
`;
      }

      return null;
    },
  };
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
  viteFinal: (config) => ({
    ...config,
    define: {
      ...config.define,
      "import.meta.env.STORYBOOK_COMPONENT_KIT_MODE": JSON.stringify(mode),
    },
    plugins: [...(config.plugins ?? []), builtComponentKitPlugin()],
  }),
};

export default config;
