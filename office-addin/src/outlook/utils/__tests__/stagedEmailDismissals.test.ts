import { describe, expect, it } from "vitest";

import {
  dismissAttachment,
  dismissBody,
  getDismissals,
  restoreAttachment,
  restoreBody,
} from "../stagedEmailDismissals";

import type { StagedEmailDismissalsMap } from "../stagedEmailDismissals";

const KEY = "<msg-1@example.com>";

function empty(): StagedEmailDismissalsMap {
  return new Map();
}

describe("stagedEmailDismissals", () => {
  describe("getDismissals", () => {
    it("returns sentinel empty state for keys never touched", () => {
      const result = getDismissals(empty(), KEY);
      expect(result.bodyDismissed).toBe(false);
      expect(result.attachmentIds.size).toBe(0);
    });
  });

  describe("dismissBody / restoreBody", () => {
    it("marks the body dismissed and preserves any attachment dismissals", () => {
      const start = dismissAttachment(empty(), KEY, "att-0");
      const next = dismissBody(start, KEY);
      const view = getDismissals(next, KEY);
      expect(view.bodyDismissed).toBe(true);
      expect(view.attachmentIds.has("att-0")).toBe(true);
    });

    it("is a no-op when the body is already dismissed", () => {
      const start = dismissBody(empty(), KEY);
      const next = dismissBody(start, KEY);
      expect(next).toBe(start);
    });

    it("restores the body without dropping attachment dismissals", () => {
      const start = dismissBody(dismissAttachment(empty(), KEY, "att-0"), KEY);
      const next = restoreBody(start, KEY);
      const view = getDismissals(next, KEY);
      expect(view.bodyDismissed).toBe(false);
      expect(view.attachmentIds.has("att-0")).toBe(true);
    });

    it("drops the entry entirely when restoring body with no attachment dismissals", () => {
      const start = dismissBody(empty(), KEY);
      const next = restoreBody(start, KEY);
      // Empty map = no allocated state. Important so memory doesn't grow
      // across many opened/closed emails in a long session.
      expect(next.has(KEY)).toBe(false);
    });

    it("is a no-op when the body is not dismissed", () => {
      const start = empty();
      const next = restoreBody(start, KEY);
      expect(next).toBe(start);
    });
  });

  describe("dismissAttachment / restoreAttachment", () => {
    it("adds the attachment to the dismissal set", () => {
      const next = dismissAttachment(empty(), KEY, "att-0");
      expect(getDismissals(next, KEY).attachmentIds.has("att-0")).toBe(true);
    });

    it("is a no-op when the attachment is already dismissed", () => {
      const start = dismissAttachment(empty(), KEY, "att-0");
      const next = dismissAttachment(start, KEY, "att-0");
      expect(next).toBe(start);
    });

    it("preserves body dismissal when toggling attachments", () => {
      const start = dismissBody(empty(), KEY);
      const next = dismissAttachment(start, KEY, "att-1");
      const view = getDismissals(next, KEY);
      expect(view.bodyDismissed).toBe(true);
      expect(view.attachmentIds.has("att-1")).toBe(true);
    });

    it("drops the entry entirely when restoring the last attachment with no body dismissal", () => {
      const start = dismissAttachment(empty(), KEY, "att-0");
      const next = restoreAttachment(start, KEY, "att-0");
      expect(next.has(KEY)).toBe(false);
    });

    it("keeps the entry when restoring the last attachment but body is dismissed", () => {
      const start = dismissBody(dismissAttachment(empty(), KEY, "att-0"), KEY);
      const next = restoreAttachment(start, KEY, "att-0");
      const view = getDismissals(next, KEY);
      expect(view.bodyDismissed).toBe(true);
      expect(view.attachmentIds.size).toBe(0);
    });

    it("is a no-op when restoring an attachment that wasn't dismissed", () => {
      const start = dismissAttachment(empty(), KEY, "att-0");
      const next = restoreAttachment(start, KEY, "att-1");
      expect(next).toBe(start);
    });
  });

  describe("isolation between keys", () => {
    it("does not let one email's state bleed into another", () => {
      const a = "<a@host>";
      const b = "<b@host>";
      let state: StagedEmailDismissalsMap = empty();
      state = dismissAttachment(state, a, "shared-id");
      expect(getDismissals(state, b).attachmentIds.has("shared-id")).toBe(
        false,
      );
    });
  });
});
