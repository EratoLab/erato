import { describe, expect, it } from "vitest";

import { filterTeamsChats } from "../filterTeamsChats";

import type { ParsedTeamsChat } from "../parsedTeamsChat";

function chat(overrides: Partial<ParsedTeamsChat>): ParsedTeamsChat {
  return {
    chatId: "c1",
    title: "Untitled",
    participants: [],
    participantsTruncated: false,
    chatType: "group",
    previewText: null,
    lastActivityAt: null,
    ...overrides,
  } as ParsedTeamsChat;
}

const chats = [
  chat({
    chatId: "c1",
    title: "Maximilian Goisser",
    participants: ["Maximilian Goisser"],
  }),
  chat({
    chatId: "c2",
    title: "Product sync",
    participants: ["Ada Lovelace", "Alan Turing"],
  }),
  chat({ chatId: "c3", title: "Deploys", participants: ["Grace Hopper"] }),
];

describe("filterTeamsChats", () => {
  it("returns everything for a blank query", () => {
    expect(filterTeamsChats(chats, "   ")).toHaveLength(3);
  });

  it("matches on the chat title", () => {
    expect(filterTeamsChats(chats, "deploy").map((c) => c.chatId)).toEqual([
      "c3",
    ]);
  });

  it("matches on a participant the title never mentions", () => {
    expect(filterTeamsChats(chats, "turing").map((c) => c.chatId)).toEqual([
      "c2",
    ]);
  });

  it("matches tokens in any order, so partial names work", () => {
    expect(filterTeamsChats(chats, "gois max").map((c) => c.chatId)).toEqual([
      "c1",
    ]);
  });

  it("requires every token to match, not just one", () => {
    expect(filterTeamsChats(chats, "ada turing")).toHaveLength(1);
    expect(filterTeamsChats(chats, "ada hopper")).toHaveLength(0);
  });

  it("ignores case", () => {
    expect(filterTeamsChats(chats, "PRODUCT")).toHaveLength(1);
  });
});
