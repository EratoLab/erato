export type I18nKeysManifestEntry = {
  comments?: string[];
  contexts?: string[];
  extra?: Record<string, unknown>;
  placeholders?: Record<string, string[]>;
};

export type I18nKeysManifest = {
  schemaVersion: 1;
  keys: Record<string, I18nKeysManifestEntry>;
};

export type I18nKeysManifestOptions = {
  configPath?: string;
  rootDir?: string;
};

export type I18nKeysManifestPluginOptions = I18nKeysManifestOptions & {
  fileName?: string;
};

export function createI18nKeysManifest(
  options?: I18nKeysManifestOptions,
): Promise<I18nKeysManifest>;

export function writeI18nKeysManifest(
  outputPath: string,
  options?: I18nKeysManifestOptions,
): Promise<I18nKeysManifest>;

export function i18nKeysManifestPlugin(
  options?: I18nKeysManifestPluginOptions,
): {
  name: string;
  apply: "build";
  generateBundle(this: {
    emitFile(file: { type: "asset"; fileName: string; source: string }): void;
  }): Promise<void>;
};
