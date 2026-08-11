import { describe, expect, it } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import {
  countSelectedMessages,
  groupSelectionsByConversation,
  teamsSelectionDedupeKey,
  teamsSelectionKey,
} from "../teamsChatSelection";
import { channelRef, chatRef } from "../teamsConversationRef";

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
        messages: [
          { messageId: "a", parentMessageId: null, message: null },
          { messageId: "b", parentMessageId: null, message: null },
        ],
      },
      {
        ref: chatRef(OTHER_CHAT_ID),
        title: "Product sync",
        whole: false,
        messages: [{ messageId: "c", parentMessageId: null, message: null }],
      },
    ]);
  });

  it("carries a channel reply's thread root into the group", () => {
    const groups = groupSelectionsByConversation([
      {
        kind: "message",
        ref: channelRef("team-1", "chan-1"),
        messageId: "reply-1",
        parentMessageId: "root-1",
        conversationTitle: "Test Channel 1",
        senderName: "Max Token",
        createdAt: "2026-08-11T10:00:00Z",
      },
    ]);
    expect(groups[0].messages).toEqual([
      { messageId: "reply-1", parentMessageId: "root-1", message: null },
    ]);
  });

  it("carries an already-parsed body through to the group", () => {
    const body = {
      chatId: MOCK_CHAT_ID,
      messageId: "a",
      senderName: "Ada Lovelace",
      createdAt: "2026-03-03T09:14:00Z",
      editedAt: null,
      text: "already parsed",
      markers: [],
      sharedFiles: [],
      imageUrls: [],
      replyToId: null,
      deepLink: "https://example.invalid/a",
    };
    const groups = groupSelectionsByConversation([
      {
        kind: "message",
        ref: chatRef(MOCK_CHAT_ID),
        messageId: "a",
        conversationTitle: "Product sync",
        senderName: "Ada Lovelace",
        createdAt: "2026-03-03T09:14:00Z",
        message: body,
      },
    ]);
    expect(groups[0].messages[0].message).toBe(body);
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
