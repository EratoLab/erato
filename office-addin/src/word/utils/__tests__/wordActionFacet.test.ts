import { describe, expect, it } from "vitest";

import {
  resolveWordActionFacet,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
} from "../wordActionFacet";

import type { WordDocumentArgs } from "../buildWordDocumentArgs";
import type { WordActionFacetInput } from "../wordActionFacet";

/** Arguments must match the configured facet: extra keys fail validation; missing values leave placeholders. */
const ALLOWED_ARGS: Record<string, string[]> = {
  [WORD_DOCUMENT_REVIEW_FACET_ID]: [
    "document_name",
    "document_text",
    "heading_outline",
    "paragraphs_sent",
    "paragraphs_total",
    "truncation_note",
    "document_identity",
  ],
  [WORD_COMPOSE_FACET_ID]: ["document_name", "document_identity"],
};

const documentArgs: WordDocumentArgs = {
  document_text: "[1] Revenue grew.",
  heading_outline: "",
  paragraphs_sent: "1",
  paragraphs_total: "1",
  truncation_note: "",
};

const bothAdvertised = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_COMPOSE_FACET_ID,
]);

const input = (
  overrides: Partial<WordActionFacetInput> = {},
): WordActionFacetInput => ({
  chipEnabled: true,
  documentName: "report.docx",
  documentIdentity: "https://contoso.sharepoint.com/report.docx",
  documentArgs,
  hasContent: true,
  availableFacetIds: bothAdvertised,
  ...overrides,
});

describe("resolveWordActionFacet", () => {
  it("attaches nothing when the chip is off", () => {
    expect(
      resolveWordActionFacet(input({ chipEnabled: false })),
    ).toBeUndefined();
  });

  it("attaches word_document_review for a document with content", () => {
    const facet = resolveWordActionFacet(input());

    expect(facet?.id).toBe(WORD_DOCUMENT_REVIEW_FACET_ID);
    expect(facet?.args).toEqual({
      document_name: "report.docx",
      document_text: "[1] Revenue grew.",
      heading_outline: "",
      paragraphs_sent: "1",
      paragraphs_total: "1",
      truncation_note: "",
      document_identity: "https://contoso.sharepoint.com/report.docx",
    });
  });

  it("attaches word_compose for an empty document", () => {
    const facet = resolveWordActionFacet(
      input({
        hasContent: false,
        documentArgs: { ...documentArgs, document_text: "" },
      }),
    );

    expect(facet?.id).toBe(WORD_COMPOSE_FACET_ID);
    expect(facet?.args).toEqual({
      document_name: "report.docx",
      document_identity: "https://contoso.sharepoint.com/report.docx",
    });
  });

  it("attaches nothing when the document could not be read", () => {
    expect(
      resolveWordActionFacet(input({ documentArgs: null })),
    ).toBeUndefined();
    expect(
      resolveWordActionFacet(input({ documentArgs: null, hasContent: false })),
    ).toBeUndefined();
  });

  it("never attaches a facet the backend does not advertise", () => {
    expect(
      resolveWordActionFacet(
        input({ availableFacetIds: new Set([WORD_COMPOSE_FACET_ID]) }),
      ),
    ).toBeUndefined();
    expect(
      resolveWordActionFacet(
        input({
          hasContent: false,
          availableFacetIds: new Set([WORD_DOCUMENT_REVIEW_FACET_ID]),
        }),
      ),
    ).toBeUndefined();
    expect(
      resolveWordActionFacet(input({ availableFacetIds: new Set() })),
    ).toBeUndefined();
  });

  it("emits exactly the keys ERMAIN-820 declares, empty where inapplicable", () => {
    for (const hasContent of [true, false]) {
      const facet = resolveWordActionFacet(input({ hasContent }));
      expect(facet).toBeDefined();
      const keys = Object.keys(facet?.args ?? {}).sort();
      expect(keys).toEqual([...ALLOWED_ARGS[facet?.id ?? ""]].sort());
      for (const value of Object.values(facet?.args ?? {})) {
        expect(typeof value).toBe("string");
      }
    }
  });

  it("carries the document on every send, with no fingerprint de-dup", () => {
    const first = resolveWordActionFacet(input());
    const second = resolveWordActionFacet(input());
    expect(first).toEqual(second);
    expect(second?.args?.document_text).toBe("[1] Revenue grew.");
  });
});
