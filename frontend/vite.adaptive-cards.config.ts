import { readFileSync } from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { iconCatalogPlugin } from "./vite.icon-catalogs";

import type { Plugin } from "vite";

/**
 * Builds the web's tool call cards as one script for engines without a DOM,
 * such as the backend's, which turns them into Adaptive Cards for Teams.
 * `scripts/build-adaptive-cards.mjs` runs this and writes the result next to
 * the backend code that loads it.
 */

const LOCALES = ["en", "de", "fr", "es", "pl"];
const PLACEHOLDER = "__ADAPTIVE_CARD_CATALOGS__";

/** Whether the code holds `id` as a string literal, in any quotes. */
const quotes = (code: string, id: string) =>
  ['"', "'", "`"].some((quote) => code.includes(`${quote}${id}${quote}`));

/** Puts in each language only the messages the bundled code asks for. */
const catalogsPlugin = (): Plugin => ({
  name: "erato-adaptive-card-catalogs",
  enforce: "post",
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk" || !chunk.code.includes(PLACEHOLDER)) continue;
      const catalogs: Record<string, Record<string, unknown>> = {};
      for (const locale of LOCALES) {
        const file = path.resolve(
          __dirname,
          `src/locales/${locale}/messages.json`,
        );
        const { messages } = JSON.parse(readFileSync(file, "utf8")) as {
          messages: Record<string, unknown>;
        };
        catalogs[locale] = Object.fromEntries(
          Object.keys(messages)
            .sort()
            .filter((id) => quotes(chunk.code, id))
            .map((id) => [id, messages[id]]),
        );
      }
      chunk.code = chunk.code.replace(PLACEHOLDER, JSON.stringify(catalogs));
    }
  },
});

/** Modules whose browser side effects a card render never needs. */
const STUBS: Record<string, string> = {
  "src/hooks/audio/approvalSpeech.ts":
    "src/adaptiveCards/stubs/approvalSpeech.ts",
  "src/hooks/ui/useThemedIcon.ts": "src/adaptiveCards/stubs/useThemedIcon.ts",
};

/**
 * Modules that only draw icons. The cards skip every `svg`, so each export
 * becomes a component that renders nothing, and the icon sets stay out.
 */
const ICON_MODULES = ["src/components/ui/icons/ResolvedIcon.tsx"];
const ICON_STUB_PREFIX = "\0erato-icon-stub:";

const exportNamesOf = (source: string): string[] => {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }
  for (const clause of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of clause[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && name !== "default" && !part.trim().startsWith("type "))
        names.add(name);
    }
  }
  return [...names].sort();
};

const iconStub = (names: string[]) =>
  [
    "const Nothing = () => null;",
    ...names.map((name) => `export const ${name} = Nothing;`),
    "export default Nothing;",
  ].join("\n");

const stubsPlugin = (): Plugin => ({
  name: "erato-adaptive-card-stubs",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (source === "iconoir-react") return `${ICON_STUB_PREFIX}iconoir-react`;
    if (source.startsWith(ICON_STUB_PREFIX)) return source;
    const resolved = await this.resolve(source, importer, {
      ...options,
      skipSelf: true,
    });
    if (!resolved) return null;
    const relative = path
      .relative(__dirname, resolved.id)
      .split(path.sep)
      .join("/");
    if (ICON_MODULES.includes(relative))
      return `${ICON_STUB_PREFIX}${relative}`;
    const stub = STUBS[relative];
    return stub ? path.resolve(__dirname, stub) : null;
  },
  load(id) {
    if (!id.startsWith(ICON_STUB_PREFIX)) return null;
    const target = id.slice(ICON_STUB_PREFIX.length);
    const file =
      target === "iconoir-react"
        ? path.resolve(
            __dirname,
            "node_modules/iconoir-react/dist/esm/index.mjs",
          )
        : path.resolve(__dirname, target);
    return iconStub(exportNamesOf(readFileSync(file, "utf8")));
  },
});

export default defineConfig({
  plugins: [
    stubsPlugin(),
    react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }),
    iconCatalogPlugin({ rootDir: __dirname }),
    catalogsPlugin(),
  ],
  publicDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "import.meta.env.MODE": JSON.stringify("production"),
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    dedupe: ["@lingui/core", "react"],
  },
  build: {
    outDir: process.env.ADAPTIVE_CARDS_OUT_DIR ?? "out-adaptive-cards",
    emptyOutDir: true,
    target: "es2020",
    minify: true,
    reportCompressedSize: false,
    lib: {
      entry: path.resolve(__dirname, "src/adaptiveCards/entry.ts"),
      formats: ["iife"],
      name: "EratoAdaptiveCardsBundle",
      fileName: () => "tool_call_cards.js",
    },
  },
});
