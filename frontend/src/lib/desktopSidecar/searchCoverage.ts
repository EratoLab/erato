import { SEARCH_SIDECAR_INDEX_TOOL } from "./chatTools";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type SearchCoverageSourceStatus =
  | "complete"
  | "indexing"
  | "newest_pending"
  | "unavailable";

/** One source of a `search_sidecar_index` result, as the model receives it. */
export interface SearchCoverageSource {
  label: string;
  kinds: string[];
  /** First covered instant, inclusive. Null while the source is unavailable. */
  from: string | null;
  /** Last covered instant, inclusive. */
  to: string | null;
  status: SearchCoverageSourceStatus;
  /** The sidecar's `unavailableReason`, only when `status` is unavailable. */
  reason?: string;
  partialCache: boolean;
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
  notice: string;
}

/** `result.coverage` of a `search_sidecar_index` tool result. */
export type SearchCoverage = KnownSearchCoverage | UnknownSearchCoverage;

export type LocalSearchCoverageSummary =
  | { status: "unknown" }
  | {
      status: "known";
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
      const previous = latest.get(source.label);
      if (!previous || Date.parse(coverage.asOf) >= Date.parse(previous.asOf)) {
        latest.set(source.label, { asOf: coverage.asOf, source });
      }
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
    return {
      status: "known",
      sources: [...latest.values()].map(({ source }) => source),
      requestedFrom,
    };
  }
  return unknown ? { status: "unknown" } : null;
}
