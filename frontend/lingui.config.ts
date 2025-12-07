import { defineConfig } from "@lingui/cli";
import { formatter as poFormatter } from "@lingui/format-po";

// ============================================================================
// SECTIONED PO FORMATTER
// A custom formatter that organizes messages into "Explicit IDs" and
// "Unstable IDs" sections, sorted alphabetically within each section.
// ============================================================================

type PoFormatterOptions = {
  origins?: boolean;
  lineNumbers?: boolean;
  printLinguiId?: boolean;
  explicitIdAsDefault?: boolean;
  customHeaderAttributes?: { [key: string]: string };
  printPlaceholdersInComments?: boolean | { limit?: number };
};

type MessageOrigin = [filename: string, line?: number];

type MessageType = {
  message?: string;
  origin?: MessageOrigin[];
  comments?: string[];
  obsolete?: boolean;
  context?: string;
  translation: string;
  extra?: Record<string, unknown>;
};

type CatalogType = {
  [msgId: string]: MessageType;
};

type CatalogFormatter = {
  catalogExtension: string;
  templateExtension?: string;
  parse(
    content: string,
    ctx: { locale: string | null; sourceLocale: string; filename: string },
  ): Promise<CatalogType> | CatalogType;
  serialize(
    catalog: CatalogType,
    ctx: {
      locale: string | null;
      sourceLocale: string;
      filename: string;
      existing: string | null;
    },
  ): Promise<string> | string;
};

const SECTION_HEADER_EXPLICIT = `# ==============================
# Explicit IDs
# ==============================`;

const SECTION_HEADER_UNSTABLE = `# ==============================
# Unstable IDs
# ==============================`;

/**
 * Pattern to detect explicit IDs (namespace-style like branding.page_title_suffix).
 */
const EXPLICIT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

function isExplicitId(msgId: string): boolean {
  return EXPLICIT_ID_PATTERN.test(msgId);
}

function deduplicateOrigins(catalog: CatalogType): CatalogType {
  const result: CatalogType = {};
  for (const [msgId, message] of Object.entries(catalog)) {
    if (message.origin && message.origin.length > 0) {
      const uniqueFilenames = new Set<string>();
      const deduplicatedOrigins: MessageOrigin[] = [];
      for (const origin of message.origin) {
        const filename = origin[0];
        if (!uniqueFilenames.has(filename)) {
          uniqueFilenames.add(filename);
          deduplicatedOrigins.push([filename]);
        }
      }
      // Sort origins alphabetically to ensure deterministic output across environments
      deduplicatedOrigins.sort((a, b) => a[0].localeCompare(b[0]));
      result[msgId] = { ...message, origin: deduplicatedOrigins };
    } else {
      result[msgId] = message;
    }
  }
  return result;
}

function splitCatalog(catalog: CatalogType): {
  explicit: CatalogType;
  unstable: CatalogType;
} {
  const explicit: CatalogType = {};
  const unstable: CatalogType = {};
  for (const [msgId, message] of Object.entries(catalog)) {
    if (isExplicitId(msgId)) {
      explicit[msgId] = message;
    } else {
      unstable[msgId] = message;
    }
  }
  return { explicit, unstable };
}

function sortCatalogByMsgId(
  catalog: CatalogType,
  useKeyAsId: boolean,
): CatalogType {
  const sortedEntries = Object.entries(catalog).sort(
    ([keyA, msgA], [keyB, msgB]) => {
      const idA = useKeyAsId ? keyA : (msgA.message ?? keyA);
      const idB = useKeyAsId ? keyB : (msgB.message ?? keyB);
      return idA.localeCompare(idB);
    },
  );
  return Object.fromEntries(sortedEntries);
}

function extractPoHeader(content: string): { header: string; body: string } {
  const lines = content.split("\n");
  const headerLines: string[] = [];
  let inMsgstr = false;
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line === 'msgid ""') {
      headerLines.push(line);
      continue;
    }
    if (i === 1 && line === 'msgstr ""') {
      headerLines.push(line);
      inMsgstr = true;
      continue;
    }
    if (inMsgstr && line.startsWith('"')) {
      headerLines.push(line);
      continue;
    }
    if (line === "") {
      headerLines.push(line);
      continue;
    }
    bodyStartIndex = i;
    break;
  }

  return {
    header: headerLines.join("\n"),
    body: lines.slice(bodyStartIndex).join("\n"),
  };
}

function sectionedPoFormatter(options?: PoFormatterOptions): CatalogFormatter {
  const baseFormatter = poFormatter(options);
  const shouldDeduplicateOrigins = options?.lineNumbers === false;

  return {
    catalogExtension: baseFormatter.catalogExtension,
    templateExtension: baseFormatter.templateExtension,
    parse: baseFormatter.parse,

    serialize: async (
      catalog: CatalogType,
      ctx: {
        locale: string | null;
        sourceLocale: string;
        filename: string;
        existing: string | null;
      },
    ) => {
      const processedCatalog = shouldDeduplicateOrigins
        ? deduplicateOrigins(catalog)
        : catalog;
      const { explicit, unstable } = splitCatalog(processedCatalog);
      const sortedExplicit = sortCatalogByMsgId(explicit, true);
      const sortedUnstable = sortCatalogByMsgId(unstable, false);

      if (
        Object.keys(sortedExplicit).length === 0 &&
        Object.keys(sortedUnstable).length === 0
      ) {
        return baseFormatter.serialize(catalog, ctx);
      }

      const parts: string[] = [];

      if (Object.keys(sortedExplicit).length > 0) {
        const explicitSerialized = await baseFormatter.serialize(
          sortedExplicit,
          ctx,
        );
        const { header, body } = extractPoHeader(explicitSerialized);
        parts.push(header);
        parts.push(SECTION_HEADER_EXPLICIT);
        parts.push("");
        if (body.trim()) {
          parts.push(body.trim());
        }
      }

      if (Object.keys(sortedUnstable).length > 0) {
        const unstableSerialized = await baseFormatter.serialize(
          sortedUnstable,
          ctx,
        );
        const { header, body } = extractPoHeader(unstableSerialized);
        if (Object.keys(sortedExplicit).length === 0) {
          parts.push(header);
        }
        if (parts.length > 0) {
          parts.push("");
        }
        parts.push(SECTION_HEADER_UNSTABLE);
        parts.push("");
        if (body.trim()) {
          parts.push(body.trim());
        }
      }

      return parts.join("\n") + "\n";
    },
  };
}

// ============================================================================
// LINGUI CONFIGURATION
// ============================================================================

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "fr", "pl", "es"], // English, German, French, Polish, and Spanish
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["src"],
      exclude: ["**/node_modules/**", "**/out/**", "**/.next/**", "**/test/**"],
    },
    {
      path: "<rootDir>/public/custom-theme/{name}/locales/{locale}/messages",
      include: ["<rootDir>/public/custom-theme/{name}/"],
      exclude: ["**/node_modules/**", "**/out/**", "**/.next/**", "**/test/**"],
    },
  ],
  compileNamespace: "json", // Generate JSON files, as those can be more easily loaded dynamically for the custom-theme
  // Use sectioned PO format that groups explicit IDs and unstable IDs separately
  format: sectionedPoFormatter({ lineNumbers: false }),
});
