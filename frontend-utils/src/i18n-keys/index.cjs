const fs = require("node:fs/promises");
const path = require("node:path");

const { getCatalogs } = require("@lingui/cli/api");
const { getConfig } = require("@lingui/conf");

const EXTRA_COMMENT_PREFIX = "js-lingui-extra:";
const SECTION_HEADER_COMMENT_LINES = new Set([
  "==============================",
  "Explicit IDs",
  "Unstable IDs",
]);
const EXPLICIT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

const isExplicitId = (msgId) => EXPLICIT_ID_PATTERN.test(msgId);

const normalizeExtraValue = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const mergeUnique = (
  existing = [],
  incoming = [],
  keyFn = (value) => value,
) => {
  const seen = new Set(existing.map(keyFn));
  const result = [...existing];

  for (const value of incoming) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
};

const sortObject = (record) =>
  Object.fromEntries(
    Object.entries(record).sort(([keyA], [keyB]) => keyA.localeCompare(keyB)),
  );

const cleanCommentsAndExtractExtra = (comments = []) => {
  const cleanComments = [];
  const extra = {};

  for (const comment of comments) {
    for (const line of comment.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (SECTION_HEADER_COMMENT_LINES.has(trimmedLine)) {
        continue;
      }

      if (!line.startsWith(EXTRA_COMMENT_PREFIX)) {
        if (line) {
          cleanComments.push(line);
        }
        continue;
      }

      const metadata = line.slice(EXTRA_COMMENT_PREFIX.length).trim();
      const separatorIndex = metadata.indexOf("=");
      if (separatorIndex === -1) {
        cleanComments.push(line);
        continue;
      }

      const key = metadata.slice(0, separatorIndex).trim();
      const rawValue = metadata.slice(separatorIndex + 1).trim();
      if (key === "") {
        cleanComments.push(line);
        continue;
      }

      extra[key] = normalizeExtraValue(rawValue);
    }
  }

  return { cleanComments, extra };
};

const normalizePlaceholders = (placeholders = {}) =>
  sortObject(
    Object.fromEntries(
      Object.entries(placeholders)
        .filter(([, values]) => Array.isArray(values) && values.length > 0)
        .map(([key, values]) => [key, [...new Set(values)].sort()]),
    ),
  );

const normalizeCatalogEntry = (message) => {
  const { cleanComments, extra } = cleanCommentsAndExtractExtra(
    message.comments,
  );
  const messageExtra = Object.fromEntries(
    Object.entries(message.extra ?? {}).filter(
      ([key]) => key !== "flags" && key !== "translatorComments",
    ),
  );
  const contexts = message.context ? [message.context] : [];
  const placeholders = normalizePlaceholders(message.placeholders);
  const mergedExtra = sortObject({ ...messageExtra, ...extra });

  return {
    ...(cleanComments.length > 0
      ? { comments: [...new Set(cleanComments)].sort() }
      : {}),
    ...(contexts.length > 0 ? { contexts } : {}),
    ...(Object.keys(mergedExtra).length > 0 ? { extra: mergedExtra } : {}),
    ...(Object.keys(placeholders).length > 0 ? { placeholders } : {}),
  };
};

const mergeManifestEntry = (existing, incoming) => ({
  ...(existing.comments || incoming.comments
    ? {
        comments: mergeUnique(existing.comments, incoming.comments).sort(),
      }
    : {}),
  ...(existing.contexts || incoming.contexts
    ? {
        contexts: mergeUnique(existing.contexts, incoming.contexts).sort(),
      }
    : {}),
  ...(existing.extra || incoming.extra
    ? {
        extra: sortObject({
          ...(existing.extra ?? {}),
          ...(incoming.extra ?? {}),
        }),
      }
    : {}),
  ...(existing.placeholders || incoming.placeholders
    ? {
        placeholders: sortObject({
          ...(existing.placeholders ?? {}),
          ...(incoming.placeholders ?? {}),
        }),
      }
    : {}),
});

const collectCatalogs = async (rootDir, configPath) => {
  const originalCwd = process.cwd();
  process.chdir(rootDir);

  try {
    const config = getConfig({ configPath, cwd: rootDir });
    const catalogs = await getCatalogs(config);
    const entries = {};

    for (const catalog of catalogs) {
      const extractedCatalog = await catalog.collect();
      if (!extractedCatalog) {
        throw new Error(`Failed to collect Lingui catalog ${catalog.path}`);
      }

      for (const [msgId, message] of Object.entries(extractedCatalog)) {
        if (!isExplicitId(msgId)) {
          continue;
        }

        entries[msgId] = mergeManifestEntry(
          entries[msgId] ?? {},
          normalizeCatalogEntry(message),
        );
      }
    }

    return entries;
  } finally {
    process.chdir(originalCwd);
  }
};

const createI18nKeysManifest = async (options = {}) => {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const configPath = options.configPath
    ? path.resolve(rootDir, options.configPath)
    : undefined;
  const entries = await collectCatalogs(rootDir, configPath);

  return {
    schemaVersion: 1,
    keys: sortObject(entries),
  };
};

const writeI18nKeysManifest = async (outputPath, options = {}) => {
  const manifest = await createI18nKeysManifest(options);
  const resolvedOutputPath = path.resolve(
    options.rootDir ?? process.cwd(),
    outputPath,
  );

  await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await fs.writeFile(
    resolvedOutputPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return manifest;
};

const i18nKeysManifestPlugin = (options = {}) => ({
  name: "erato-i18n-keys-manifest",
  apply: "build",
  async generateBundle() {
    const manifest = await createI18nKeysManifest({
      configPath: options.configPath,
      rootDir: options.rootDir,
    });

    this.emitFile({
      type: "asset",
      fileName: options.fileName ?? "i18n_keys.json",
      source: `${JSON.stringify(manifest, null, 2)}\n`,
    });
  },
});

module.exports = {
  createI18nKeysManifest,
  i18nKeysManifestPlugin,
  writeI18nKeysManifest,
};
