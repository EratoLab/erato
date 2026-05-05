import { describe, expect, it } from "vitest";

import { computeInitialLifecycle } from "../AddinChatProvider";

import type {
  OutlookSessionAnchor,
  OutlookSessionPreferences,
  OutlookSessionStorageValue,
} from "../../sessionPolicy";

const read = (conv: string | null): OutlookSessionAnchor => ({
  conversationId: conv,
  isCompose: false,
});

const compose = (conv: string | null): OutlookSessionAnchor => ({
  conversationId: conv,
  isCompose: true,
});

const session = (
  chatId: string | null,
  anchor: OutlookSessionAnchor | null = null,
): OutlookSessionStorageValue => ({ chatId, anchor });

const prefs = (
  mode: OutlookSessionPreferences["mode"],
  composeInheritsFromRead = true,
): OutlookSessionPreferences => ({ mode, composeInheritsFromRead });

describe("computeInitialLifecycle", () => {
  describe("non-Outlook host", () => {
    it("starts decided regardless of anchor or mode", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: false,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("ask"),
          liveAnchor: null,
        }),
      ).toEqual({ kind: "decided", chatId: "chat-A" });
    });
  });

  describe("Outlook + resume mode", () => {
    it("starts decided with the saved chatId, irrespective of anchor", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("resume"),
          liveAnchor: read("T2"),
        }),
      ).toEqual({ kind: "decided", chatId: "chat-A" });
    });

    it("starts decided with null when no chat is saved", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session(null, null),
          sessionPreferences: prefs("resume"),
          liveAnchor: read("T1"),
        }),
      ).toEqual({ kind: "decided", chatId: null });
    });
  });

  describe("Outlook + ask mode", () => {
    it("skips the gate when the saved anchor matches the live anchor", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("ask"),
          liveAnchor: read("T1"),
        }),
      ).toEqual({ kind: "decided", chatId: "chat-A" });
    });

    it("stays pending when the saved anchor differs from the live anchor", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("ask"),
          liveAnchor: read("T2"),
        }),
      ).toEqual({ kind: "pending" });
    });

    it("stays pending when no anchor was saved", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", null),
          sessionPreferences: prefs("ask"),
          liveAnchor: read("T1"),
        }),
      ).toEqual({ kind: "pending" });
    });

    it("stays pending when no live anchor is available (no item selected)", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("ask"),
          liveAnchor: null,
        }),
      ).toEqual({ kind: "pending" });
    });
  });

  describe("Outlook + new mode", () => {
    it("skips the gate when the saved anchor matches", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("new"),
          liveAnchor: read("T1"),
        }),
      ).toEqual({ kind: "decided", chatId: "chat-A" });
    });

    it("stays pending when anchors differ", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("new"),
          liveAnchor: read("T2"),
        }),
      ).toEqual({ kind: "pending" });
    });
  });

  describe("composeInheritsFromRead toggle", () => {
    it("treats read T1 and compose T1 as the same context when ON", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("ask", true),
          liveAnchor: compose("T1"),
        }),
      ).toEqual({ kind: "decided", chatId: "chat-A" });
    });

    it("treats read T1 and compose T1 as different contexts when OFF", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("ask", false),
          liveAnchor: compose("T1"),
        }),
      ).toEqual({ kind: "pending" });
    });

    it("treats brand-new compose (null thread) as a new context regardless of toggle", () => {
      expect(
        computeInitialLifecycle({
          isOutlook: true,
          session: session("chat-A", read("T1")),
          sessionPreferences: prefs("ask", true),
          liveAnchor: compose(null),
        }),
      ).toEqual({ kind: "pending" });
    });
  });
});
