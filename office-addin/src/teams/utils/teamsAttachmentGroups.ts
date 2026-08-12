/**
 * Turns an attached Teams transcript back into the conversations it was built
 * from, as composer preview groups: one card per conversation, with the
 * transcript demoted to a single summary row inside it.
 *
 * One group per section, never one merged stream — a selection can span chats
 * and channels that share no timeline. A whole conversation stays a summary:
 * the default window is a few hundred messages, and that many cards in a task
 * pane is unusable. Hand-picked messages get a card each, because verifying
 * them one by one is exactly why the user picked them.
 *
 * Pure, and null whenever the structure is not fully available — a
 * half-rendered conversation is worse than the flat chips it replaces.
 */

import { plural, t } from "@lingui/core/macro";

import type { TeamsTranscriptSection } from "./buildTeamsTranscriptFile";
import type { ParsedTeamsMessage } from "./parsedTeamsChat";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
  FileUploadItem,
} from "@erato/frontend/library";

/**
 * What the composer needs to recognise a transcript it is already holding: the
 * uploaded filename — the same key the message markers name their assets by —
 * and the conversations behind it.
 */
export interface TeamsAttachedTranscript {
  fileName: string;
  sections: TeamsTranscriptSection[];
}

export interface TeamsAttachmentPreviewGroups {
  groups: FileAttachmentGroup[];
  /** Uploads the groups account for; the rest stay ordinary flat chips. */
  claimedFileIds: Set<string>;
}

export function buildTeamsAttachmentGroups(
  attached: TeamsAttachedTranscript | null,
  attachedFiles: readonly FileUploadItem[],
): TeamsAttachmentPreviewGroups | null {
  if (!attached || attached.sections.length === 0) return null;

  const uploadsByName = new Map<string, FileUploadItem>();
  for (const file of attachedFiles) {
    if (!uploadsByName.has(file.filename)) {
      uploadsByName.set(file.filename, file);
    }
  }
  const transcript = uploadsByName.get(attached.fileName);
  if (!transcript) return null;

  const claimedFileIds = new Set<string>([transcript.id]);
  /** Null once an upload has been placed, so it never gets a second row. */
  const claim = (name: string): FileUploadItem | null => {
    const file = uploadsByName.get(name);
    if (!file || claimedFileIds.has(file.id)) return null;
    claimedFileIds.add(file.id);
    return file;
  };

  const groups = attached.sections.map((section): FileAttachmentGroup => {
    const key = sectionKey(section);
    const items: FileAttachmentGroupItem[] = [
      {
        kind: "attachment",
        id: `${key}:transcript`,
        // One transcript covers every section, so it is named by what this
        // section contributes to it rather than by its filename. Removing the
        // row removes the file, which drops the whole preview back to chips.
        file: {
          id: transcript.id,
          filename: transcript.filename,
          displayName: includedSummary(section),
        },
        labelOverride: t({
          id: "officeAddin.teams.preview.transcriptLabel",
          message: "Teams conversation",
        }),
      },
    ];

    if (section.selection === "messages") {
      for (const message of oldestFirst(section.messages)) {
        items.push({
          kind: "threadMessageGroup",
          id: `${key}:${message.messageId}`,
          label: message.senderName,
          sublabel: messageSublabel(message),
          defaultCollapsed: false,
          attachments: messageAssetFiles(message, claim).map((file) => ({
            id: file.id,
            file,
          })),
        });
      }
    } else {
      // The summary row stands for the messages; the files that rode along
      // with them still get a row each, so nothing is attached invisibly.
      for (const message of section.messages) {
        for (const file of messageAssetFiles(message, claim)) {
          items.push({ kind: "attachment", id: file.id, file });
        }
      }
    }

    return {
      id: `teams:${key}`,
      label: sectionTitle(section),
      metaLabel: sectionMeta(section),
      items,
      collapsible: true,
      defaultCollapsed: section.selection !== "messages",
    };
  });

  return { groups, claimedFileIds };
}

function sectionKey(section: TeamsTranscriptSection): string {
  return section.kind === "chat"
    ? `chat:${section.chat.chatId}`
    : `channel:${section.channel.teamId}/${section.channel.channelId}`;
}

function sectionTitle(section: TeamsTranscriptSection): string {
  if (section.kind === "chat") return section.chat.title;
  const { name, teamName } = section.channel;
  return teamName ? `${name} · ${teamName}` : name;
}

/** The header line: how much of the conversation this card stands for. */
function sectionMeta(section: TeamsTranscriptSection): string {
  const count = section.messages.length;
  const countLabel = t({
    id: "officeAddin.teams.preview.messageCount",
    message: plural(count, { one: "# message", other: "# messages" }),
  });
  return [countLabel, dateRange(section.messages)]
    .filter((part) => part.length > 0)
    .join(" · ");
}

/**
 * Mirrors the transcript's own "Included:" line, minus the date range the
 * group header already carries.
 */
function includedSummary(section: TeamsTranscriptSection): string {
  const count = section.messages.length;
  const parts = [
    section.selection === "messages"
      ? t({
          id: "officeAddin.teams.preview.selectedMessages",
          message: plural(count, {
            one: "# selected message",
            other: "# selected messages",
          }),
        })
      : section.truncated
        ? t({
            id: "officeAddin.teams.preview.lastMessages",
            message: plural(count, {
              one: "Last # message — older messages not included",
              other: "Last # messages — older messages not included",
            }),
          })
        : t({
            id: "officeAddin.teams.preview.allMessages",
            message: plural(count, {
              one: "All # message",
              other: "All # messages",
            }),
          }),
  ];
  const skipped = section.skippedCount ?? 0;
  if (skipped > 0) {
    parts.push(
      t({
        id: "officeAddin.teams.preview.skipped",
        message: plural(skipped, {
          one: "# could not be loaded",
          other: "# could not be loaded",
        }),
      }),
    );
  }
  return parts.join(" · ");
}

/** Enough of a message to tell two from the same sender apart, no more. */
const EXCERPT_LENGTH = 100;

function messageSublabel(message: ParsedTeamsMessage): string {
  const when = message.createdAt ? toDate(message.createdAt) : null;
  return [
    when ? when.toLocaleString() : "",
    message.subject ?? "",
    excerpt(message.text),
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
}

/**
 * A card carrying only sender and timestamp is unreviewable: chat messages
 * rarely have a subject, so two messages from one person minutes apart read
 * identically — and reviewing the picked messages is the whole point of
 * showing them individually.
 */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH
    ? `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : flat;
}

/**
 * The uploads a message carries, joined by the filename the asset collector
 * stamped into its markers — the same key the backend keys parsed uploads by.
 */
function messageAssetFiles(
  message: ParsedTeamsMessage,
  claim: (name: string) => FileUploadItem | null,
): FileUploadItem[] {
  const stamp = /attached as ([^\]]+)\]/g;
  const files: FileUploadItem[] = [];
  for (const source of [message.text, ...message.markers]) {
    for (const match of source.matchAll(stamp)) {
      const file = claim(match[1].trim());
      if (file) files.push(file);
    }
  }
  return files;
}

/** Reads as a conversation; Graph hands chat messages back newest first. */
function oldestFirst(
  messages: readonly ParsedTeamsMessage[],
): ParsedTeamsMessage[] {
  return [...messages].sort((a, b) => createdAtMs(a) - createdAtMs(b));
}

function dateRange(messages: readonly ParsedTeamsMessage[]): string {
  const days = messages
    .map((message) => createdAtMs(message))
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  const oldest = days.at(0);
  const newest = days.at(-1);
  if (oldest === undefined || newest === undefined) return "";
  const from = formatDay(oldest);
  const to = formatDay(newest);
  return from === to ? from : `${from} – ${to}`;
}

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function createdAtMs(message: ParsedTeamsMessage): number {
  const date = message.createdAt ? toDate(message.createdAt) : null;
  return date ? date.getTime() : 0;
}

function toDate(iso: string): Date | null {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
