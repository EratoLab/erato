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
    ignores: [
      "dist/**/*",
      "release/**/*",
      "node_modules/**/*",
      ".pnpm-store/**/*",
    ],
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
        React: "readonly",
        JSX: "readonly",
        URL: "readonly",
        atob: "readonly",
        btoa: "readonly",
        console: "readonly",
        document: "readonly",
        navigator: "readonly",
        process: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        window: "readonly",
        __dirname: "readonly",
        // Baked in by vite.config.ts (`define`); vitest sets it on globalThis.
        __DESKTOP_UI_VERSION__: "readonly",
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
    files: [
      "src/**/*.ts",
      "src/**/*.tsx",
      "vite.config.ts",
      "vitest.config.ts",
    ],
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
    // The bundle runs inside the sidecar's webview with a CSP that blocks every
    // network API; it must never try one. Catalogs are imported statically.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "The desktop UI bundle never talks to the network.",
        },
        {
          name: "XMLHttpRequest",
          message: "The desktop UI bundle never talks to the network.",
        },
        {
          name: "WebSocket",
          message: "The desktop UI bundle never talks to the network.",
        },
        {
          name: "EventSource",
          message: "The desktop UI bundle never talks to the network.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "The desktop UI bundle is embedded whole; import every module statically.",
        },
      ],
    },
  },
];

export default eslintConfig;
