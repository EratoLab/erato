import { describe, expect, it } from "vitest";

import { CLIENT_ACTION_TOOL_NAME } from "../../../core/clientActions/proposedClientAction";
import { examplePlan } from "../../../test/mocks/word/authoringFixtures";
import { buildWordArtifact } from "../buildWordArtifact";

import type { ContentPart } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

const capture: WordDocumentCapture = {
  identity: "https://contoso.sharepoint.com/report.docx",
  ordinalMap: new Map([[1, { uniqueLocalId: "id-1", text: "Alpha." }]]),
  paragraphsSent: 1,
  renderedOrdinals: new Set([1]),
  partialOrdinal: null,
};

const reviewInfo = {
  clientActions: ["word.apply_edits"],
  alwaysAskActions: [],
  presentation: "auto_prompt",
};

const proposal = (action: string): ContentPart[] =>
  [
    {
      content_type: "tool_use",
      tool_name: CLIENT_ACTION_TOOL_NAME,
      status: "success",
      input: { action },
    },
  ] as unknown as ContentPart[];

describe("buildWordArtifact", () => {
  it("stamps BOTH fence tags and a renderMode", () => {
    const artifact = buildWordArtifact({
      facetId: "word_document_review",
      clientActionInfo: reviewInfo,
      content: undefined,
      messageId: "m1",
      capture,
    });

    expect(artifact?.cardFenceLanguages).toEqual([
      "erato-word-edits",
      "erato-word-insert",
      "erato-word-document-plan",
      "erato-word-document-parts",
      "erato-word-replace",
      "erato-word-comments-add",
      "erato-word-comments-respond",
      "erato-word-comments-modify",
    ]);
    expect(artifact?.renderMode).toBe("suggestions");
  });

  it("never stamps bodyFormat, so no email-shaped path can engage", () => {
    const artifact = buildWordArtifact({
      facetId: "word_document_review",
      clientActionInfo: reviewInfo,
      content: undefined,
      messageId: "m1",
      capture,
    });

    expect(artifact).not.toHaveProperty("bodyFormat");
    expect(artifact).not.toHaveProperty("driftedEmailFenceTags");
  });

  it("carries the policy fields straight from GET /me/facets", () => {
    const artifact = buildWordArtifact({
      facetId: "word_document_review",
      clientActionInfo: {
        clientActions: ["word.apply_edits"],
        alwaysAskActions: ["word.apply_edits"],
        presentation: "auto_prompt",
      },
      content: undefined,
      messageId: "m1",
      capture,
    });

    expect(artifact?.clientActionPresentation).toBe("auto_prompt");
    expect(artifact?.alwaysAskClientActions).toEqual(["word.apply_edits"]);
    expect(artifact?.allowedClientActions).toEqual(["word.apply_edits"]);
  });

  it("stamps a validated proposal and nothing else", () => {
    expect(
      buildWordArtifact({
        facetId: "word_document_review",
        clientActionInfo: reviewInfo,
        content: proposal("word.apply_edits"),
        messageId: "m1",
        capture,
      })?.proposedClientAction,
    ).toBe("word.apply_edits");

    expect(
      buildWordArtifact({
        facetId: "word_document_review",
        clientActionInfo: reviewInfo,
        content: proposal("word.insert_at_cursor"),
        messageId: "m1",
        capture,
      })?.proposedClientAction,
    ).toBeUndefined();
  });

  it("stamps the send-time identity and freshness from the capture", () => {
    const artifact = buildWordArtifact({
      facetId: "word_document_review",
      clientActionInfo: reviewInfo,
      content: undefined,
      messageId: "m1",
      capture,
    });

    expect(artifact?.itemIdentity).toBe(capture.identity);
    expect(artifact?.isFreshCompletion).toBe(true);
  });

  it("stamps neither identity nor freshness for a message this pane never captured", () => {
    const artifact = buildWordArtifact({
      facetId: "word_document_review",
      clientActionInfo: reviewInfo,
      content: undefined,
      messageId: "m1",
      capture: undefined,
    });

    expect(artifact?.itemIdentity).toBeUndefined();
    expect(artifact?.isFreshCompletion).toBeUndefined();
    expect(artifact?.cardFenceLanguages).toHaveLength(8);
  });

  it("shows a change in parts from its accepted section plan until the finish", () => {
    const sectionPlan = {
      content_type: "tool_use",
      tool_call_id: "call-plan",
      tool_name: "plan_document_sections",
      status: "success",
      input: { snapshot: "s", readToken: "t", intent: "x", rows: [] },
      output: {
        status: "success",
        result: { draft_id: "draft", revision: 1, rows: [] },
      },
    } as unknown as ContentPart;
    const artifact = buildWordArtifact({
      facetId: "word_document_authoring",
      clientActionInfo: {
        clientActions: ["word.apply_document_plan"],
        alwaysAskActions: [],
      },
      content: [sectionPlan],
      messageId: "m1",
      capture,
    });
    expect(artifact?.submittedCard).toEqual({
      toolCallId: "call-plan",
      content: "call-plan",
      language: "erato-word-document-parts",
    });
    expect(artifact?.proposedClientAction).toBeUndefined();
    expect(
      buildWordArtifact({
        facetId: "word_document_review",
        clientActionInfo: reviewInfo,
        content: [sectionPlan],
        messageId: "m1",
        capture,
      })?.submittedCard,
    ).toBeUndefined();
  });

  it("shows the parts card from the section plan's first arguments while Erato writes it", () => {
    const writing = {
      content_type: "tool_use",
      tool_call_id: "call-plan",
      tool_name: "plan_document_sections",
      status: "preparing",
      input: '{"snapshot":"s","readToken":"t","intent":"Pla',
    } as unknown as ContentPart;
    const build = (generating: boolean) =>
      buildWordArtifact({
        facetId: "word_document_authoring",
        clientActionInfo: {
          clientActions: ["word.apply_document_plan"],
          alwaysAskActions: [],
        },
        content: [writing],
        messageId: "m1",
        capture,
        generating,
      })?.submittedCard;
    expect(build(true)).toEqual({
      toolCallId: "call-plan",
      content: "call-plan",
      language: "erato-word-document-parts",
      pending: true,
    });
    expect(build(false)).toBeUndefined();
  });

  it("returns nothing when the facet advertises no action this build implements", () => {
    expect(
      buildWordArtifact({
        facetId: "word_document_review",
        clientActionInfo: {
          clientActions: ["word.replace_selection"],
          alwaysAskActions: [],
        },
        content: undefined,
        messageId: "m1",
        capture,
      }),
    ).toBeUndefined();
  });

  it("returns nothing when the advertised action belongs to another facet", () => {
    expect(
      buildWordArtifact({
        facetId: "word_compose",
        clientActionInfo: reviewInfo,
        content: undefined,
        messageId: "m1",
        capture,
      }),
    ).toBeUndefined();
  });

  it("returns nothing without a facet or without client-action config", () => {
    expect(
      buildWordArtifact({
        facetId: undefined,
        clientActionInfo: reviewInfo,
        content: undefined,
        messageId: "m1",
        capture,
      }),
    ).toBeUndefined();
    expect(
      buildWordArtifact({
        facetId: "word_document_review",
        clientActionInfo: undefined,
        content: undefined,
        messageId: "m1",
        capture,
      }),
    ).toBeUndefined();
  });

  describe("comment changes", () => {
    const accepted = (action: string, draftId = "call-7"): ContentPart[] =>
      [
        {
          content_type: "tool_use",
          tool_name: "word_submit_comment_changes",
          tool_call_id: draftId,
          status: "success",
          input: { changes: [] },
          output: {
            status: "success",
            result: { draft_id: draftId, action, rows: 1 },
          },
        },
      ] as unknown as ContentPart[];
    const selectionInfo = (actions: string[]) => ({
      clientActions: actions,
      alwaysAskActions: [],
      presentation: "auto_prompt",
    });

    it("renders an accepted submission as its action's card, proposed for consent", () => {
      const artifact = buildWordArtifact({
        facetId: "word_selection",
        clientActionInfo: selectionInfo(["word.add_comments"]),
        content: accepted("word.add_comments"),
        messageId: "m1",
        capture,
      });
      expect(artifact).toMatchObject({
        submittedCard: {
          toolCallId: "call-7",
          content: "call-7",
          language: "erato-word-comments-add",
        },
        proposedClientAction: "word.add_comments",
      });
    });

    it("passes how far Always reaches per action", () => {
      const artifact = buildWordArtifact({
        facetId: "word_selection",
        clientActionInfo: {
          ...selectionInfo(["word.add_comments"]),
          grantScope: { "word.add_comments": "session_document" },
        },
        content: accepted("word.add_comments"),
        messageId: "m1",
        capture,
      });
      expect(artifact?.clientActionGrantScopes).toEqual({
        "word.add_comments": "session_document",
      });
    });

    it("shows accepted comment changes over a section plan that never finished", () => {
      const sectionPlan = {
        content_type: "tool_use",
        tool_call_id: "call-plan",
        tool_name: "plan_document_sections",
        status: "success",
        input: { snapshot: "s", readToken: "t", intent: "x", rows: [] },
        output: {
          status: "success",
          result: { draft_id: "draft", revision: 1, rows: [] },
        },
      } as unknown as ContentPart;
      const artifact = buildWordArtifact({
        facetId: "word_document_authoring",
        clientActionInfo: selectionInfo([
          "word.apply_document_plan",
          "word.add_comments",
        ]),
        content: [sectionPlan, ...accepted("word.add_comments")],
        messageId: "m1",
        capture,
      });
      expect(artifact).toMatchObject({
        submittedCard: {
          toolCallId: "call-7",
          language: "erato-word-comments-add",
        },
        proposedClientAction: "word.add_comments",
      });
    });

    it("ships dark: no card where the facet does not offer the action", () => {
      const artifact = buildWordArtifact({
        facetId: "word_selection",
        clientActionInfo: selectionInfo(["word.replace_selection"]),
        content: accepted("word.modify_comments"),
        messageId: "m1",
        capture,
      });
      expect(artifact?.submittedCard).toBeUndefined();
      expect(artifact?.proposedClientAction).toBeUndefined();
    });
  });
});

describe("an answer whose changes the server applied", () => {
  const plan = (id: string, _text: string) => ({
    ...examplePlan(`snap-${id}`),
    readToken: `read-${id}`,
  });
  const accepted = (id: string, text: string, chained: boolean) =>
    ({
      content_type: "tool_use",
      tool_call_id: id,
      tool_name: "submit_document_plan",
      status: "success",
      input: plan(id, text),
      output: {
        status: "success",
        submission: { status: "accepted" },
        result: {
          draft_id: id,
          snapshot: `snap-${id}`,
          action: "word.apply_document_plan",
        },
        ...(chained ? { apply: { call_id: `${id}.apply` } } : {}),
      },
    }) as unknown as ContentPart;
  const build = (content: ContentPart[]) =>
    buildWordArtifact({
      facetId: "word_document_authoring",
      clientActionInfo: {
        clientActions: ["word.apply_document_plan"],
        alwaysAskActions: [],
      },
      content,
      messageId: "m1",
      capture,
    });

  it("gives every applied change its own card, in call order", () => {
    const artifact = build([
      accepted("call-1", "First step.", true),
      accepted("call-2", "Second step.", true),
    ]);
    expect(artifact?.submittedCards?.map((card) => card.toolCallId)).toEqual([
      "call-1",
      "call-2",
    ]);
    expect(artifact?.submittedCards?.[1]).toMatchObject({
      language: "erato-word-document-plan",
      content: JSON.stringify(plan("call-2", "Second step.")),
    });
    expect(artifact?.submittedCard).toBeUndefined();
  });

  it("keeps today's one card when the server applied none", () => {
    const artifact = build([accepted("call-1", "Only step.", false)]);
    expect(artifact?.submittedCards).toBeUndefined();
    expect(artifact?.submittedCard).toMatchObject({ toolCallId: "call-1" });
  });
});
