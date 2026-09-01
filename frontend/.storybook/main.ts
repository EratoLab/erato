import { fileURLToPath, URL } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";

import { iconCatalogPlugin } from "../vite.icon-catalogs";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-onboarding",
    "@storybook/addon-essentials",
    "@chromatic-com/storybook",
    "@storybook/addon-actions",
    "@storybook/addon-interactions",
    "@storybook/addon-themes",
    "@storybook/addon-a11y",
    "@storybook/addon-storysource",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../public"],
  typescript: {
    reactDocgen: "react-docgen-typescript",
    check: false,
  },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    plugins: [
      ...(viteConfig.plugins ?? []),
      iconCatalogPlugin({ rootDir: frontendRoot }),
    ],
  }),
};
export default config;
