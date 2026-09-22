import { describe, expect, it } from "vitest";

import { CLIENT_ACTION_TOOL_NAME } from "../../../core/clientActions/proposedClientAction";
import { buildWordArtifact } from "../buildWordArtifact";

import type { WordDocumentCapture } from "../wordDocumentCapture";
import type { ContentPart } from "@erato/frontend/library";

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
    expect(artifact?.cardFenceLanguages).toHaveLength(3);
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
});
