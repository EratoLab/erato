/**
 * Turns fetched Teams messages into the single markdown `File` handed to the
 * composer's `onSelectFiles`. Pure and synchronous, so one call produces both
 * what is previewed and what is uploaded.
 *
 * Only what the model reads goes in: who said what, when, and the message
 * text. Message ids and Teams permalinks stay out — they exist for rendering
 * and back-linking, and everything that needs them reads the parsed sections
 * instead — so each message is cited by the ordinal in its heading.
 *
 * Formatting is fixed English/ISO rather than locale-dependent: the transcript
 * is read by the model, and a deterministic rendering is what makes it
 * testable.
 */

import { isRestrictedChannel } from "./parsedTeamsChannel";

import type { ParsedTeamsChannel } from "./parsedTeamsChannel";
import type { ParsedTeamsChat, ParsedTeamsMessage } from "./parsedTeamsChat";

interface TeamsTranscriptSectionBase {
  /**
   * Chat messages newest-first, as Graph returns them. Channel messages in any
   * order — rendering rebuilds their threads from `replyToId`.
   */
  messages: ParsedTeamsMessage[];
  selection: "whole-chat" | "messages";
  /** Requested window for a whole-conversation ingest. */
  limit?: number;
  /** Older history exists beyond what was fetched. */
  truncated?: boolean;
  /** Messages that could not be loaded — deleted, or the fetch failed. */
  skippedCount?: number;
}

/**
 * Chats and channels render differently on purpose: attaching a private
 * conversation and attaching a team-wide one are different acts, so the
 * heading says which one this is rather than leaving it to be inferred.
 */
export type TeamsTranscriptSection =
  | (TeamsTranscriptSectionBase & { kind: "chat"; chat: ParsedTeamsChat })
  | (TeamsTranscriptSectionBase & {
      kind: "channel";
      channel: ParsedTeamsChannel;
    });

export interface TeamsTranscriptInput {
  sections: TeamsTranscriptSection[];
  exportedAt?: Date;
  /** IANA zone for the rendered dates; defaults to UTC. */
  timeZone?: string;
}

const MAX_FILENAME_SLUG_LENGTH = 80;

/** Null when nothing renderable survived — an empty file is never uploaded. */
export function buildTeamsTranscriptFile(
  input: TeamsTranscriptInput,
): File | null {
  const markdown = buildTeamsTranscriptMarkdown(input);
  if (markdown === null) return null;
  // The `.md` name and the plain-text MIME serve different readers: the extension
  // gets the UI to render the transcript richly, while `text/plain` picks the
  // extractor that hands the model the bytes verbatim instead of reserialising
  // them through a markdown parser.
  return new File([markdown], buildTeamsTranscriptFilename(input.sections), {
    type: "text/plain",
  });
}

export function buildTeamsTranscriptFilename(
  sections: TeamsTranscriptSection[],
): string {
  if (sections.length > 1) return `teams-chats-${sections.length}.md`;
  const first = sections[0];
  const title = (
    first === undefined
      ? ""
      : first.kind === "chat"
        ? first.chat.title
        : first.channel.name
  ).trim();
  if (title.length === 0) return "teams-chat.md";
  const slug = title
    .replace(/[\\/:*?"<>|\s_-]+/g, "_")
    .slice(0, MAX_FILENAME_SLUG_LENGTH);
  return `teams-${slug}.md`;
}

export function buildTeamsTranscriptMarkdown(
  input: TeamsTranscriptInput,
): string | null {
  const timeZone = input.timeZone ?? "UTC";
  // Ordinals run across the whole transcript, not per section: a selection can
  // span several conversations, and a citation has to name exactly one message.
  const ordinals = { next: 1 };
  const rendered = input.sections
    .filter((section) => section.messages.length > 0)
    .map((section) => renderSection(section, input, timeZone, ordinals));
  if (rendered.length === 0) return null;
  return `${rendered.join("\n\n")}\n`;
}

function renderSection(
  section: TeamsTranscriptSection,
  input: TeamsTranscriptInput,
  timeZone: string,
  ordinals: { next: number },
): string {
  const lines: string[] = [];
  if (section.kind === "channel") {
    lines.push(
      `# Teams channel: ${section.channel.name} · ${section.channel.teamName}`,
    );
    if (isRestrictedChannel(section.channel)) {
      lines.push(
        `Audience: ${section.channel.membershipType} channel — not visible to the whole team.`,
      );
    }
  } else {
    lines.push(`# Teams chat: ${section.chat.title}`);
    if (section.chat.participants.length > 0) {
      const participants = section.chat.participants.join(", ");
      lines.push(
        `Participants: ${participants}${section.chat.participantsTruncated ? " (and possibly others)" : ""}`,
      );
    }
    // Without this the model cannot tell "you" from "them" in a 1:1. The name
    // comes from the member roster, so a channel — which has none — says
    // nothing rather than guessing, as does a chat whose roster never matched
    // the signed-in user.
    if (section.chat.selfDisplayName) {
      lines.push(
        `Viewer: ${section.chat.selfDisplayName} (the signed-in user).`,
      );
    }
  }
  lines.push(
    `Exported: ${formatDateTime(input.exportedAt ?? new Date(), timeZone)}`,
  );
  lines.push(includedLine(section, timeZone));

  let currentDay: string | null = null;
  const pushMessage = (
    message: ParsedTeamsMessage,
    dateLabel: string | null,
  ) => {
    const ordinal = ordinals.next;
    ordinals.next += 1;
    lines.push("", renderMessageHeading(message, ordinal, timeZone, dateLabel));
    if (message.text.length > 0) lines.push(message.text);
    for (const marker of message.markers) lines.push(marker);
  };

  if (section.kind === "channel") {
    // A channel is threads, not a timeline: a reply belongs under its root no
    // matter when it was written, so order is rebuilt from `replyToId` rather
    // than taken from the fetch. Day headings follow the thread openers and a
    // reply from another day carries its date inline, keeping the headings
    // chronological even when an old thread has fresh replies.
    for (const thread of orderChannelThreads(section.messages)) {
      const day = formatDate(thread[0].createdAt, timeZone);
      if (day !== currentDay) {
        currentDay = day;
        lines.push("", `## ${day}`);
      }
      for (const message of thread) {
        const messageDay = formatDate(message.createdAt, timeZone);
        pushMessage(message, messageDay === day ? null : messageDay);
      }
    }
    return lines.join("\n");
  }

  // Oldest first reads as a conversation; Graph hands them back newest first.
  const ordered = [...section.messages].reverse();
  for (const message of ordered) {
    const day = formatDate(message.createdAt, timeZone);
    if (day !== currentDay) {
      currentDay = day;
      lines.push("", `## ${day}`);
    }
    pushMessage(message, null);
  }
  return lines.join("\n");
}

/**
 * Thread blocks oldest-opener first: each root followed by its replies in
 * chronological order, and a reply whose root is not in the section standing
 * alone at its own timestamp.
 */
function orderChannelThreads(
  messages: readonly ParsedTeamsMessage[],
): ParsedTeamsMessage[][] {
  const roots = new Map<string, ParsedTeamsMessage>();
  for (const message of messages) {
    if (!message.replyToId) roots.set(message.messageId, message);
  }
  const replies = new Map<string, ParsedTeamsMessage[]>();
  const orphans: ParsedTeamsMessage[] = [];
  for (const message of messages) {
    if (!message.replyToId) continue;
    if (!roots.has(message.replyToId)) {
      orphans.push(message);
      continue;
    }
    const list = replies.get(message.replyToId);
    if (list) list.push(message);
    else replies.set(message.replyToId, [message]);
  }
  const threads: ParsedTeamsMessage[][] = [];
  for (const [rootId, root] of roots) {
    threads.push([root, ...(replies.get(rootId) ?? []).sort(byCreatedAsc)]);
  }
  for (const orphan of orphans) threads.push([orphan]);
  return threads.sort((a, b) => createdAtMs(a[0]) - createdAtMs(b[0]));
}

function createdAtMs(message: ParsedTeamsMessage): number {
  const parsed = Date.parse(message.createdAt ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function byCreatedAsc(a: ParsedTeamsMessage, b: ParsedTeamsMessage): number {
  return createdAtMs(a) - createdAtMs(b);
}

/**
 * `[7] Ada Lovelace (09:14, edited):` — the ordinal is the message's whole
 * address, so everything else in the parentheses is what a reader of the
 * conversation would ask for. Only the time is always there: the day comes
 * from the heading above, except for a channel reply that landed on a later
 * day than its thread.
 */
function renderMessageHeading(
  message: ParsedTeamsMessage,
  ordinal: number,
  timeZone: string,
  dateLabel: string | null,
): string {
  const time = formatTime(message.createdAt, timeZone);
  const meta = [dateLabel ? `${dateLabel}, ${time}` : time];
  if (message.editedAt) meta.push("edited");
  // Most chat messages carry no subject at all, so the label is emitted only
  // when there is one — an empty field on every heading would cost more tokens
  // than the subjects it exists to carry.
  if (message.subject) meta.push(`Subject: ${message.subject}`);
  return `[${ordinal}] ${message.senderName} (${meta.join(", ")}):`;
}

function includedLine(
  section: TeamsTranscriptSection,
  timeZone: string,
): string {
  const count = section.messages.length;
  const parts: string[] = [];
  if (section.selection === "messages") {
    parts.push(`Included: ${count} selected message${count === 1 ? "" : "s"}.`);
  } else {
    const oldest = formatDate(oldestCreatedAt(section.messages), timeZone);
    const newest = formatDate(newestCreatedAt(section.messages), timeZone);
    const window = oldest === newest ? oldest : `${oldest} – ${newest}`;
    parts.push(
      section.truncated
        ? `Included: last ${count} messages, ${window}. Older messages were not included.`
        : `Included: all ${count} messages, ${window}.`,
    );
  }
  if (section.skippedCount) {
    parts.push(
      `${section.skippedCount} message${section.skippedCount === 1 ? "" : "s"} could not be loaded.`,
    );
  }
  return parts.join(" ");
}

function oldestCreatedAt(messages: ParsedTeamsMessage[]): string | null {
  return pickCreatedAt(messages, (candidate, best) => candidate < best);
}

function newestCreatedAt(messages: ParsedTeamsMessage[]): string | null {
  return pickCreatedAt(messages, (candidate, best) => candidate > best);
}

function pickCreatedAt(
  messages: ParsedTeamsMessage[],
  isBetter: (candidate: number, best: number) => boolean,
): string | null {
  let best: string | null = null;
  let bestMs = 0;
  for (const message of messages) {
    if (!message.createdAt) continue;
    const parsed = Date.parse(message.createdAt);
    if (Number.isNaN(parsed)) continue;
    if (best === null || isBetter(parsed, bestMs)) {
      best = message.createdAt;
      bestMs = parsed;
    }
  }
  return best;
}

function formatDate(iso: string | null, timeZone: string): string {
  const date = toDate(iso);
  if (!date) return "unknown date";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(iso: string | null, timeZone: string): string {
  const date = toDate(iso);
  if (!date) return "unknown time";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function formatDateTime(date: Date, timeZone: string): string {
  return `${formatDate(date.toISOString(), timeZone)} ${formatTime(date.toISOString(), timeZone)} (${timeZone})`;
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
