/**
 * Custom Lingui PO formatter support for Erato.
 *
 * This module keeps the `.po` formatting behavior that is specific to this
 * repository out of `lingui.config.ts`. It defines the formatter-facing types,
 * parses and serializes Lingui catalogs, preserves custom `extra` metadata via
 * extracted comments, keeps PO headers stable across repeated extracts, and
 * groups messages into explicit-id and unstable-id sections.
 */
import { formatter as poFormatter } from "@lingui/format-po";

/**
 * Supported options for the underlying Lingui PO formatter.
 */
export type PoFormatterOptions = {
  origins?: boolean;
  lineNumbers?: boolean;
  printLinguiId?: boolean;
  explicitIdAsDefault?: boolean;
  customHeaderAttributes?: { [key: string]: string };
  printPlaceholdersInComments?: boolean | { limit?: number };
};

/**
 * A single Lingui message origin entry.
 */
export type MessageOrigin = [filename: string, line?: number];

/**
 * The message shape used by the custom formatter.
 */
export type MessageType = {
  message?: string;
  origin?: MessageOrigin[];
  comments?: string[];
  obsolete?: boolean;
  context?: string;
  translation: string;
  extra?: Record<string, unknown>;
};

/**
 * The catalog shape used by the custom formatter.
 */
export type CatalogType = {
  [msgId: string]: MessageType;
};

/**
 * The formatter interface expected by Lingui config.
 */
export type CatalogFormatter = {
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

const EXTRA_COMMENT_PREFIX = "js-lingui-extra:";
const SECTION_HEADER_COMMENT_LINES = new Set([
  "==============================",
  "Explicit IDs",
  "Unstable IDs",
]);
const SECTION_HEADER_EXPLICIT = `# ==============================
# Explicit IDs
# ==============================`;

const SECTION_HEADER_UNSTABLE = `# ==============================
# Unstable IDs
# ==============================`;

/**
 * Matches stable dot-separated Lingui ids used by the application.
 */
const EXPLICIT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

/**
 * Returns whether a message id should be treated as an explicit stable id.
 */
function isExplicitId(msgId: string): boolean {
  return EXPLICIT_ID_PATTERN.test(msgId);
}

/**
 * Removes duplicate origins by filename and sorts the remaining entries so the
 * serialized output stays deterministic across environments.
 */
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

      deduplicatedOrigins.sort((a, b) => a[0].localeCompare(b[0]));
      result[msgId] = { ...message, origin: deduplicatedOrigins };
    } else {
      result[msgId] = message;
    }
  }

  return result;
}

/**
 * Splits a catalog into explicit-id and unstable-id buckets.
 */
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

/**
 * Sorts catalog messages by id or by source message text, depending on the
 * bucket being serialized.
 */
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

/**
 * Splits serialized PO content into the Lingui-generated header block and the
 * remaining message body so the header can be preserved across sections.
 */
function extractPoHeader(content: string): { header: string; body: string } {
  const lines = content.split("\n");
  const headerLines: string[] = [];
  let inMsgstr = false;
  let bodyStartIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === 0 && line === 'msgid ""') {
      headerLines.push(line);
      continue;
    }

    if (index === 1 && line === 'msgstr ""') {
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

    bodyStartIndex = index;
    break;
  }

  return {
    header: headerLines.join("\n"),
    body: lines.slice(bodyStartIndex).join("\n"),
  };
}

/**
 * Removes one section header from the beginning of a serialized body when the
 * underlying formatter already emitted the same header.
 */
function stripLeadingSectionHeader(
  body: string,
  sectionHeader: string,
): string {
  const trimmedBody = body.trimStart();
  if (!trimmedBody.startsWith(sectionHeader)) {
    return body;
  }

  return trimmedBody.slice(sectionHeader.length).replace(/^\n+/, "");
}

/**
 * Collapses accidental duplicate section headers produced while composing the
 * explicit and unstable sections into a single file.
 */
function collapseRepeatedSectionHeaders(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const isSectionHeader =
      lines[index] === "# ==============================" &&
      (lines[index + 1] === "# Explicit IDs" ||
        lines[index + 1] === "# Unstable IDs") &&
      lines[index + 2] === "# ==============================";

    if (!isSectionHeader) {
      result.push(lines[index]);
      index += 1;
      continue;
    }

    const headerLine = lines[index + 1];
    result.push(lines[index], headerLine, lines[index + 2]);
    index += 3;

    while (lines[index] === "") {
      index += 1;
    }

    while (
      lines[index] === "# ==============================" &&
      lines[index + 1] === headerLine &&
      lines[index + 2] === "# =============================="
    ) {
      index += 3;
      while (lines[index] === "") {
        index += 1;
      }
    }
  }

  return result.join("\n");
}

/**
 * Converts a metadata comment value back into its original JSON-compatible
 * representation when possible.
 */
function normalizeExtraValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Extracts custom metadata comments from a Lingui message comment list and
 * returns the remaining comments plus the reconstructed `extra` payload.
 */
function extractCustomExtraComments(comments: string[] = []): {
  comments: string[];
  extra: Record<string, unknown>;
} {
  const extra: Record<string, unknown> = {};
  const remainingComments: string[] = [];

  for (const comment of comments) {
    if (SECTION_HEADER_COMMENT_LINES.has(comment.trim())) {
      continue;
    }

    if (!comment.startsWith(EXTRA_COMMENT_PREFIX)) {
      remainingComments.push(comment);
      continue;
    }

    const metadata = comment.slice(EXTRA_COMMENT_PREFIX.length).trim();
    const separatorIndex = metadata.indexOf("=");
    if (separatorIndex === -1) {
      remainingComments.push(comment);
      continue;
    }

    const key = metadata.slice(0, separatorIndex).trim();
    const rawValue = metadata.slice(separatorIndex + 1).trim();
    if (key === "") {
      remainingComments.push(comment);
      continue;
    }

    extra[key] = normalizeExtraValue(rawValue);
  }

  return { comments: remainingComments, extra };
}

/**
 * Appends `extra` metadata to Lingui comments so the standard PO formatter can
 * write that metadata into the generated `.po` file.
 */
function injectCustomExtraComments(catalog: CatalogType): CatalogType {
  return Object.fromEntries(
    Object.entries(catalog).map(([msgId, message]) => {
      const extraEntries = Object.entries(message.extra ?? {}).filter(
        ([key]) => key !== "flags" && key !== "translatorComments",
      );

      const comments = (message.comments ?? []).filter((comment) => {
        if (SECTION_HEADER_COMMENT_LINES.has(comment.trim())) {
          return false;
        }

        if (
          extraEntries.length > 0 &&
          comment.startsWith(EXTRA_COMMENT_PREFIX)
        ) {
          return false;
        }

        return true;
      });

      if (extraEntries.length === 0) {
        return [
          msgId,
          {
            ...message,
            comments,
          },
        ];
      }

      const extraComments = extraEntries
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(
          ([key, value]) =>
            `${EXTRA_COMMENT_PREFIX} ${key}=${JSON.stringify(value)}`,
        );

      return [
        msgId,
        {
          ...message,
          comments: [...comments, ...extraComments],
        },
      ];
    }),
  );
}

/**
 * Restores custom `extra` metadata from serialized PO comments when catalogs
 * are parsed back into Lingui message objects.
 */
function restoreCustomExtraFromComments(catalog: CatalogType): CatalogType {
  return Object.fromEntries(
    Object.entries(catalog).map(([msgId, message]) => {
      const { comments, extra } = extractCustomExtraComments(message.comments);
      if (Object.keys(extra).length === 0) {
        return [
          msgId,
          {
            ...message,
            comments,
          },
        ];
      }

      return [
        msgId,
        {
          ...message,
          comments,
          extra: {
            ...(message.extra ?? {}),
            ...extra,
          },
        },
      ];
    }),
  );
}

/**
 * Creates the repository-specific PO formatter that preserves metadata, keeps
 * extract output stable, and groups messages into the established sections.
 */
export function sectionedPoFormatter(
  options?: PoFormatterOptions,
): CatalogFormatter {
  const baseFormatter = poFormatter(options);
  const shouldDeduplicateOrigins = options?.lineNumbers === false;

  return {
    catalogExtension: baseFormatter.catalogExtension,
    templateExtension: baseFormatter.templateExtension,
    parse: async (content, ctx) =>
      restoreCustomExtraFromComments(await baseFormatter.parse(content, ctx)),
    serialize: async (catalog, ctx) => {
      const catalogWithExtraComments = injectCustomExtraComments(catalog);
      const processedCatalog = shouldDeduplicateOrigins
        ? deduplicateOrigins(catalogWithExtraComments)
        : catalogWithExtraComments;
      const { explicit, unstable } = splitCatalog(processedCatalog);
      const sortedExplicit = sortCatalogByMsgId(explicit, true);
      const sortedUnstable = sortCatalogByMsgId(unstable, false);

      if (
        Object.keys(sortedExplicit).length === 0 &&
        Object.keys(sortedUnstable).length === 0
      ) {
        return baseFormatter.serialize(catalogWithExtraComments, ctx);
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

        const explicitBody = stripLeadingSectionHeader(
          body,
          SECTION_HEADER_EXPLICIT,
        );
        if (explicitBody.trim()) {
          parts.push(explicitBody.trim());
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

        const unstableBody = stripLeadingSectionHeader(
          body,
          SECTION_HEADER_UNSTABLE,
        );
        if (unstableBody.trim()) {
          parts.push(unstableBody.trim());
        }
      }

      return collapseRepeatedSectionHeaders(parts.join("\n") + "\n");
    },
  };
}
