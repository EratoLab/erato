import { wordHostPlatform } from "./wordHostPlatform";

import type { WordHostPlatform } from "./wordHostPlatform";

export type WordWholeDocumentImport = "allowed" | "confirm" | "off";

/** Deployment switches for one Word host (`default_settings.word_apply`); users cannot change them. */
export interface WordApplyPolicy {
  /** Write plans in place where a probed mechanism applies. */
  inPlace: boolean;
  wholeDocumentImport: WordWholeDocumentImport;
  /** Read the complete .docx; off falls back to reading the body. */
  packageRead: boolean;
}

export type WordApplyHost = "pc" | "mac" | "web";

/** Mirrors the backend defaults, for a pane served without the backend's settings. */
const DEFAULTS: Record<WordApplyHost, WordApplyPolicy> = {
  pc: { inPlace: false, wholeDocumentImport: "allowed", packageRead: true },
  mac: { inPlace: false, wholeDocumentImport: "allowed", packageRead: true },
  web: { inPlace: true, wholeDocumentImport: "off", packageRead: true },
};

const IMPORT_VALUES: readonly WordWholeDocumentImport[] = [
  "allowed",
  "confirm",
  "off",
];

export function wordApplyHost(platform: WordHostPlatform): WordApplyHost {
  return platform === "OfficeOnline"
    ? "web"
    : platform === "Mac"
      ? "mac"
      : "pc";
}

/** A build or probe override of the deployment's in-place switch; the kill switch wins. */
export function wordInPlaceOverride(): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.WORD_FORCE_IMPORT_APPLY === true) return false;
  if (window.WORD_IN_PLACE_APPLY === true) return true;
  return undefined;
}

export function wordApplyPolicy(
  platform: WordHostPlatform = wordHostPlatform(),
): WordApplyPolicy {
  const host = wordApplyHost(platform);
  const fallback = DEFAULTS[host];
  const configured =
    typeof window === "undefined"
      ? undefined
      : window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS?.word_apply?.[host];
  const configuredImport = configured?.whole_document_import;
  const override = wordInPlaceOverride();
  return {
    inPlace:
      override ??
      (typeof configured?.in_place === "boolean"
        ? configured.in_place
        : fallback.inPlace),
    wholeDocumentImport:
      configuredImport && IMPORT_VALUES.includes(configuredImport)
        ? configuredImport
        : fallback.wholeDocumentImport,
    packageRead:
      typeof configured?.package_read === "boolean"
        ? configured.package_read
        : fallback.packageRead,
  };
}
