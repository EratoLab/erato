import {
  TEAMS_TRANSCRIPT_INDEX_MARKER,
  TEAMS_TRANSCRIPT_INDEX_VERSION,
} from "@/utils/teams/teamsTranscriptIndex";

import type { TeamsConversationRef } from "@/utils/teams/teamsConversationRef";
import type {
  TeamsTranscriptIndex,
  TeamsTranscriptIndexMessage,
  TeamsTranscriptIndexSection,
} from "@/utils/teams/teamsTranscriptIndex";

export const TEAMS_CHAT_REF: TeamsConversationRef = {
  kind: "chat",
  chatId: "19:chat",
};

export function teamsSection(
  overrides: Partial<TeamsTranscriptIndexSection> = {},
): TeamsTranscriptIndexSection {
  return {
    kind: "chat",
    ref: TEAMS_CHAT_REF,
    title: "Product sync",
    teamName: null,
    selection: "whole-chat",
    limit: 200,
    truncated: false,
    skippedCount: 0,
    window: { from: "2026-03-01T08:00:00Z", to: "2026-03-03T09:14:00Z" },
    participants: ["Ada Lovelace"],
    viewer: null,
    ...overrides,
  };
}

export function teamsMessage(
  id: string,
  overrides: Partial<TeamsTranscriptIndexMessage> = {},
): TeamsTranscriptIndexMessage {
  return {
    ordinal: 1,
    section: 0,
    ref: { conversation: TEAMS_CHAT_REF, messageId: id, parentMessageId: null },
    sender: "Ada Lovelace",
    createdAt: "2026-03-01T08:00:00Z",
    editedAt: null,
    subject: null,
    deepLink: `https://teams.microsoft.com/l/message/19:chat/${id}`,
    text: "Can we move the sync to Thursday?",
    assets: [],
    ...overrides,
  };
}

/** Ordinals follow array order, as the serializer numbers them. */
export function teamsIndex(
  sections: TeamsTranscriptIndexSection[],
  messages: TeamsTranscriptIndexMessage[],
): TeamsTranscriptIndex {
  return {
    version: TEAMS_TRANSCRIPT_INDEX_VERSION,
    exportedAt: "2026-03-03T10:00:00Z",
    timeZone: "UTC",
    sections,
    messages: messages.map((message, position) => ({
      ...message,
      ordinal: position + 1,
    })),
  };
}

/** Prose plus the trailing index block, the way the picker writes a transcript. */
export function teamsTranscriptText(index: TeamsTranscriptIndex): string {
  const payload = JSON.stringify(index).replace(/-(?=-)/g, "\\u002d");
  return `# Teams chat\n\nProse the model reads.\n\n<!-- ${TEAMS_TRANSCRIPT_INDEX_MARKER} v${index.version} ${payload} -->\n`;
}

export function teamsTranscriptFile(
  index: TeamsTranscriptIndex,
  name = "teams-Product_sync.md",
): File {
  return textFile(teamsTranscriptText(index), name);
}

/** jsdom's `File` has no `text()`, which every browser this ships to does. */
export function textFile(content: string, name: string): File {
  const file = new File([content], name, { type: "text/plain" });
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(content),
  });
  return file;
}
