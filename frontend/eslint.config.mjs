import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import typescriptParser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import linguiPlugin from "eslint-plugin-lingui";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** @type {import('eslint').Linter.FlatConfig[]} */
const eslintConfig = [
  {
    ignores: [
      "src/lib/generated/**/*",
      "src/locales/**/*.ts", // Ignore generated Lingui translation files
      // "src/stories/**/*",
      ".next/**/*",
      "node_modules/**/*",
      "out/**/*",
      "src/hooks/chat/__tests__/useChatHistory.test.tsx",
    ],
  },
  // Base configuration for all files
  ...compat.extends(
    "next/core-web-vitals",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
    "plugin:tailwindcss/recommended",
  ),

  // Storybook configuration - less strict
  {
    files: [".storybook/**/*.ts", ".storybook/**/*.tsx"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2020,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
    },
    rules: {
      // Basic TypeScript rules for Storybook
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },

  // TypeScript specific configuration (general rules for all TS files)
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: "./tsconfig.json",
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2020,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
    },
    rules: {
      // Basic TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "error",

      // React specific rules
      "react/prop-types": "off", // TypeScript handles this better
      "react/jsx-uses-react": "off", // Not needed in React 17+
      "react/react-in-jsx-scope": "off", // Not needed in React 17+
      "react/no-danger": "error", // Prevent dangerous HTML injection
      "react/jsx-no-target-blank": "error", // Security for _blank links

      // React hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Type checking rules - these catch actual runtime bugs
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/restrict-plus-operands": "error",
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/unbound-method": "error",

      // Additional TypeScript safety rules
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports" },
      ],

      // Import rules
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
    },
  },

  // Lingui i18n rules - ONLY for user-facing files
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [
      // Test files
      "src/**/*.test.*",
      "src/**/*.spec.*",
      "src/**/__tests__/**/*",
      "src/**/__mocks__/**/*",
      "src/**/test/**/*",
      "src/**/tests/**/*",

      // Storybook files
      "src/**/*.stories.*",
      "src/**/stories/**/*",
      "src/.storybook/**/*",

      // Mock and utility files that aren't user-facing
      "src/**/mocks/**/*",
      "src/**/mock/**/*",
      "src/test/**/*",

      // Config and setup files
      "src/config/**/*",
      "src/utils/**/*", // Often contains dev utilities
      "src/lib/generated/**/*",
      "src/lib/setupTests.ts", // Test setup
      "src/lib/i18n.ts", // i18n setup itself
      "src/locales/**/*", // Translation files themselves

      // Provider files (often contain dev-oriented strings)
      "src/providers/**/*",

      // Type definition files (usually don't contain user strings)
      "src/**/types/**/*",
      "src/**/*.d.ts",

      // Deep hook files with mostly dev/debug strings
      "src/hooks/**/handlers/**/*", // Event handlers with debug strings
      "src/hooks/**/store/**/*", // State management with debug strings
    ],
    plugins: {
      lingui: linguiPlugin,
    },
    rules: {
      // Lingui i18n rules - detect hardcoded strings in user-facing code only
      "lingui/no-unlocalized-strings": [
        "warn",
        {
          // Ignore JSX attribute names that contain technical values
          ignoreNames: ["className", "class"],

          // Ignore logging and debugging function calls
          ignoreFunctions: [
            // Standard logging functions
            "console\\.(log|error|warn|info|debug|trace)",

            // Custom logger functions (common patterns)
            "logger\\.(log|error|warn|info|debug|trace|verbose)",
            "log\\.(log|error|warn|info|debug|trace|verbose)",

            // Logger creation functions
            "createLogger",
            "getLogger",

            // Development and debugging functions
            "debugLog",
            "devLog",
            "trace",

            // Error tracking functions
            "reportError",
            "captureException",
            "logError",

            // Metrics and analytics (usually technical identifiers)
            "track",
            "analytics",
            "gtag",

            // Navigation functions (routes/URLs are technical, not user text)
            "navigate",
            "router\\.(push|replace|back|forward|go|prefetch)",
            "history\\.(push|replace|back|forward|go)",
            "redirect",
            "permanentRedirect",
            "rewrite",
            "notFound",

            // DOM API functions (technical identifiers)
            "document\\.(getElementById|querySelector|querySelectorAll|createElement|getElementsByClassName|getElementsByTagName)",
            "element\\.(setAttribute|getAttribute|classList)",
            "container\\.(addEventListener|removeEventListener|scrollTo|scrollIntoView)",
            "window\\.(addEventListener|removeEventListener|requestAnimationFrame|setTimeout|clearTimeout)",

            // Error throwing (developer errors, not user-facing)
            "throw",
            "Error",
            "TypeError",
            "ReferenceError",
            "SyntaxError",

            // Common development utility functions
            "assert",
            "invariant",
            "warning",

            // String methods for technical checks (not user content)
            "\\.includes",
            "\\.startsWith",
            "\\.endsWith",
            "\\.indexOf",
            "\\.search",
            "\\.match",
            "\\.test",
          ],

          // Ignore common development/technical patterns
          ignore: [
            // Technical identifiers and debug prefixes
            "^\\[DEBUG.*?\\]",
            "^\\[TRACE.*?\\]",
            "^\\[ERROR.*?\\]",
            "^\\[WARN.*?\\]",
            "^\\[INFO.*?\\]",

            // Tailwind CSS class names (never user-facing text)
            "^[a-z-]+:[a-z-]+", // Tailwind modifiers like "hover:", "focus:", "lg:"
            "^(sm|md|lg|xl|2xl):", // Responsive prefixes
            "^(hover|focus|active|disabled|visited):", // State prefixes
            "^(group|peer)-", // Group/peer modifiers
            "^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$", // Text sizes
            "^(p|m|px|py|mx|my|pt|pr|pb|pl|mt|mr|mb|ml)-", // Spacing utilities
            "^(w|h|min-w|min-h|max-w|max-h)-", // Sizing utilities
            "^(bg|text|border|ring|shadow)-", // Color utilities
            "^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky)$", // Layout utilities
            "^(rounded|border|shadow|opacity|z)-", // Visual utilities
            "^(inset|top|right|bottom|left)-", // Position utilities
            "^(space|divide|gap)-", // Spacing utilities
            "^theme-", // Custom theme classes
            "^[a-z]+[a-z0-9:-]*$", // General Tailwind utility pattern (covers inset-0, z-50, etc.)

            // Multi-class Tailwind strings (space-separated utilities)
            "^[a-z0-9:-]+(\\s+[a-z0-9:-]+)+$", // Multiple space-separated classes (including colons for modifiers)
            "^[a-z-]+:[a-z0-9:-]+(\\s+[a-z-]+:[a-z0-9:-]+)*$", // Modifier classes with spaces

            // Logging context strings (internal debugging, not user-facing)
            "SSE closed unexpectedly",
            "SSE closed normally",
            "SSE error",
            "Assistant message completed",
            "Send message error",
            "Message cancelled",
            "Connection error",
            "Upload failed",
            "Upload completed",
            "Query invalidated",
            "Cache cleared",

            // Technical strings used in .includes(), .startsWith(), etc. checks
            "^completed$",
            "^error$",
            "^loading$",
            "^pending$",
            "^success$",
            "^failed$",
            "^cancelled$",
            "^active$",
            "^inactive$",
            "^enabled$",
            "^disabled$",

            // DOM element IDs and technical selectors
            "^root$",
            "^app$",
            "^main$",
            "^#[a-zA-Z]", // CSS selectors starting with #
            "^\\.[a-zA-Z]", // CSS class selectors starting with .
            "^\\[.*?\\]$", // CSS attribute selectors like [role="menuitem"]
            "^\\[.*?=.*?\\]$", // CSS attribute selectors with values

            // Developer error messages (technical, not user-facing)
            "Could not find.*element",
            "Failed to.*element",
            "Element.*not found",
            "Missing.*element",

            // DOM event names (technical identifiers)
            "^scroll$",
            "^click$",
            "^resize$",
            "^load$",
            "^error$",
            "^focus$",
            "^blur$",
            "^change$",
            "^input$",
            "^submit$",
            "^keydown$",
            "^keyup$",
            "^mousedown$",
            "^mouseup$",
            "^mouseover$",
            "^mouseout$",

            // ARIA roles and HTML attributes (technical identifiers)
            "^menuitem$",
            "^menu$",
            "^button$",
            "^dialog$",
            "^listbox$",
            "^option$",
            "^tab$",
            "^tabpanel$",
            "^tablist$",
            "^combobox$",
            "^textbox$",
            "^checkbox$",
            "^radio$",
            "^slider$",
            "^progressbar$",
            "^alert$",
            "^alertdialog$",
            "^tooltip$",
            "^presentation$",
            "^none$",
            "^main$",
            "^navigation$",
            "^banner$",
            "^contentinfo$",
            "^complementary$",
            "^search$",
            "^form$",
            "^region$",

            // CSS property values (technical identifiers)
            "^auto$",
            "^smooth$",
            "^none$",
            "^inherit$",
            "^initial$",
            "^unset$",
            "^flex$",
            "^block$",
            "^inline$",
            "^absolute$",
            "^relative$",
            "^fixed$",
            "^sticky$",
            "^hidden$",
            "^visible$",
            "^scroll$",
            "^nowrap$",
            "^wrap$",
            "^center$",
            "^left$",
            "^right$",
            "^top$",
            "^bottom$",

            // Common technical patterns
            "rgba?\\(",
            "hsla?\\(",
            "calc\\(",
            "var\\(--",

            // CSS custom property names (CSS variables)
            "^--[a-zA-Z][a-zA-Z0-9-]*$", // CSS custom properties like "--theme-focus-ring"

            // React/Next.js directives
            "^use client$",
            "^use server$",

            // HTTP headers and values (technical identifiers)
            "^Content-Type$",
            "^Authorization$",
            "^Accept$",
            "^User-Agent$",
            "^Cache-Control$",
            "^multipart/form-data$",
            "^application/json$",
            "^text/plain$",
            "^application/x-www-form-urlencoded$",

            // React Query/TanStack Query keys (technical identifiers)
            "^tokenEstimation$",
            "^chatHistory$",
            "^chatMessages$",
            "^fileUpload$",
            "^userProfile$",
            "^[a-z][a-zA-Z]*Estimation$", // camelCase ending with "Estimation"
            "^[a-z][a-zA-Z]*History$", // camelCase ending with "History"
            "^[a-z][a-zA-Z]*Upload$", // camelCase ending with "Upload"
            "^[a-z][a-zA-Z]*Profile$", // camelCase ending with "Profile"
            "^[a-z][a-zA-Z]*Messages$", // camelCase ending with "Messages"
            "^[a-z][a-zA-Z]*Query$", // camelCase ending with "Query"
            "^[a-z][a-zA-Z]*Mutation$", // camelCase ending with "Mutation"
            "^[a-z][a-zA-Z]*Cache$", // camelCase ending with "Cache"
            "^[a-z][a-zA-Z]*Store$", // camelCase ending with "Store"

            // URLs and technical identifiers
            "^https?://",
            "^[a-z]+://",
            "^[A-Z_]+$", // All caps constants
            "^[a-z]+\\.[a-z]+", // Object paths like "user.name"
          ],
        },
      ],
      "lingui/no-single-variables-to-translate": "error",
      "lingui/no-expression-in-message": "error",
      "lingui/no-single-tag-to-translate": "error",
      "lingui/no-trans-inside-trans": "error",
    },
  },
];

export default eslintConfig;
