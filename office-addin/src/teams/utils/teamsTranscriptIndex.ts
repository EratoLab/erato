/**
 * The machine-readable half of a Teams transcript: what the prose leaves out
 * because the model has no use for it — ids, deep links, the file ↔ message
 * join — carried in one trailing HTML comment.
 *
 * It rides inside the transcript rather than in a side channel so the two
 * cannot drift apart: one artifact, one lifecycle, one privacy surface, and a
 * snapshot that still says what it was a snapshot of. The backend strips the
 * comment out of the extracted text, so nothing here reaches the model.
 *
 * An HTML comment rather than front matter: markdown renderers hide it, and it
 * introduces no bare `---` for the backend's own file wrapper to collide with.
 *
 * It is a complete render source on purpose — a reader of the transcript never
 * has to parse the prose to rebuild the conversation. The message text is
 * therefore stored twice, which costs bytes in a file the model never reads.
 */

import type {
  TeamsConversationRef,
  TeamsMessageRef,
} from "./teamsConversationRef";

export const TEAMS_TRANSCRIPT_INDEX_MARKER = "erato:teams-transcript";
export const TEAMS_TRANSCRIPT_INDEX_VERSION = 1;

/** ISO bounds of what actually landed in a section. */
export interface TeamsTranscriptIndexWindow {
  from: string | null;
  to: string | null;
}

export interface TeamsTranscriptIndexSection {
  kind: "chat" | "channel";
  ref: TeamsConversationRef;
  /** Chat title, or the channel's own name — `teamName` renders beside it. */
  title: string;
  teamName: string | null;
  selection: "whole-chat" | "messages";
  /** Requested window of a whole-conversation ingest; null for a pick. */
  limit: number | null;
  truncated: boolean;
  skippedCount: number;
  window: TeamsTranscriptIndexWindow;
  participants: string[];
  /** The signed-in user, as the member roster spells them. */
  viewer: string | null;
}

export interface TeamsTranscriptIndexMessage {
  /** The `[n]` the prose cites this message by. */
  ordinal: number;
  /** Position in `sections`. */
  section: number;
  ref: TeamsMessageRef;
  sender: string;
  createdAt: string | null;
  editedAt: string | null;
  subject: string | null;
  deepLink: string;
  /** The body as the prose renders it, attachment markers included. */
  text: string;
  /** Filenames of the uploads this message carries, in marker order. */
  assets: string[];
}

export interface TeamsTranscriptIndex {
  version: number;
  exportedAt: string;
  /** IANA zone the prose rendered its dates in. */
  timeZone: string;
  sections: TeamsTranscriptIndexSection[];
  messages: TeamsTranscriptIndexMessage[];
}

const INDEX_BLOCK = /<!--\s*erato:teams-transcript\s+v\d+\s+([\s\S]*?)-->/g;

/** The single line appended to the transcript. */
export function serializeTeamsTranscriptIndex(
  index: TeamsTranscriptIndex,
): string {
  const payload = escapeCommentEnd(JSON.stringify(index));
  return `<!-- ${TEAMS_TRANSCRIPT_INDEX_MARKER} v${index.version} ${payload} -->`;
}

/**
 * Null for anything but an intact block of a version this build understands.
 * A half-recovered index is worse than none: every reader of it would have to
 * carry its own story for the parts that are missing.
 */
export function parseTeamsTranscriptIndex(
  fileText: string,
): TeamsTranscriptIndex | null {
  const matches = [...fileText.matchAll(INDEX_BLOCK)];
  const payload = matches.at(-1)?.[1];
  if (payload === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
  return toIndex(parsed);
}

/**
 * `-->` inside the payload would end the comment early. Escaping the first `-`
 * of every pair as a JSON escape keeps the parsed string byte-identical, so
 * message text survives the round trip untouched.
 */
function escapeCommentEnd(json: string): string {
  return json.replace(/-(?=-)/g, "\\u002d");
}

function toIndex(value: unknown): TeamsTranscriptIndex | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.version !== TEAMS_TRANSCRIPT_INDEX_VERSION) return null;
  const exportedAt = asString(record.exportedAt);
  const timeZone = asString(record.timeZone);
  const sections = mapAll(record.sections, toSection);
  const messages = mapAll(record.messages, toMessage);
  if (exportedAt === null || timeZone === null) return null;
  if (sections === null || messages === null) return null;
  if (messages.some((message) => sections[message.section] === undefined)) {
    return null;
  }
  return {
    version: TEAMS_TRANSCRIPT_INDEX_VERSION,
    exportedAt,
    timeZone,
    sections,
    messages,
  };
}

function toSection(value: unknown): TeamsTranscriptIndexSection | null {
  const record = asRecord(value);
  if (!record) return null;
  const kind = record.kind;
  const selection = record.selection;
  if (kind !== "chat" && kind !== "channel") return null;
  if (selection !== "whole-chat" && selection !== "messages") return null;
  const ref = toConversationRef(record.ref);
  const title = asString(record.title);
  const truncated = asBoolean(record.truncated);
  const skippedCount = asNumber(record.skippedCount);
  const window = asRecord(record.window);
  const participants = mapAll(record.participants, asString);
  if (ref === null || title === null || window === null) return null;
  if (truncated === null || skippedCount === null) return null;
  if (participants === null) return null;
  return {
    kind,
    ref,
    title,
    teamName: asString(record.teamName),
    selection,
    limit: asNumber(record.limit),
    truncated,
    skippedCount,
    window: {
      from: asString(window.from),
      to: asString(window.to),
    },
    participants,
    viewer: asString(record.viewer),
  };
}

function toMessage(value: unknown): TeamsTranscriptIndexMessage | null {
  const record = asRecord(value);
  if (!record) return null;
  const ordinal = asNumber(record.ordinal);
  const section = asNumber(record.section);
  const ref = toMessageRef(record.ref);
  const sender = asString(record.sender);
  const deepLink = asString(record.deepLink);
  const text = asString(record.text);
  const assets = mapAll(record.assets, asString);
  if (ordinal === null || section === null || ref === null) return null;
  if (sender === null || deepLink === null || text === null) return null;
  if (assets === null) return null;
  return {
    ordinal,
    section,
    ref,
    sender,
    createdAt: asString(record.createdAt),
    editedAt: asString(record.editedAt),
    subject: asString(record.subject),
    deepLink,
    text,
    assets,
  };
}

function toConversationRef(value: unknown): TeamsConversationRef | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.kind === "chat") {
    const chatId = asString(record.chatId);
    return chatId === null ? null : { kind: "chat", chatId };
  }
  if (record.kind === "channel") {
    const teamId = asString(record.teamId);
    const channelId = asString(record.channelId);
    if (teamId === null || channelId === null) return null;
    return { kind: "channel", teamId, channelId };
  }
  return null;
}

function toMessageRef(value: unknown): TeamsMessageRef | null {
  const record = asRecord(value);
  if (!record) return null;
  const conversation = toConversationRef(record.conversation);
  const messageId = asString(record.messageId);
  if (conversation === null || messageId === null) return null;
  return {
    conversation,
    messageId,
    parentMessageId: asString(record.parentMessageId),
  };
}

/** All-or-nothing: one unreadable entry invalidates the block. */
function mapAll<T>(
  value: unknown,
  read: (entry: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const mapped: T[] = [];
  for (const entry of value) {
    const item = read(entry);
    if (item === null) return null;
    mapped.push(item);
  }
  return mapped;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
