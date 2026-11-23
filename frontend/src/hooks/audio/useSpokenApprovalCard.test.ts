import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import languageBase from "@/lib/generated/languageBase.json";
import data from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import { spokenApprovalFor } from "@/lib/toolCallGist/spokenCard";
import { messages as deMessages } from "@/locales/de/messages.json";

import { noteChangeSending, useApprovalChanges } from "./approvalChanges";
import { quietSpokenTurn, useSpeechPlayback } from "./speechPlayback";
import { resetSpokenLanguage, useSpokenLanguage } from "./spokenLanguage";
import { useSpokenApprovalCard } from "./useSpokenApprovalCard";

import type { VoiceChange } from "./approvalChanges";
import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SpokenApproval } from "@/lib/toolCallGist/spokenCard";
import type { Messages } from "@lingui/core";

const speakApprovalCard = vi.fn();
const offerApprovalCard = vi.fn();
const forgetApprovalCards = vi.fn();
const started = new Set<string>();

vi.mock("./approvalSpeech", () => ({
  approvalSpoken: (key: string) => started.has(key),
  speakApprovalCard: (card: { key: string }) => {
    started.add(card.key);
    speakApprovalCard(card);
  },
  offerApprovalCard: (card: { key: string }) => {
    started.add(card.key);
    offerApprovalCard(card);
  },
  forgetApprovalCards: (keys: readonly string[]) => forgetApprovalCards(keys),
}));

const POINTER: SpokenApproval = { type: "pointer" };

const props = (
  overrides: Partial<Parameters<typeof useSpokenApprovalCard>[0]> = {},
) => ({
  chatId: "chat-1",
  messageId: `message-${Math.random()}`,
  approvals: [POINTER],
  keys: ["stop-1:approval-a"],
  index: 0,
  active: true,
  responding: false,
  ...overrides,
});

const spokenKeys = () =>
  speakApprovalCard.mock.calls.map(([card]) => (card as { key: string }).key);

beforeEach(() => {
  speakApprovalCard.mockClear();
  offerApprovalCard.mockClear();
  forgetApprovalCards.mockClear();
  started.clear();
  resetSpokenLanguage();
  useSpeechPlayback.setState({
    conversational: true,
    enabled: true,
    playing: false,
    spokenTurn: "chat-1",
    quietTurn: undefined,
  });
});

describe("useSpokenApprovalCard", () => {
  it("speaks a card a spoken turn stopped on, once its words have played", () => {
    useSpeechPlayback.setState({ playing: true });
    const first = props({ responding: true });
    const { rerender } = renderHook((p) => useSpokenApprovalCard(p), {
      initialProps: first,
    });
    expect(speakApprovalCard).not.toHaveBeenCalled();
    rerender({ ...first, responding: false });
    expect(speakApprovalCard).not.toHaveBeenCalled();
    act(() => useSpeechPlayback.setState({ playing: false }));
    expect(speakApprovalCard).toHaveBeenCalledTimes(1);
    const card = speakApprovalCard.mock.calls[0][0] as {
      pieces: unknown;
      fallback: unknown;
    };
    expect(card.pieces).toEqual([
      {
        id: "pointer",
        role: "pointer",
        text: "A decision is waiting on screen.",
        mustSay: false,
        values: [],
      },
    ]);
    expect(card.fallback).toEqual(card.pieces);
    // Not again on a later render or a remount.
    rerender({ ...first, responding: false });
    renderHook(() => useSpokenApprovalCard({ ...first, responding: false }));
    expect(speakApprovalCard).toHaveBeenCalledTimes(1);
  });

  describe("ERMAIN-1326: the language the user spoke", () => {
    const spokenCard = (turn: string | undefined) => {
      useSpokenLanguage.setState({ turn });
      renderHook(() => useSpokenApprovalCard(props()));
      return speakApprovalCard.mock.calls.at(-1)?.[0] as {
        language: string;
        pieces: { text: string }[];
      };
    };

    const GERMAN_POINTER = "Auf dem Bildschirm wartet eine Entscheidung.";

    it("says the card in German to German speech under an English interface", async () => {
      const { i18n } = await import("@lingui/core");
      expect(i18n.locale).toBe("en");
      // Before the German catalog is there, the card is said in English.
      expect(spokenCard("de").language).toBe("en");
      i18n.load("de", deMessages as unknown as Messages);
      const card = spokenCard("de");
      expect(card.language).toBe("de");
      expect(card.pieces[0].text).toBe(GERMAN_POINTER);
      // The interface stays English.
      expect(i18n.locale).toBe("en");
    });

    it("says the card in English to English speech under a German interface", async () => {
      const { i18n } = await import("@lingui/core");
      const previous = i18n.locale;
      i18n.load("de", deMessages as unknown as Messages);
      i18n.activate("de");
      try {
        expect(spokenCard(undefined).pieces[0].text).toBe(GERMAN_POINTER);
        const card = spokenCard("en");
        expect(card.language).toBe("en");
        expect(card.pieces[0].text).toBe("A decision is waiting on screen.");
        expect(i18n.locale).toBe("de");
      } finally {
        i18n.activate(previous);
      }
    });

    it("says a card whole in the user's own language when the spoken one has no card words", () => {
      const card = spokenCard("hi");
      expect(card.language).toBe("en");
      expect(card.pieces[0].text).toBe("A decision is waiting on screen.");
    });
  });

  it("stays silent in a typed chat, without read-back, and for an old card", () => {
    useSpeechPlayback.setState({ spokenTurn: undefined });
    renderHook(() => useSpokenApprovalCard(props()));
    useSpeechPlayback.setState({ spokenTurn: "chat-1", enabled: false });
    renderHook(() => useSpokenApprovalCard(props()));
    useSpeechPlayback.setState({ enabled: true, conversational: false });
    renderHook(() => useSpokenApprovalCard(props()));
    useSpeechPlayback.setState({ conversational: true, spokenTurn: "chat-2" });
    renderHook(() => useSpokenApprovalCard(props()));
    expect(speakApprovalCard).not.toHaveBeenCalled();
  });

  it("1.1: speaks the next stop of the same message, after a decision", () => {
    const messageId = "message-1";
    const first = props({ messageId, keys: ["10:00:approval-a"] });
    const { rerender } = renderHook((p) => useSpokenApprovalCard(p), {
      initialProps: first,
    });
    // The decision: the first stop goes, the turn stops again in the same
    // message on the next call.
    rerender({ ...first, active: false });
    rerender({ ...first, keys: ["10:01:approval-b"] });
    expect(spokenKeys()).toEqual([
      "message-1:10:00:approval-a",
      "message-1:10:01:approval-b",
    ]);
  });

  it("speaks the next approval of a queue after a decision, then forgets the card", () => {
    const queue = props({
      approvals: [POINTER, POINTER, POINTER],
      keys: ["t:a", "t:b", "t:c"],
    });
    const { rerender } = renderHook((p) => useSpokenApprovalCard(p), {
      initialProps: queue,
    });
    rerender({ ...queue, index: 1 });
    expect(spokenKeys()).toEqual([
      `${queue.messageId}:t:a`,
      `${queue.messageId}:t:b`,
    ]);
    rerender({ ...queue, index: 1, active: false });
    expect(forgetApprovalCards).toHaveBeenCalledWith([
      `${queue.messageId}:t:a`,
      `${queue.messageId}:t:b`,
      `${queue.messageId}:t:c`,
    ]);
  });

  it("1.9: after Stop during the turn's words the card waits to be asked for", () => {
    useSpeechPlayback.setState({ playing: true });
    act(() => quietSpokenTurn());
    expect(useSpeechPlayback.getState().playing).toBe(false);
    renderHook(() => useSpokenApprovalCard(props()));
    expect(speakApprovalCard).not.toHaveBeenCalled();
    expect(offerApprovalCard).toHaveBeenCalledTimes(1);
  });

  describe("a card that corrects one changed by voice", () => {
    const { calls } = data as unknown as {
      calls: {
        id: string;
        tool_name: string;
        input: unknown;
        display: { title: string; server_name?: string; label?: unknown };
      }[];
    };
    const approval = (id: string): SpokenApproval => {
      const call = calls.find((entry) => entry.id === id);
      if (!call) throw new Error(id);
      return spokenApprovalFor("mcp_tool", {
        ...call,
        display: {
          ...call.display,
          label: call.display.label as ToolCallLabel,
        },
      });
    };
    const UPDATE = approval("update-01-date-and-probability");

    beforeEach(() => useApprovalChanges.setState({ records: {} }));

    const cardOf = (call: number) =>
      speakApprovalCard.mock.calls[call][0] as {
        pieces: { text: string }[];
        approval: SpokenApproval;
        change?: VoiceChange;
      };

    it("is said as the difference to the withdrawn card, which is taken once", () => {
      noteChangeSending({
        messageId: "message-1",
        approvalId: "call-1",
        approval: UPDATE,
        heard: [
          "what",
          "detail:Estimated close date",
          "detail:Probability",
          "request",
        ],
        words: "nimm 75",
      });
      const next = props({
        messageId: "message-1",
        approvals: [UPDATE],
        keys: ["t2:call-2"],
        items: [{ approvalId: "call-2", replaces: "call-1" }],
      });
      renderHook(() => useSpokenApprovalCard(next));
      const card = cardOf(0);
      expect(card.pieces[0].text).toMatch(
        /^The new card is the same as before: /,
      );
      expect(card.approval).toBe(UPDATE);
      expect(useApprovalChanges.getState().records).toEqual({});
    });

    it("without a withdrawn card, a replacement is said in full", () => {
      const next = props({
        approvals: [UPDATE],
        keys: ["t2:call-2"],
        items: [{ approvalId: "call-2", replaces: "call-1" }],
      });
      renderHook(() => useSpokenApprovalCard(next));
      expect(cardOf(0).pieces[0].text).toMatch(/^I'd like to /);
    });

    it("names the phrase only on a card in a language with a phrase of its own", async () => {
      const { i18n } = await import("@lingui/core");
      const previous = i18n.locale;
      const decide = () => ({
        approvalId: "call-1",
        send: () => Promise.resolve("sent" as const),
      });
      const card = () =>
        props({
          approvals: [UPDATE],
          keys: ["t:call-1"],
          items: [{ approvalId: "call-1", replaces: null }],
          decide,
          active: false,
        });
      const approves = () =>
        renderHook(() => useSpokenApprovalCard(card())).result.current.approves;
      try {
        expect(approves()).toBe(true);
        // French is said in full, but has no phrase: approved on screen.
        window.APPROVAL_SPEECH_WORDS = {
          ...languageBase.approval_speech_words,
          fr: { ...languageBase.approval_speech_words.en, locale: "fr-FR" },
        };
        i18n.loadAndActivate({ locale: "fr", messages: {} });
        expect(approves()).toBe(false);
        window.APPROVAL_VOICE_PHRASES = {
          ...languageBase.confirmation_phrases,
          fr: "Je confirme",
        };
        expect(approves()).toBe(true);
      } finally {
        window.APPROVAL_SPEECH_WORDS = undefined;
        window.APPROVAL_VOICE_PHRASES = undefined;
        i18n.activate(previous);
      }
    });

    it("hands the card how it is changed by voice, for its own approval", () => {
      const change = vi.fn(
        (approvalId: string): VoiceChange => ({
          approvalId,
          ready: () => true,
          send: () => Promise.resolve("sent"),
        }),
      );
      const queue = props({
        approvals: [UPDATE, UPDATE],
        keys: ["t:a", "t:b"],
        items: [
          { approvalId: "a", replaces: null },
          { approvalId: "b", replaces: null },
        ],
        change,
        index: 1,
      });
      renderHook(() => useSpokenApprovalCard(queue));
      expect(change).toHaveBeenCalledWith("b");
      expect(cardOf(0).change?.approvalId).toBe("b");
    });
  });
});
