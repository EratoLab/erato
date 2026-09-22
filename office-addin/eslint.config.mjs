import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import linguiPlugin from "eslint-plugin-lingui";

import { themableGeometryConfig } from "../frontend/eslint/themable-geometry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

/** @type {import("eslint").Linter.FlatConfig[]} */
const eslintConfig = [
  {
    ignores: ["dist/**/*", "node_modules/**/*", ".pnpm-store/**/*"],
  },
  ...compat.extends(
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
  ),
  {
    languageOptions: {
      globals: {
        Office: "readonly",
        OfficeRuntime: "readonly",
        Word: "readonly",
        React: "readonly",
        JSX: "readonly",
        URL: "readonly",
        atob: "readonly",
        btoa: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        process: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        window: "readonly",
        __dirname: "readonly",
      },
    },
    settings: {
      react: {
        version: "detect",
      },
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2020,
        project: "./tsconfig.json",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      import: importPlugin,
      lingui: linguiPlugin,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "import/no-duplicates": "error",
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling"],
            "index",
            "object",
            "type",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc" },
        },
      ],
      "lingui/no-unlocalized-strings": "off",
      "no-unused-vars": "off",
      "no-control-regex": "off",
      "react/jsx-no-target-blank": "error",
      "react/no-danger": "error",
      "react/prop-types": "off",
    },
  },
  // Themable corner geometry - shared with the frontend so the two cannot drift
  themableGeometryConfig({
    files: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"],
  }),

  {
    files: ["src/core/**/*.ts", "src/core/**/*.tsx"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/core",
              from: "./src",
              except: ["./core"],
              message:
                "Host-neutral core files must receive host behavior through explicit components or props.",
            },
          ],
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/OfficeProvider",
                "**/Outlook*",
                "**/outlook/**",
                "**/sessionPolicy/**",
                "**/useOutlook*",
                "**/Teams*",
                "**/teams/**",
                "@microsoft/teams-js",
                "**/Word*",
                "**/word/**",
              ],
              message:
                "Host-neutral core files must receive host behavior through explicit components or props.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "Office",
          message: "Office.js is owned by the Office.js host compositions.",
        },
        {
          name: "OfficeRuntime",
          message: "Office.js is owned by the Office.js host compositions.",
        },
      ],
    },
  },
  {
    files: [
      "src/hooks/**/*.ts",
      "src/hooks/**/*.tsx",
      "src/providers/**/*.ts",
      "src/providers/**/*.tsx",
      "src/utils/**/*.ts",
      "src/utils/**/*.tsx",
      "src/auth/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/outlook/**",
                "!**/test/mocks/outlook/**",
                "**/teams/**",
                "!**/test/mocks/teams/**",
                "**/word/**",
                "!**/test/mocks/word/**",
              ],
              message:
                "The shared ring must not depend on a host module; move shared code out or invert the dependency.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/teams/**/*.ts", "src/teams/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/OfficeProvider",
                "**/OfficeThemeProvider",
                "**/Outlook*",
                "**/outlook/**",
                "**/sessionPolicy/**",
                "**/useOffice*",
                "**/useOutlook*",
                "**/Word*",
                "**/word/**",
              ],
              message:
                "The Teams composition is a peer of the Outlook and Word ones: only one host SDK and one set of registry overrides per document.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "Office",
          message: "Office.js is owned by the Office.js host compositions.",
        },
        {
          name: "OfficeRuntime",
          message: "Office.js is owned by the Office.js host compositions.",
        },
      ],
    },
  },
  {
    files: ["src/outlook/**/*.ts", "src/outlook/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/Teams*",
                "**/teams/**",
                "@microsoft/teams-js",
                "**/Word*",
                "**/word/**",
              ],
              message:
                "The Outlook composition is a peer of the Teams and Word ones: only one host SDK and one set of registry overrides per document.",
            },
          ],
        },
      ],
    },
  },
  {
    // Word is an Office.js host, so unlike the Teams zone this one deliberately
    // does NOT ban Office/OfficeRuntime, `**/OfficeProvider`,
    // `**/OfficeThemeProvider` or `**/useOffice*`: the Word composition
    // consumes all of them from the shared ring.
    files: ["src/word/**/*.ts", "src/word/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/Outlook*",
                "**/outlook/**",
                "**/sessionPolicy/**",
                "**/useOutlook*",
                "**/Teams*",
                "**/teams/**",
                "@microsoft/teams-js",
              ],
              message:
                "The Word composition is a peer of the Outlook and Teams ones: only one host SDK and one set of registry overrides per document.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
