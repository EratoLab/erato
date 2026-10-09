import { SEARCH_SIDECAR_INDEX_TOOL, sharedLabelNumbers } from "./chatTools";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type SearchCoverageSourceStatus =
  | "complete"
  | "indexing"
  | "newest_pending"
  | "unavailable";

/** One source of a `search_sidecar_index` result, as the model receives it. */
export interface SearchCoverageSource {
  sourceId: string;
  label: string;
  /** Tells sources with the same label apart; absent when the label is unique. */
  number?: number;
  kinds: string[];
  /** First covered instant, inclusive. Null while the source is unavailable. */
  from: string | null;
  /** Last covered instant, inclusive. */
  to: string | null;
  status: SearchCoverageSourceStatus;
  /** The sidecar's `unavailableReason`, only when `status` is unavailable. */
  reason?: string;
  partialCache: boolean;
  /** Items in the period that are only partly on this device or not indexable. */
  unsearchable?: number;
  requestedFromBeforeCoverage: boolean;
}

export interface KnownSearchCoverage {
  v: 1;
  asOf: string;
  basis: string;
  /** The search's date filter as inclusive bounds. */
  requested: { from: string | null; to: string | null };
  requestedFromBeforeCoverage: boolean;
  limitReached: boolean;
  sources: SearchCoverageSource[];
  notice: string;
}

export interface UnknownSearchCoverage {
  v: 1;
  status: "unknown";
  /** Present when the sidecar reported it without a coverage report. */
  limitReached?: boolean;
  notice: string;
}

/** `result.coverage` of a `search_sidecar_index` tool result. */
export type SearchCoverage = KnownSearchCoverage | UnknownSearchCoverage;

export type LocalSearchCoverageSummary =
  | { status: "unknown" }
  | {
      status: "known";
      /** Numbered among themselves, since each search numbers only its own. */
      sources: SearchCoverageSource[];
      /** Earliest requested start that lies before a source's coverage. */
      requestedFrom: string | null;
    };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIsoOrNull = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" && !Number.isNaN(Date.parse(value)));

function readSource(value: unknown): SearchCoverageSource | null {
  if (
    !isObject(value) ||
    typeof value.sourceId !== "string" ||
    typeof value.label !== "string" ||
    !Array.isArray(value.kinds) ||
    !isIsoOrNull(value.from) ||
    !isIsoOrNull(value.to) ||
    typeof value.status !== "string"
  ) {
    return null;
  }
  return value as unknown as SearchCoverageSource;
}

function readCoverage(part: ContentPart): SearchCoverage | null {
  if (
    part.content_type !== "tool_use" ||
    part.tool_name !== SEARCH_SIDECAR_INDEX_TOOL ||
    !isObject(part.output) ||
    part.output.status !== "success" ||
    !isObject(part.output.result)
  ) {
    return null;
  }
  const coverage = part.output.result.coverage;
  if (!isObject(coverage) || coverage.v !== 1) return null;
  if (coverage.status === "unknown") {
    return coverage as unknown as UnknownSearchCoverage;
  }
  if (
    typeof coverage.asOf !== "string" ||
    !Array.isArray(coverage.sources) ||
    !isObject(coverage.requested)
  ) {
    return null;
  }
  return coverage as unknown as KnownSearchCoverage;
}

/**
 * What a message's local searches covered, for the footer under the reply.
 * Null when the message made no successful local search, including every
 * message stored before searches reported coverage.
 */
export function summarizeLocalSearchCoverage(
  content: readonly ContentPart[],
): LocalSearchCoverageSummary | null {
  const latest = new Map<
    string,
    { asOf: string; source: SearchCoverageSource }
  >();
  let known = false;
  let unknown = false;
  let requestedFrom: string | null = null;
  for (const part of content) {
    const coverage = readCoverage(part);
    if (!coverage) continue;
    if ("status" in coverage) {
      unknown = true;
      continue;
    }
    known = true;
    for (const value of coverage.sources) {
      const source = readSource(value);
      if (!source) continue;
      const previous = latest.get(source.sourceId);
      const kept =
        previous && Date.parse(coverage.asOf) < Date.parse(previous.asOf)
          ? previous
          : { asOf: coverage.asOf, source };
      latest.set(source.sourceId, {
        asOf: kept.asOf,
        source: {
          ...kept.source,
          // The warning stays for every later search, so its source keeps leading.
          requestedFromBeforeCoverage:
            source.requestedFromBeforeCoverage === true ||
            previous?.source.requestedFromBeforeCoverage === true,
        },
      });
    }
    const requested = coverage.requested.from;
    if (
      coverage.requestedFromBeforeCoverage === true &&
      typeof requested === "string" &&
      !Number.isNaN(Date.parse(requested)) &&
      (requestedFrom === null ||
        Date.parse(requested) < Date.parse(requestedFrom))
    ) {
      requestedFrom = requested;
    }
  }
  if (known) {
    const sources = [...latest.values()].map(({ source }) => source);
    const numbers = sharedLabelNumbers(
      sources.map(({ sourceId, label }) => ({ id: sourceId, label })),
    );
    return {
      status: "known",
      sources: sources.map(({ number: _number, ...source }, index) => ({
        ...source,
        ...(numbers[index] !== undefined && { number: numbers[index] }),
      })),
      requestedFrom,
    };
  }
  return unknown ? { status: "unknown" } : null;
}
