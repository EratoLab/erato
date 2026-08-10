import { describe, expect, it } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import {
  countSelectedMessages,
  groupSelectionsByConversation,
  teamsSelectionDedupeKey,
  teamsSelectionKey,
} from "../teamsChatSelection";
import { chatRef } from "../teamsConversationRef";

import type { TeamsChatSelection } from "../teamsChatSelection";

const OTHER_CHAT_ID = "19:def456@thread.v2";

const chat = (chatId = MOCK_CHAT_ID): TeamsChatSelection => ({
  kind: "conversation",
  ref: chatRef(chatId),
  title: "Product sync",
});

const message = (
  messageId: string,
  chatId = MOCK_CHAT_ID,
): TeamsChatSelection => ({
  kind: "message",
  ref: chatRef(chatId),
  messageId,
  conversationTitle: "Product sync",
  senderName: "Ada Lovelace",
  createdAt: "2026-03-03T09:14:00Z",
});

describe("teamsSelectionKey", () => {
  it("distinguishes a whole chat from a message inside it", () => {
    expect(teamsSelectionKey(chat())).toBe(`whole:chat:${MOCK_CHAT_ID}`);
    expect(teamsSelectionKey(message("m1"))).toBe(
      `msg:chat:${MOCK_CHAT_ID}:m1`,
    );
  });
});

describe("groupSelectionsByConversation", () => {
  it("collapses ticks from one chat into a single group", () => {
    expect(
      groupSelectionsByConversation([
        message("a"),
        message("b"),
        message("c", OTHER_CHAT_ID),
      ]),
    ).toEqual([
      {
        ref: chatRef(MOCK_CHAT_ID),
        title: "Product sync",
        whole: false,
        messageIds: ["a", "b"],
      },
      {
        ref: chatRef(OTHER_CHAT_ID),
        title: "Product sync",
        whole: false,
        messageIds: ["c"],
      },
    ]);
  });

  it("lets a whole-chat tick subsume individual ones regardless of order", () => {
    const messageFirst = groupSelectionsByConversation([message("a"), chat()]);
    const chatFirst = groupSelectionsByConversation([chat(), message("a")]);
    expect(messageFirst[0].whole).toBe(true);
    expect(chatFirst[0].whole).toBe(true);
  });
});

describe("teamsSelectionDedupeKey", () => {
  it("keys a whole chat on the requested window, not on what was fetched", () => {
    expect(teamsSelectionDedupeKey([chat()], 200)).toBe(
      `teams:chat:${MOCK_CHAT_ID}:all-200`,
    );
  });

  it("is stable across the order the user ticked things in", () => {
    const forwards = teamsSelectionDedupeKey([
      message("b"),
      message("a"),
      chat(OTHER_CHAT_ID),
    ]);
    const backwards = teamsSelectionDedupeKey([
      chat(OTHER_CHAT_ID),
      message("a"),
      message("b"),
    ]);
    expect(forwards).toBe(backwards);
    expect(forwards).toContain(`teams:chat:${MOCK_CHAT_ID}:a,b`);
  });

  it("separates a chat from a subset of its messages", () => {
    expect(teamsSelectionDedupeKey([chat()])).not.toBe(
      teamsSelectionDedupeKey([message("a")]),
    );
  });
});

describe("countSelectedMessages", () => {
  it("counts only individually ticked messages", () => {
    expect(countSelectedMessages([chat(), message("a"), message("b")])).toBe(2);
  });
});
