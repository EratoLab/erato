import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  resolveWordActionFacet,
  resolveWordCommentThreadFacet,
  resolveWordSelectionFacet,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
  WORD_AUTHORING_FACET_ID,
  withWordReviewFallback,
  wordSelectionFacetAvailable,
} from "../wordActionFacet";
import { WORD_SELECTION_ARG_KEYS } from "../wordSelectionArgs";

import type {
  WordDocumentArgs,
  WordDocumentBuild,
} from "../buildWordDocumentArgs";
import type { WordActionFacetInput } from "../wordActionFacet";
import type { WordSelectionSnapshot } from "../wordSelectionAnchor";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

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

  it("adds comment_map only to a document facet that advertises it", () => {
    const map = '{"v":1,"scope":"document"}';
    const withMap = (facetId: string) =>
      new Map([
        [facetId, new Set([...(ALLOWED_ARGS[facetId] ?? []), "comment_map"])],
      ]);
    expect(
      resolveWordActionFacet(
        input({
          commentMap: map,
          availableFacetArgs: withMap(WORD_DOCUMENT_REVIEW_FACET_ID),
        }),
      )?.args?.comment_map,
    ).toBe(map);
    expect(
      resolveWordActionFacet(
        input({
          availableFacetArgs: withMap(WORD_DOCUMENT_REVIEW_FACET_ID),
        }),
      )?.args?.comment_map,
    ).toBe("");
    expect(
      resolveWordActionFacet(input({ commentMap: map }))?.args,
    ).not.toHaveProperty("comment_map");
    expect(
      resolveWordActionFacet(
        input({
          commentMap: map,
          availableFacetArgs: withMap(WORD_COMPOSE_FACET_ID),
        }),
      )?.args,
    ).not.toHaveProperty("comment_map");
    expect(
      resolveWordActionFacet(
        input({
          commentMap: map,
          authoring: { token: "snapshot-1" } as WordAuthoringSnapshot,
          availableFacetIds: new Set([WORD_AUTHORING_FACET_ID]),
          availableFacetArgs: withMap(WORD_AUTHORING_FACET_ID),
        }),
      )?.args?.comment_map,
    ).toBe(map);
    expect(
      resolveWordActionFacet(
        input({
          commentMap: map,
          authoring: { token: "snapshot-1" } as WordAuthoringSnapshot,
          availableFacetIds: new Set([WORD_AUTHORING_FACET_ID]),
          availableFacetArgs: withMap(WORD_DOCUMENT_REVIEW_FACET_ID),
        }),
      )?.args,
    ).not.toHaveProperty("comment_map");
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
        anchored_comments: "",
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

describe("word_comment_thread", () => {
  const resolve = (allowed: string[], ids = [WORD_COMMENT_THREAD_FACET_ID]) =>
    resolveWordCommentThreadFacet({
      documentName: "Plan.docx",
      documentIdentity: "doc-1",
      threadJson: '{"id":"t7k"}',
      commentsJson: '{"v":1}',
      availableFacetIds: new Set(ids),
      availableFacetArgs: new Map([
        [WORD_COMMENT_THREAD_FACET_ID, new Set(allowed)],
      ]),
    });

  it("carries the thread and its envelope, with advertised keys only", () => {
    expect(
      resolve([
        "document_name",
        "document_identity",
        "thread_json",
        "comments_json",
      ]),
    ).toEqual({
      id: WORD_COMMENT_THREAD_FACET_ID,
      args: {
        document_name: "Plan.docx",
        document_identity: "doc-1",
        thread_json: '{"id":"t7k"}',
        comments_json: '{"v":1}',
      },
    });
    expect(resolve(["thread_json", "comments_json"])?.args).toEqual({
      thread_json: '{"id":"t7k"}',
      comments_json: '{"v":1}',
    });
  });

  it("is not sent unless the facet takes both thread_json and comments_json", () => {
    expect(resolve(["thread_json"])).toBeUndefined();
    expect(resolve(["comments_json"])).toBeUndefined();
    expect(resolve(["thread_json", "comments_json"], [])).toBeUndefined();
  });
});

describe("withWordReviewFallback", () => {
  const build = (
    issue?: NonNullable<WordDocumentBuild["authoring"]>["issue"],
    hasContent = true,
  ): WordDocumentBuild =>
    ({
      args: documentArgs,
      coverage: { hasContent },
      authoring: { token: "t", issue },
    }) as unknown as WordDocumentBuild;
  const all = new Set([WORD_AUTHORING_FACET_ID, WORD_DOCUMENT_REVIEW_FACET_ID]);

  it.each(["too-large", "unavailable"] as const)(
    "sends review text when authoring is %s",
    (issue) => {
      expect(withWordReviewFallback(build(issue), all).authoring).toBe(
        undefined,
      );
    },
  );

  it.each([undefined, "tracking", "model-budget", "unsupported"] as const)(
    "keeps authoring when its issue is %s",
    (issue) => {
      const source = build(issue);
      expect(withWordReviewFallback(source, all)).toBe(source);
    },
  );

  it("keeps authoring when review is not advertised", () => {
    const source = build("too-large");
    expect(
      withWordReviewFallback(source, new Set([WORD_AUTHORING_FACET_ID])),
    ).toBe(source);
  });

  it("keeps authoring for an empty document", () => {
    const source = build("unavailable", false);
    expect(withWordReviewFallback(source, all)).toBe(source);
  });

  it("keeps authoring for a capture that is only too large for a complete read", () => {
    const source = {
      ...build(),
      authoring: { token: "t", completeReadIssue: "too-large" },
    } as unknown as WordDocumentBuild;
    expect(withWordReviewFallback(source, all)).toBe(source);
  });
});

describe("authoring arguments", () => {
  const authoring = (
    snapshot: Partial<WordAuthoringSnapshot>,
  ): WordAuthoringSnapshot =>
    ({ token: "snapshot-1", ...snapshot }) as WordAuthoringSnapshot;
  const args = (snapshot: Partial<WordAuthoringSnapshot>) =>
    resolveWordActionFacet(
      input({
        authoring: authoring(snapshot),
        availableFacetIds: new Set([WORD_AUTHORING_FACET_ID]),
      }),
    )?.args;

  it("reports an ordinary capture as available", () => {
    expect(args({})).toMatchObject({
      authoring_status: "available",
      paragraphs_sent: "0",
      document_text: "",
    });
  });

  it("tells the model that only scoped reads and edits work for a document too large for a complete read", () => {
    const sent = args({ completeReadIssue: "too-large" });
    expect(sent?.authoring_status).toMatch(
      /^available for scoped reads and scoped edits only\./,
    );
    expect(sent?.authoring_status).toContain(
      "whole-document plans and repairs are unavailable (too-large",
    );
    expect(sent?.authoring_status).toContain("16 targets and 24 KiB");
    expect(sent?.truncation_note).toContain("too large to read completely");
    expect(sent?.truncation_note).toContain("target.queries or table_cell");
    expect(sent?.document_text).toBe("");
  });

  it("keeps reporting a hard issue, even on a capture too large for a complete read", () => {
    expect(
      args({
        issue: "unsupported",
        issueDetails: ["unbalanced-fields"],
        completeReadIssue: "too-large",
      })?.authoring_status,
    ).toBe("unsupported (unbalanced-fields)");
  });
});
