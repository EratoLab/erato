import { describe, it, expect } from "vitest";

import {
  resolveOutlookActionFacet,
  type OutlookActionFacetInput,
} from "../outlookActionFacet";

const base: OutlookActionFacetInput = {
  hasActiveSelection: false,
  selectionData: "",
  selectionSource: "body",
  draftContextIncluded: false,
  draftBody: "",
  lastSentDraftBody: null,
  bodyFormat: undefined,
  isComposeMode: false,
  composeEmailAvailable: false,
  isReadMode: false,
  replyFromReadAvailable: false,
};

describe("resolveOutlookActionFacet", () => {
  it("returns no facet with nothing selected and no draft included", () => {
    expect(resolveOutlookActionFacet(base)).toEqual({
      facet: undefined,
      sentDraftBody: null,
    });
  });

  it("sends rewrite_selection when a selection is active — and it wins over the draft", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      hasActiveSelection: true,
      selectionData: "hello",
      selectionSource: "body",
      // A draft is also present, but the selection takes priority.
      draftContextIncluded: true,
      draftBody: "a whole draft",
      bodyFormat: "html",
    });

    expect(result.facet).toEqual({
      id: "outlook_rewrite_selection",
      args: {
        selected_text: "hello",
        source_property: "body",
        body_format: "html",
      },
    });
    // Selection sends never touch the draft dedup marker.
    expect(result.sentDraftBody).toBeNull();
  });

  it("omits body_format from rewrite args when the format is unknown", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      hasActiveSelection: true,
      selectionData: "x",
      selectionSource: "subject",
    });

    expect(result.facet?.args).toEqual({
      selected_text: "x",
      source_property: "subject",
    });
  });

  it("sends review_draft for an included, non-empty, changed draft", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "Dear Bob, ...",
      lastSentDraftBody: null,
    });

    expect(result.facet).toEqual({
      id: "outlook_review_draft",
      args: { full_body: "Dear Bob, ...", body_format: "text" },
    });
    expect(result.sentDraftBody).toBe("Dear Bob, ...");
  });

  it("does NOT send review_draft when the draft chip is dismissed (#1 toggle off)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: false,
      draftBody: "Dear Bob, ...",
    });

    expect(result).toEqual({ facet: undefined, sentDraftBody: null });
  });

  it("de-dupes: skips review_draft when the body is unchanged since the last send (#4)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "same body",
      lastSentDraftBody: "same body",
    });

    expect(result).toEqual({ facet: undefined, sentDraftBody: null });
  });

  it("re-sends review_draft after the draft body changes", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "edited body",
      lastSentDraftBody: "old body",
    });

    expect(result.facet?.id).toBe("outlook_review_draft");
    expect(result.sentDraftBody).toBe("edited body");
  });

  it("skips an empty draft body even when included", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "",
    });

    expect(result).toEqual({ facet: undefined, sentDraftBody: null });
  });

  it("sends compose_email for an empty compose draft when the facet is available", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      draftBody: "   ",
      bodyFormat: "html",
      composeEmailAvailable: true,
    });

    expect(result.facet?.id).toBe("compose_email");
    expect(result.facet?.args).toEqual({ body_format: "html" });
    expect(result.sentDraftBody).toBeNull();
  });

  it("defaults compose_email body_format to text when unknown", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      composeEmailAvailable: true,
    });

    expect(result.facet?.args).toEqual({ body_format: "text" });
  });

  it("does NOT send compose_email when the facet is unavailable (avoids a 400)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      composeEmailAvailable: false,
    });

    expect(result).toEqual({ facet: undefined, sentDraftBody: null });
  });

  it("prefers review_draft over compose_email once the draft has content", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      composeEmailAvailable: true,
      draftContextIncluded: true,
      draftBody: "an existing draft",
    });

    expect(result.facet?.id).toBe("outlook_review_draft");
  });

  it("prefers a selection over compose_email", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      composeEmailAvailable: true,
      hasActiveSelection: true,
      selectionData: "picked text",
    });

    expect(result.facet?.id).toBe("outlook_rewrite_selection");
  });

  it("sends outlook_reply_from_read in read mode when the facet is available", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isReadMode: true,
      replyFromReadAvailable: true,
    });

    expect(result.facet).toEqual({
      id: "outlook_reply_from_read",
      args: { body_format: "html" },
    });
    expect(result.sentDraftBody).toBeNull();
  });

  it("does NOT send outlook_reply_from_read when the facet is unavailable (avoids a 400)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isReadMode: true,
      replyFromReadAvailable: false,
    });

    expect(result).toEqual({ facet: undefined, sentDraftBody: null });
  });

  it("does NOT send outlook_reply_from_read outside read mode", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isReadMode: false,
      replyFromReadAvailable: true,
    });

    expect(result).toEqual({ facet: undefined, sentDraftBody: null });
  });
});
