import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Plugin } from "vite";

const CATALOG_MODULE_ID = "virtual:erato-icon-catalogs";
const SIMPLE_BUCKET_PREFIX = "virtual:erato-simple-icons/";
const ICONOIR_BUCKET_PREFIX = "virtual:erato-iconoir-icons/";
const ICONOIR_FILE_PREFIX = "virtual:erato-iconoir-file/";
const ICONOIR_CATALOG_QUERY = "?erato-icon-catalog";

const resolvedCatalogModuleId = `\0${CATALOG_MODULE_ID}`;
const resolvedSimpleBucketPrefix = `\0${SIMPLE_BUCKET_PREFIX}`;
const resolvedIconoirBucketPrefix = `\0${ICONOIR_BUCKET_PREFIX}`;

type SimpleIconDefinition = {
  path: string;
  title: string;
};

type IconCatalogData = {
  simpleBuckets: Map<string, Record<string, SimpleIconDefinition>>;
  iconoirBuckets: Map<string, Array<{ fileName: string; key: string }>>;
  iconoirFileByName: Map<string, string>;
};

const normalizeSimpleIconToken = (value: string): string =>
  value
    .replace(/^si(?=[A-Z0-9])/, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

const normalizeIconoirToken = (value: string): string =>
  value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const bucketForToken = (token: string): string => token.charAt(0) || "other";

const appendBucketValue = <T>(
  buckets: Map<string, T[]>,
  bucket: string,
  value: T,
): void => {
  const values = buckets.get(bucket);
  if (values) {
    values.push(value);
  } else {
    buckets.set(bucket, [value]);
  }
};

const loadCatalogData = async (rootDir: string): Promise<IconCatalogData> => {
  const simpleIconsEntry = fs.realpathSync(
    path.join(rootDir, "node_modules/simple-icons/index.mjs"),
  );
  const simpleIconExports = (await import(
    pathToFileURL(simpleIconsEntry).href
  )) as Record<string, unknown>;
  const simpleBuckets = new Map<string, Record<string, SimpleIconDefinition>>();

  for (const exportKey of Object.keys(simpleIconExports).sort()) {
    const icon = simpleIconExports[exportKey];
    if (
      !exportKey.startsWith("si") ||
      typeof icon !== "object" ||
      icon === null ||
      !("path" in icon) ||
      !("title" in icon) ||
      typeof icon.path !== "string" ||
      typeof icon.title !== "string"
    ) {
      continue;
    }

    const key = normalizeSimpleIconToken(exportKey);
    const bucket = bucketForToken(key);
    const entries = simpleBuckets.get(bucket) ?? {};
    entries[key] = { path: icon.path, title: icon.title };
    simpleBuckets.set(bucket, entries);
  }

  const iconoirDirectory = fs.realpathSync(
    path.join(rootDir, "node_modules/iconoir-react/dist/esm/regular"),
  );
  const iconoirBuckets = new Map<
    string,
    Array<{ fileName: string; key: string }>
  >();
  const iconoirFileByName = new Map<string, string>();

  for (const fileName of fs.readdirSync(iconoirDirectory).sort()) {
    if (fileName === "index.mjs" || !fileName.endsWith(".mjs")) {
      continue;
    }

    const exportName = path.basename(fileName, ".mjs");
    const key = normalizeIconoirToken(exportName);
    appendBucketValue(iconoirBuckets, bucketForToken(key), {
      fileName,
      key,
    });
    iconoirFileByName.set(fileName, path.join(iconoirDirectory, fileName));
  }

  return { simpleBuckets, iconoirBuckets, iconoirFileByName };
};

const createLoaderMapSource = (
  buckets: Iterable<string>,
  modulePrefix: string,
): string =>
  `{${[...buckets]
    .sort()
    .map(
      (bucket) =>
        `${JSON.stringify(bucket)}: () => import(${JSON.stringify(`${modulePrefix}${bucket}`)})`,
    )
    .join(",")}}`;

const createCatalogModuleSource = (catalog: IconCatalogData): string => `
const simpleLoaders = ${createLoaderMapSource(
  catalog.simpleBuckets.keys(),
  SIMPLE_BUCKET_PREFIX,
)};
const iconoirLoaders = ${createLoaderMapSource(
  catalog.iconoirBuckets.keys(),
  ICONOIR_BUCKET_PREFIX,
)};
const simpleCache = new Map();
const iconoirCache = new Map();
const emptyBucket = Promise.resolve({});

const loadBucket = (loaders, cache, bucket) => {
  const loader = loaders[bucket];
  if (!loader) return emptyBucket;
  let promise = cache.get(bucket);
  if (!promise) {
    promise = loader().then((module) => module.default);
    cache.set(bucket, promise);
  }
  return promise;
};

export const loadSimpleIconBucket = (bucket) =>
  loadBucket(simpleLoaders, simpleCache, bucket);
export const loadIconoirIconBucket = (bucket) =>
  loadBucket(iconoirLoaders, iconoirCache, bucket);
`;

const createIconoirBucketSource = (
  entries: Array<{ fileName: string; key: string }>,
): string => {
  const imports = entries.map(
    ({ fileName }, index) =>
      `import Icon${index} from ${JSON.stringify(
        `${ICONOIR_FILE_PREFIX}${encodeURIComponent(fileName)}`,
      )};`,
  );
  const registryEntries = entries.map(
    ({ key }, index) => `${JSON.stringify(key)}: Icon${index}`,
  );
  return `${imports.join("\n")}\nexport default {${registryEntries.join(",")}};`;
};

export const iconCatalogPlugin = ({ rootDir }: { rootDir: string }): Plugin => {
  let catalogPromise: Promise<IconCatalogData> | undefined;
  const catalog = (): Promise<IconCatalogData> => {
    catalogPromise ??= loadCatalogData(rootDir);
    return catalogPromise;
  };

  return {
    name: "erato-icon-catalogs",
    resolveId(source) {
      if (source === CATALOG_MODULE_ID) {
        return resolvedCatalogModuleId;
      }
      if (
        source.startsWith(SIMPLE_BUCKET_PREFIX) ||
        source.startsWith(ICONOIR_BUCKET_PREFIX)
      ) {
        return `\0${source}`;
      }
      if (source.startsWith(ICONOIR_FILE_PREFIX)) {
        const fileName = decodeURIComponent(
          source.slice(ICONOIR_FILE_PREFIX.length),
        );
        return catalog().then(({ iconoirFileByName }) => {
          const filePath = iconoirFileByName.get(fileName);
          // Keep catalog icons separate from Iconoir's synchronous app imports.
          return filePath ? `${filePath}${ICONOIR_CATALOG_QUERY}` : null;
        });
      }
      return null;
    },
    async load(id) {
      const catalogData = await catalog();
      if (id === resolvedCatalogModuleId) {
        return createCatalogModuleSource(catalogData);
      }
      if (id.startsWith(resolvedSimpleBucketPrefix)) {
        const bucket = id.slice(resolvedSimpleBucketPrefix.length);
        return `export default ${JSON.stringify(
          catalogData.simpleBuckets.get(bucket) ?? {},
        )};`;
      }
      if (id.startsWith(resolvedIconoirBucketPrefix)) {
        const bucket = id.slice(resolvedIconoirBucketPrefix.length);
        return createIconoirBucketSource(
          catalogData.iconoirBuckets.get(bucket) ?? [],
        );
      }
      return null;
    },
  };
};

export const iconCatalogManualChunk = (
  moduleId: string,
): string | undefined => {
  if (moduleId.startsWith(resolvedSimpleBucketPrefix)) {
    return `simple-icons-${moduleId.slice(resolvedSimpleBucketPrefix.length)}`;
  }
  if (moduleId.startsWith(resolvedIconoirBucketPrefix)) {
    return `iconoir-icons-${moduleId.slice(resolvedIconoirBucketPrefix.length)}`;
  }
  if (moduleId.endsWith(ICONOIR_CATALOG_QUERY)) {
    const filePath = moduleId.slice(0, -ICONOIR_CATALOG_QUERY.length);
    const token = normalizeIconoirToken(path.basename(filePath, ".mjs"));
    return `iconoir-icons-${bucketForToken(token)}`;
  }

  return undefined;
};
