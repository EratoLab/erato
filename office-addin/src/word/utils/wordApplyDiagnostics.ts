import { parseWordXml } from "./wordDocumentPackageCodec";
import {
  WORD_APPLY_ADJUSTMENTS,
  wordFullDocumentDifferences,
  wordPackageCounts,
} from "./wordFullDocumentComparison";
import { WORD_IN_PLACE_FALLBACKS } from "./wordInPlacePlan";
import { wordInPlaceAvailability } from "./wordInPlaceSwitch";
import { createWordXmlComparison } from "./wordXmlComparison";

import type {
  WordApplyOutcome,
  WordDocumentDiagnostic,
} from "./wordApplyDocumentPlan";
import type {
  WordApplyAdjustment,
  WordVerifyTier,
} from "./wordFullDocumentComparison";

export const WORD_APPLY_ROUTES = ["import", "body", "in-place"] as const;
/** Closed list: why a plan did not run in place. */
export const WORD_ROUTE_REASONS = [
  "disabled",
  "latched",
  "host-sets",
  "no-package",
  "alignment",
  "host-error",
  ...WORD_IN_PLACE_FALLBACKS,
] as const;
export type WordRouteReason = (typeof WORD_ROUTE_REASONS)[number];

/** Package shape only: part, customXml and numbering counts reveal duplicated imports without any content. */
export interface WordPackageStats {
  label: "source" | "live" | "expected" | "actual";
  parts: number;
  customXmlItems: number;
  customProperties?: number;
  abstractNums?: number;
  nums?: number;
  webextensionParts?: number;
}

/** Everything here must stay free of document text: part paths, counts and our own error messages only. */
export interface WordDiagnosticDetails {
  parts?: string[];
  partsOmitted?: number;
  /** First divergence inside a part as an element path; attribute names only, never values or text. */
  locations?: string[];
  packages?: WordPackageStats[];
  urlChanged?: boolean;
  /** WordPlanIssue code of the re-read document, e.g. "unsupported". */
  snapshotIssue?: string;
  /** Most lenient verification tier that was tried. */
  verifyTier?: WordVerifyTier | "block";
  adjustments?: WordApplyAdjustment[];
  route?: WordApplyOutcome["route"];
  routeReason?: WordRouteReason;
  inPlaceOps?: number;
  /** Body paragraph counts: predicted from the captured package and reported by Word. */
  paragraphs?: { predicted: number; live: number };
  /** Changes Word wrote before it stopped, and those it never reached. */
  partial?: { applied: number; untouched: number };
  /** Blocks changed elsewhere since the capture, which an in-place write leaves untouched. */
  outsideChanges?: number;
  /** Why a plan needs the full-document import, which Track Changes rules out. */
  fallbackReasons?: WordRouteReason[];
  error?: string;
}

/** Only error codes/API locations, part paths and counts, never statements, document text or raw debugInfo. */
export function wordDocumentDiagnostic(
  stage: WordDocumentDiagnostic["stage"],
  reason: WordDocumentDiagnostic["reason"],
  error?: unknown,
  details: WordDiagnosticDetails = {},
): WordDocumentDiagnostic {
  const merged: WordDiagnosticDetails = {
    ...(error === undefined ? {} : { error: wordErrorText(error) }),
    ...details,
  };
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const info =
    typeof record.debugInfo === "object" && record.debugInfo !== null
      ? (record.debugInfo as Record<string, unknown>)
      : {};
  const code = record.code;
  const location = info.errorLocation;
  return {
    stage,
    reason,
    ...(typeof code === "string" && /^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(code)
      ? { officeCode: code }
      : {}),
    ...(typeof location === "string" &&
    /^[A-Za-z][A-Za-z0-9_.()[\]-]{0,159}$/.test(location)
      ? { officeLocation: location }
      : {}),
    ...(Object.keys(merged).length ? { details: merged } : {}),
  };
}

const MAX_PARTS = 12;
const PART_PATH = /^\/[A-Za-z0-9_.\-/[\]]{1,160}$/;

export function wordPackageStats(
  label: WordPackageStats["label"],
  ooxml: string | undefined,
): WordPackageStats | undefined {
  if (!ooxml) return undefined;
  const counts = wordPackageCounts(ooxml);
  return {
    label,
    parts: counts.parts,
    customXmlItems: counts.customXmlItems,
    customProperties: counts.customProperties,
    abstractNums: counts.abstractNums,
    nums: counts.nums,
    webextensionParts: counts.webextensionParts,
  };
}

function partList(
  paths: readonly string[],
): Pick<WordDiagnosticDetails, "parts" | "partsOmitted"> {
  const safe = paths.map((path) =>
    PART_PATH.test(path) ? path : "<unnamed part>",
  );
  return {
    parts: safe.slice(0, MAX_PARTS),
    ...(safe.length > MAX_PARTS
      ? { partsOmitted: safe.length - MAX_PARTS }
      : {}),
  };
}

/** Parts whose strict (stale-check) fingerprints differ. */
export function strictDifferingParts(
  beforeXml: string,
  afterXml: string,
): Pick<WordDiagnosticDetails, "parts" | "partsOmitted" | "error"> {
  try {
    const a = createWordXmlComparison(parseWordXml(beforeXml)),
      b = createWordXmlComparison(parseWordXml(afterXml));
    const before = a.partFingerprints(),
      after = b.partFingerprints();
    if (!before.size && !after.size)
      return a.fingerprint() === b.fingerprint()
        ? {}
        : partList(["/word/document.xml"]);
    return partList(
      [...new Set([...before.keys(), ...after.keys()])].filter(
        (path) => before.get(path) !== after.get(path),
      ),
    );
  } catch (error) {
    return { error: `part comparison failed: ${wordErrorText(error)}` };
  }
}

/** Parts that fail full-document write verification, with where each first diverges. */
export function verifyDifferingParts(
  expectedXml: string,
  actualXml: string,
): Pick<
  WordDiagnosticDetails,
  "parts" | "partsOmitted" | "locations" | "error"
> {
  try {
    const { parts, locations } = wordFullDocumentDifferences(
      expectedXml,
      actualXml,
      true,
    );
    return { ...partList(parts), ...(locations.length ? { locations } : {}) };
  } catch (error) {
    return { error: `package comparison failed: ${wordErrorText(error)}` };
  }
}

export function packageStats(
  entries: [WordPackageStats["label"], string | undefined][],
): Pick<WordDiagnosticDetails, "packages"> {
  const packages = entries
    .map(([label, ooxml]) => wordPackageStats(label, ooxml))
    .filter((stats): stats is WordPackageStats => !!stats);
  return packages.length ? { packages } : {};
}

/** Office errors (they carry `code`) can quote document content in their message, so only their
 * name is kept; code and location travel separately. Our own errors use fixed messages. */
export function wordErrorText(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  if (typeof (error as { code?: unknown }).code === "string") return error.name;
  const text = `${error.name}: ${error.message}`.replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function hostLine(): string {
  const office = globalThis.Office?.context;
  const d = office?.diagnostics;
  const supported = (version: string) => {
    const value = office?.requirements?.isSetSupported?.("WordApi", version);
    return value === undefined ? "?" : value ? "yes" : "no";
  };
  const inPlace = wordInPlaceAvailability();
  return [
    `${String(d?.host ?? "?")} ${String(d?.platform ?? "?")} ${d?.version ?? "?"}`,
    `WordApi 1.6: ${supported("1.6")}`,
    `WordApi 1.7: ${supported("1.7")}`,
    `saved document: ${office?.document?.url ? "yes" : "no"}`,
    `In-place: ${inPlace.enabled ? "on" : `off (${inPlace.reason})`}`,
  ].join(" · ");
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function packageLine(p: WordPackageStats): string {
  const count = (value: number | undefined, unit: string) =>
    Number.isSafeInteger(value) ? [`${value} ${unit}`] : [];
  return `Package ${p.label}: ${[
    ...count(p.parts, "parts"),
    ...count(p.customXmlItems, "customXml items"),
    ...count(p.customProperties, "custom properties"),
    ...count(p.abstractNums, "abstractNum"),
    ...count(p.nums, "num"),
    ...count(p.webextensionParts, "task pane parts"),
  ].join(", ")}`;
}

export function renderWordDiagnosticReport(
  operation: string,
  status: string | undefined,
  diagnostic: WordDocumentDiagnostic | undefined,
  error?: string,
): string {
  const details = diagnostic?.details;
  const lines = [
    `Word add-in ${operation} failed`,
    `Status: ${status ?? "?"}`,
    ...(diagnostic
      ? [`Stage: ${diagnostic.stage}`, `Reason: ${diagnostic.reason}`]
      : []),
    ...(diagnostic?.officeCode || diagnostic?.officeLocation
      ? [
          `Office error: ${[diagnostic.officeCode, diagnostic.officeLocation].filter(Boolean).join(" · ")}`,
        ]
      : []),
    ...(details?.error || error ? [`Error: ${details?.error ?? error}`] : []),
    ...(details?.urlChanged
      ? ["Document URL changed during the operation"]
      : []),
    ...(details?.snapshotIssue
      ? [`Re-read document issue: ${details.snapshotIssue}`]
      : []),
    ...(details?.route && WORD_APPLY_ROUTES.includes(details.route)
      ? [
          `Route: ${details.route}${
            details.routeReason &&
            WORD_ROUTE_REASONS.includes(details.routeReason)
              ? ` (${details.routeReason})`
              : ""
          }`,
        ]
      : []),
    ...(details?.fallbackReasons?.some((code) =>
      WORD_ROUTE_REASONS.includes(code),
    )
      ? [
          `Needs full rewrite: ${details.fallbackReasons
            .filter((code) => WORD_ROUTE_REASONS.includes(code))
            .join(", ")}`,
        ]
      : []),
    ...(isCount(details?.inPlaceOps)
      ? [`In-place changes: ${details.inPlaceOps}`]
      : []),
    ...(details?.paragraphs &&
    isCount(details.paragraphs.predicted) &&
    isCount(details.paragraphs.live)
      ? [
          `Paragraphs: ${details.paragraphs.predicted} expected, ${details.paragraphs.live} in Word`,
        ]
      : []),
    ...(details?.partial &&
    isCount(details.partial.applied) &&
    isCount(details.partial.untouched)
      ? [
          `Partly written: ${details.partial.applied} changed, ${details.partial.untouched} untouched`,
        ]
      : []),
    ...(isCount(details?.outsideChanges)
      ? [
          `Changed elsewhere before apply: ${details.outsideChanges} blocks (left untouched)`,
        ]
      : []),
    ...(details?.verifyTier &&
    ["strict", "content", "block"].includes(details.verifyTier)
      ? [`Verify tier: ${details.verifyTier}`]
      : []),
    ...(details?.adjustments?.some((code) =>
      WORD_APPLY_ADJUSTMENTS.includes(code),
    )
      ? [
          `Adjustments: ${details.adjustments
            .filter((code) => WORD_APPLY_ADJUSTMENTS.includes(code))
            .join(", ")}`,
        ]
      : []),
    ...(details?.parts?.length
      ? [
          `Differing parts: ${details.parts.join(", ")}${details.partsOmitted ? ` (+${details.partsOmitted} more)` : ""}`,
        ]
      : []),
    ...(details?.locations ?? []).map((where) => `Where: ${where}`),
    ...(details?.packages ?? []).map(packageLine),
    `Host: ${hostLine()}`,
  ];
  return lines.join("\n");
}

export function logWordDiagnostic(
  operation: string,
  status: string,
  diagnostic: WordDocumentDiagnostic,
): void {
  console.warn(
    `[erato] Word ${operation} ${status}`,
    renderWordDiagnosticReport(operation, status, diagnostic),
  );
}
