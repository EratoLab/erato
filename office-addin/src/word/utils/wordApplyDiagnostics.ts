import { parseWordXml } from "./wordDocumentPackageCodec";
import { wordFullDocumentDifferences } from "./wordFullDocumentComparison";
import { createWordXmlComparison } from "./wordXmlComparison";

import type { WordDocumentDiagnostic } from "./wordApplyDocumentPlan";

/** Package shape only: part and customXml counts can reveal duplicated imports without any content. */
export interface WordPackageStats {
  label: "source" | "live" | "expected" | "actual";
  parts: number;
  customXmlItems: number;
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
  error?: string;
}

const MAX_PARTS = 12;
const PART_PATH = /^\/[A-Za-z0-9_.\-/[\]]{1,160}$/;

export function wordPackageStats(
  label: WordPackageStats["label"],
  ooxml: string | undefined,
): WordPackageStats | undefined {
  if (!ooxml) return undefined;
  return {
    label,
    parts: ooxml.match(/<pkg:part\b/g)?.length ?? 0,
    customXmlItems:
      ooxml.match(/pkg:name="\/customXml\/item\d+\.xml"/g)?.length ?? 0,
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
  const api17 = office?.requirements?.isSetSupported?.("WordApi", "1.7");
  return [
    `${String(d?.host ?? "?")} ${String(d?.platform ?? "?")} ${d?.version ?? "?"}`,
    `WordApi 1.7: ${api17 === undefined ? "?" : api17 ? "yes" : "no"}`,
    `saved document: ${office?.document?.url ? "yes" : "no"}`,
  ].join(" · ");
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
    ...(details?.parts?.length
      ? [
          `Differing parts: ${details.parts.join(", ")}${details.partsOmitted ? ` (+${details.partsOmitted} more)` : ""}`,
        ]
      : []),
    ...(details?.locations ?? []).map((where) => `Where: ${where}`),
    ...(details?.packages ?? []).map(
      (p) =>
        `Package ${p.label}: ${p.parts} parts, ${p.customXmlItems} customXml items`,
    ),
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
