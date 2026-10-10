import { describe, expect, it } from "vitest";

import {
  resolveWordActionFacet,
  resolveWordSelectionFacet,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
  wordSelectionFacetAvailable,
  wordSelectionTakesSlot,
} from "../wordActionFacet";
import { WORD_SELECTION_ARG_KEYS } from "../wordSelectionArgs";

import type { WordDocumentArgs } from "../buildWordDocumentArgs";
import type { WordActionFacetInput } from "../wordActionFacet";
import type { WordSelectionSnapshot } from "../wordSelectionAnchor";

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

describe("word_selection", () => {
  const selection: WordSelectionSnapshot = {
    role: "context_only",
    reasonCode: "shape_not_enabled",
    shape: "inline",
    story: "main",
    origin: "user",
    selectedText: "lima mike",
    truncated: false,
    paragraphCount: 1,
    paragraphs: [
      {
        id: "p1",
        text: "Kilo lima mike.",
        rangeText: "Kilo lima mike.",
        index: 0,
        styleName: "Normal",
        tableNestingLevel: 0,
      },
    ],
    startOffset: 5,
    endOffset: 14,
    occurrence: 0,
    anchor: null,
    contextBefore: "Kilo ",
    contextAfter: ".",
  };
  const advertised = new Set([WORD_SELECTION_FACET_ID]);
  const allArgs = new Map([
    [WORD_SELECTION_FACET_ID, new Set<string>(WORD_SELECTION_ARG_KEYS)],
  ]);
  const resolve = (
    overrides: Partial<Parameters<typeof resolveWordSelectionFacet>[0]> = {},
  ) =>
    resolveWordSelectionFacet({
      selection,
      documentName: "Plan.docx",
      documentIdentity: "doc-1",
      availableFacetIds: advertised,
      availableFacetArgs: allArgs,
      ...overrides,
    });

  it("is offered only when advertised with selected_text", () => {
    expect(wordSelectionFacetAvailable(advertised, allArgs)).toBe(true);
    expect(wordSelectionFacetAvailable(new Set(), allArgs)).toBe(false);
    expect(wordSelectionFacetAvailable(advertised, new Map())).toBe(false);
    expect(
      wordSelectionFacetAvailable(
        advertised,
        new Map([[WORD_SELECTION_FACET_ID, new Set(["document_name"])]]),
      ),
    ).toBe(false);
  });

  it.each([
    ["rewrite", false, true],
    ["rewrite", true, true],
    ["context_only", false, true],
    ["context_only", true, false],
  ] as const)(
    "a %s selection with the document included=%s takes the slot: %s",
    (role, documentIncluded, takes) => {
      expect(
        wordSelectionTakesSlot({ ...selection, role }, documentIncluded),
      ).toBe(takes);
    },
  );

  it("fills every advertised key and nothing else", () => {
    expect(resolve()).toEqual({
      id: WORD_SELECTION_FACET_ID,
      args: {
        document_name: "Plan.docx",
        document_identity: "doc-1",
        selected_text: "lima mike",
        selection_role: "context_only",
        context_reason: "shape_not_enabled",
        selection_shape: "inline",
        selection_story: "main",
        paragraph_count: "1",
        style_names: "Normal",
        context_before: "Kilo ",
        context_after: ".",
        truncated: "false",
        kept_items: "",
      },
    });
    expect(
      resolve({
        availableFacetArgs: new Map([
          [WORD_SELECTION_FACET_ID, new Set(["selected_text", "text_version"])],
        ]),
      }),
    ).toEqual({
      id: WORD_SELECTION_FACET_ID,
      args: { selected_text: "lima mike" },
    });
  });

  it("is not sent when the server does not advertise it", () => {
    expect(resolve({ availableFacetIds: new Set() })).toBeUndefined();
  });
});
