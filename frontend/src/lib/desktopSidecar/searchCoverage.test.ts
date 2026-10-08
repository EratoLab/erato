import { describe, expect, it } from "vitest";

import { summarizeLocalSearchCoverage } from "./searchCoverage";

import type {
  KnownSearchCoverage,
  SearchCoverageSource,
} from "./searchCoverage";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const outlook: SearchCoverageSource = {
  sourceId: "outlook-jane",
  label: "Outlook · jane@example.com",
  kinds: ["email", "file"],
  from: "2025-03-14T08:30:01Z",
  to: "2026-09-15T12:00:00Z",
  status: "indexing",
  partialCache: false,
  requestedFromBeforeCoverage: false,
};

const teams: SearchCoverageSource = {
  sourceId: "teams-contoso",
  label: "Teams · Contoso Ltd",
  kinds: ["teams_message"],
  from: "2026-06-02T09:15:00Z",
  to: "2026-09-15T11:40:00Z",
  status: "complete",
  partialCache: true,
  requestedFromBeforeCoverage: false,
};

function known(
  sources: SearchCoverageSource[],
  overrides: Partial<KnownSearchCoverage> = {},
): KnownSearchCoverage {
  return {
    v: 1,
    asOf: "2026-09-15T12:00:00Z",
    basis: "index",
    requested: { from: null, to: null },
    requestedFromBeforeCoverage: false,
    limitReached: false,
    sources,
    notice: "Local search on this device covered …",
    ...overrides,
  };
}

let callId = 0;
function searchPart(
  output: unknown,
  overrides: Record<string, unknown> = {},
): ContentPart {
  callId += 1;
  return {
    content_type: "tool_use",
    tool_call_id: `call-${callId}`,
    tool_name: "search_sidecar_index",
    status: "success",
    input: { text: "report" },
    output,
    ...overrides,
  } as unknown as ContentPart;
}

const success = (coverage: unknown) => ({
  status: "success",
  result: { hits: [], contentNotice: "…", coverage },
});

describe("summarizeLocalSearchCoverage", () => {
  it("renders nothing for messages without a reported search", () => {
    expect(summarizeLocalSearchCoverage([])).toBeNull();
    expect(
      summarizeLocalSearchCoverage([
        { content_type: "text", text: "Hello" },
        searchPart({ status: "success", result: { hits: [] } }),
      ]),
    ).toBeNull();
  });

  it("keeps the latest coverage per source, any flag and the earliest flagged start", () => {
    const summary = summarizeLocalSearchCoverage([
      searchPart(
        success(
          known(
            [
              { ...outlook, requestedFromBeforeCoverage: true },
              { ...teams, to: "2026-09-14T00:00:00Z" },
            ],
            {
              asOf: "2026-09-14T00:00:00Z",
              requested: { from: "2024-06-01T00:00:00Z", to: null },
              requestedFromBeforeCoverage: true,
            },
          ),
        ),
      ),
      searchPart(
        success(
          known([teams], {
            requested: { from: "2026-01-01T00:00:00Z", to: null },
            requestedFromBeforeCoverage: true,
          }),
        ),
      ),
      searchPart(
        success(
          known([outlook], {
            requested: { from: "2023-01-01T00:00:00Z", to: null },
          }),
        ),
      ),
    ]);
    expect(summary).toEqual({
      status: "known",
      sources: [{ ...outlook, requestedFromBeforeCoverage: true }, teams],
      requestedFrom: "2024-06-01T00:00:00Z",
    });
  });

  it("identifies sources by id and numbers shared labels across searches", () => {
    const contoso = (sourceId: string, number?: number) => ({
      ...teams,
      sourceId,
      ...(number !== undefined && { number }),
    });
    const summary = summarizeLocalSearchCoverage([
      searchPart(
        success(known([contoso("teams-a", 1), contoso("teams-b", 2)])),
      ),
      searchPart(success(known([contoso("teams-b")]))),
      searchPart(success(known([outlook]))),
    ]);
    expect(summary).toEqual({
      status: "known",
      sources: [
        contoso("teams-a", 1),
        contoso("teams-b", 2),
        outlook,
      ],
      requestedFrom: null,
    });
    expect(
      summarizeLocalSearchCoverage([
        searchPart(success(known([contoso("teams-a")]))),
        searchPart(success(known([contoso("teams-b")]))),
      ]),
    ).toMatchObject({
      sources: [contoso("teams-a", 1), contoso("teams-b", 2)],
    });
  });

  it("ignores failed, running, foreign and malformed parts", () => {
    const summary = summarizeLocalSearchCoverage([
      searchPart({ status: "error", error: "Index not initialized." }),
      searchPart(null, { status: "in_progress" }),
      searchPart(success(known([teams])), {
        tool_name: "read_sidecar_conversation",
      }),
      searchPart("not an object"),
      searchPart({ status: "success", result: "text" }),
      searchPart(success({ v: 2, sources: [] })),
      searchPart(success({ v: 1, asOf: "2026-09-15T12:00:00Z" })),
      searchPart(
        success(
          known([
            outlook,
            { ...teams, label: 7 } as unknown as SearchCoverageSource,
            { ...teams, sourceId: undefined } as unknown as SearchCoverageSource,
            { ...teams, from: "yesterday" },
          ]),
        ),
      ),
    ]);
    expect(summary).toEqual({
      status: "known",
      sources: [outlook],
      requestedFrom: null,
    });
  });

  it("reports an unknown period only when no search reported one", () => {
    const unknown = searchPart(
      success({ v: 1, status: "unknown", notice: "…" }),
    );
    expect(summarizeLocalSearchCoverage([unknown])).toEqual({
      status: "unknown",
    });
    expect(
      summarizeLocalSearchCoverage([
        unknown,
        searchPart(success(known([]))),
        unknown,
      ]),
    ).toEqual({ status: "known", sources: [], requestedFrom: null });
  });
});
