import { describe, expect, it } from "vitest";

import {
  TEAMS_TRANSCRIPT_INDEX_MARKER,
  TEAMS_TRANSCRIPT_INDEX_VERSION,
  parseTeamsTranscriptIndex,
} from "./teamsTranscriptIndex";

import type { TeamsTranscriptIndex } from "./teamsTranscriptIndex";

const conversation = { kind: "chat", chatId: "19:chat" } as const;

function index(
  overrides: Partial<TeamsTranscriptIndex> = {},
): TeamsTranscriptIndex {
  const base: TeamsTranscriptIndex = {
    version: TEAMS_TRANSCRIPT_INDEX_VERSION,
    exportedAt: "2026-03-02T00:00:00Z",
    timeZone: "UTC",
    sections: [
      {
        kind: "chat",
        ref: conversation,
        title: "Product sync",
        teamName: null,
        selection: "whole-chat",
        limit: 200,
        truncated: false,
        skippedCount: 0,
        window: { from: null, to: null },
        participants: ["Ada Lovelace"],
        viewer: null,
      },
    ],
    messages: [
      {
        ordinal: 1,
        section: 0,
        ref: { conversation, messageId: "m1", parentMessageId: null },
        sender: "Ada Lovelace",
        createdAt: "2026-03-01T08:00:00Z",
        editedAt: null,
        subject: null,
        deepLink: "https://teams.microsoft.com/l/message/19:chat/m1",
        text: "Hello",
        assets: [],
      },
    ],
  };
  return { ...base, ...overrides };
}

/** As the add-in's serializer writes it: one space either side of the payload. */
function block(value: unknown, separator = " "): string {
  return `<!-- ${TEAMS_TRANSCRIPT_INDEX_MARKER} v${TEAMS_TRANSCRIPT_INDEX_VERSION}${separator}${JSON.stringify(value)} -->`;
}

describe("parseTeamsTranscriptIndex", () => {
  it("reads a block out of a transcript", () => {
    const parsed = parseTeamsTranscriptIndex(
      `# Teams chat: Product sync\n\nHello.\n\n${block(index())}\n`,
    );

    expect(parsed?.sections[0].title).toBe("Product sync");
    expect(parsed?.messages[0].sender).toBe("Ada Lovelace");
  });

  it("tolerates extra whitespace between the version and the payload", () => {
    expect(parseTeamsTranscriptIndex(block(index(), "  \n  "))).not.toBeNull();
  });

  it("takes the last block when a transcript carries more than one", () => {
    const first = block(index());
    const second = block(
      index({
        sections: [{ ...index().sections[0], title: "Design review" }],
      }),
    );

    expect(
      parseTeamsTranscriptIndex(`${first}\n\n${second}`)?.sections[0].title,
    ).toBe("Design review");
  });

  it("returns null rather than half an index", () => {
    expect(parseTeamsTranscriptIndex("no block here")).toBeNull();
    expect(
      parseTeamsTranscriptIndex('<!-- erato:teams-transcript v1 {"a": -->'),
    ).toBeNull();
    expect(parseTeamsTranscriptIndex(block(index({ version: 99 })))).toBeNull();
  });

  it("rejects a message that names a section the block does not have", () => {
    const orphaned = index();
    orphaned.messages[0].section = 3;

    expect(parseTeamsTranscriptIndex(block(orphaned))).toBeNull();
  });

  it(
    "settles promptly on a block that never closes",
    { timeout: 30_000 },
    () => {
      // Sized so the two implementations are unmistakable: the quadratic
      // pattern takes ~8s over this run, the linear one ~0ms. Shorter runs do
      // not separate them — 60k characters costs the bad version under 200ms,
      // which would sit comfortably inside any budget worth asserting.
      //
      // The explicit timeout matters: the regex is synchronous, so a regression
      // blocks the worker and would otherwise surface as a vitest timeout
      // rather than as this assertion.
      const nearMiss = `<!-- ${TEAMS_TRANSCRIPT_INDEX_MARKER} v1 ${" ".repeat(400_000)}`;
      const started = Date.now();

      expect(parseTeamsTranscriptIndex(nearMiss)).toBeNull();
      expect(Date.now() - started).toBeLessThan(1_000);
    },
  );
});
