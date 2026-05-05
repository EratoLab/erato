import { describe, expect, it } from "vitest";

import { selectAddinSessionAction } from "../selectAction";

import type {
  AddinSessionPolicy,
  AddinSessionState,
  AddinSessionTrigger,
} from "../types";

interface DemoAnchor {
  thread: string;
  isCompose: boolean;
}

const strictEquals = (a: DemoAnchor | null, b: DemoAnchor | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.thread === b.thread &&
    a.isCompose === b.isCompose);

const composeInheritsEquals = (a: DemoAnchor | null, b: DemoAnchor | null) => {
  if (strictEquals(a, b)) return true;
  if (!a || !b) return false;
  // Compose-of-the-same-thread treated as equal to the read mail.
  return a.thread === b.thread;
};

const trigger = {
  cold: { kind: "cold-open" } as const,
  change: (
    previous: DemoAnchor | null,
    next: DemoAnchor | null,
  ): AddinSessionTrigger<DemoAnchor> => ({
    kind: "context-change",
    previous,
    next,
  }),
};

const policyOf = (mode: AddinSessionPolicy["mode"]): AddinSessionPolicy => ({
  mode,
});

describe("selectAddinSessionAction", () => {
  describe("mode: resume", () => {
    it("resumes saved chat when context matches", () => {
      const saved: AddinSessionState<DemoAnchor> = {
        chatId: "c1",
        anchor: { thread: "T1", isCompose: false },
      };
      const result = selectAddinSessionAction({
        trigger: trigger.cold,
        saved,
        currentAnchor: { thread: "T1", isCompose: false },
        policy: policyOf("resume"),
        anchorsEqual: strictEquals,
      });
      expect(result).toEqual({ kind: "resume", chatId: "c1" });
    });

    it("resumes saved chat even on context change", () => {
      const saved: AddinSessionState<DemoAnchor> = {
        chatId: "c1",
        anchor: { thread: "T1", isCompose: false },
      };
      const result = selectAddinSessionAction({
        trigger: trigger.change(saved.anchor, {
          thread: "T2",
          isCompose: false,
        }),
        saved,
        currentAnchor: { thread: "T2", isCompose: false },
        policy: policyOf("resume"),
        anchorsEqual: strictEquals,
      });
      expect(result).toEqual({ kind: "resume", chatId: "c1" });
    });

    it("starts new when nothing is saved", () => {
      const result = selectAddinSessionAction({
        trigger: trigger.cold,
        saved: { chatId: null, anchor: null },
        currentAnchor: { thread: "T1", isCompose: false },
        policy: policyOf("resume"),
        anchorsEqual: strictEquals,
      });
      expect(result).toEqual({ kind: "new" });
    });
  });

  describe("mode: new", () => {
    it("starts new on context change", () => {
      const saved: AddinSessionState<DemoAnchor> = {
        chatId: "c1",
        anchor: { thread: "T1", isCompose: false },
      };
      const result = selectAddinSessionAction({
        trigger: trigger.change(saved.anchor, {
          thread: "T2",
          isCompose: false,
        }),
        saved,
        currentAnchor: { thread: "T2", isCompose: false },
        policy: policyOf("new"),
        anchorsEqual: strictEquals,
      });
      expect(result).toEqual({ kind: "new" });
    });

    it("resumes when context matches (anchors equal short-circuits before mode)", () => {
      const saved: AddinSessionState<DemoAnchor> = {
        chatId: "c1",
        anchor: { thread: "T1", isCompose: false },
      };
      const result = selectAddinSessionAction({
        trigger: trigger.cold,
        saved,
        currentAnchor: { thread: "T1", isCompose: false },
        policy: policyOf("new"),
        anchorsEqual: strictEquals,
      });
      expect(result).toEqual({ kind: "resume", chatId: "c1" });
    });
  });

  describe("mode: ask", () => {
    it("asks on context change with prior chat", () => {
      const saved: AddinSessionState<DemoAnchor> = {
        chatId: "c1",
        anchor: { thread: "T1", isCompose: false },
      };
      const result = selectAddinSessionAction({
        trigger: trigger.change(saved.anchor, {
          thread: "T2",
          isCompose: false,
        }),
        saved,
        currentAnchor: { thread: "T2", isCompose: false },
        policy: policyOf("ask"),
        anchorsEqual: strictEquals,
      });
      expect(result).toEqual({ kind: "ask", suggestedChatId: "c1" });
    });

    it("starts new on context change with no prior chat", () => {
      const result = selectAddinSessionAction({
        trigger: trigger.cold,
        saved: { chatId: null, anchor: null },
        currentAnchor: { thread: "T1", isCompose: false },
        policy: policyOf("ask"),
        anchorsEqual: strictEquals,
      });
      expect(result).toEqual({ kind: "new" });
    });

    it("silently resumes when context matches", () => {
      const saved: AddinSessionState<DemoAnchor> = {
        chatId: "c1",
        anchor: { thread: "T1", isCompose: false },
      };
      const result = selectAddinSessionAction({
        trigger: trigger.cold,
        saved,
        currentAnchor: { thread: "T1", isCompose: false },
        policy: policyOf("ask"),
        anchorsEqual: strictEquals,
      });
      expect(result).toEqual({ kind: "resume", chatId: "c1" });
    });
  });

  describe("anchorsEqual hook (compose-inherits-from-read)", () => {
    it("resumes when caller's equality treats compose as same as read", () => {
      const saved: AddinSessionState<DemoAnchor> = {
        chatId: "c1",
        anchor: { thread: "T1", isCompose: false },
      };
      // With compose-inherits, switching to compose-of-same-thread is "same".
      const result = selectAddinSessionAction({
        trigger: trigger.change(saved.anchor, {
          thread: "T1",
          isCompose: true,
        }),
        saved,
        currentAnchor: { thread: "T1", isCompose: true },
        policy: policyOf("new"),
        anchorsEqual: composeInheritsEquals,
      });
      expect(result).toEqual({ kind: "resume", chatId: "c1" });
    });

    it("treats compose with different thread as a context change", () => {
      const saved: AddinSessionState<DemoAnchor> = {
        chatId: "c1",
        anchor: { thread: "T1", isCompose: false },
      };
      const result = selectAddinSessionAction({
        trigger: trigger.change(saved.anchor, {
          thread: "T2",
          isCompose: true,
        }),
        saved,
        currentAnchor: { thread: "T2", isCompose: true },
        policy: policyOf("ask"),
        anchorsEqual: composeInheritsEquals,
      });
      expect(result).toEqual({ kind: "ask", suggestedChatId: "c1" });
    });
  });
});
