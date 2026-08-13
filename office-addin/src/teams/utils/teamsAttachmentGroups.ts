/**
 * Turns an attached Teams transcript back into the conversations it was built
 * from, as composer preview groups: one card per conversation, with the
 * transcript demoted to a single summary row inside it.
 *
 * Everything it renders comes out of the transcript's own index block, so the
 * preview describes the file that was actually uploaded rather than state kept
 * beside it — the same source every later reader of a transcript has.
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

import { conversationKey } from "./teamsConversationRef";

import type {
  TeamsTranscriptIndex,
  TeamsTranscriptIndexMessage,
  TeamsTranscriptIndexSection,
  TeamsTranscriptIndexWindow,
} from "./teamsTranscriptIndex";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
  FileUploadItem,
} from "@erato/frontend/library";

/**
 * What the composer needs to recognise a transcript it is already holding: the
 * uploaded filename — the same key the message markers name their assets by —
 * and the index read back out of the file.
 */
export interface TeamsAttachedTranscript {
  fileName: string;
  index: TeamsTranscriptIndex;
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
  if (!attached || attached.index.sections.length === 0) return null;

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

  const bySection = messagesBySection(attached.index.messages);

  const groups = attached.index.sections.map(
    (section, position): FileAttachmentGroup => {
      const key = conversationKey(section.ref);
      // Index order, not a re-sort: the rows then read in the order the
      // transcript itself does, which for a channel is thread by thread rather
      // than one interleaved timeline.
      const messages = bySection.get(position) ?? [];
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
            displayName: includedSummary(section, messages.length),
          },
          labelOverride: t({
            id: "officeAddin.teams.preview.transcriptLabel",
            message: "Teams conversation",
          }),
        },
      ];

      if (section.selection === "messages") {
        for (const message of messages) {
          items.push({
            kind: "threadMessageGroup",
            id: `${key}:${message.ref.messageId}`,
            label: message.sender,
            sublabel: messageSublabel(message),
            defaultCollapsed: false,
            attachments: claimAssets(message, claim).map((file) => ({
              id: file.id,
              file,
            })),
          });
        }
      } else {
        // The summary row stands for the messages; the files that rode along
        // with them still get a row each, so nothing is attached invisibly.
        for (const message of messages) {
          for (const file of claimAssets(message, claim)) {
            items.push({ kind: "attachment", id: file.id, file });
          }
        }
      }

      return {
        id: `teams:${key}`,
        label: sectionTitle(section),
        metaLabel: sectionMeta(section, messages.length),
        items,
        collapsible: true,
        defaultCollapsed: section.selection !== "messages",
      };
    },
  );

  return { groups, claimedFileIds };
}

function messagesBySection(
  messages: readonly TeamsTranscriptIndexMessage[],
): Map<number, TeamsTranscriptIndexMessage[]> {
  const bySection = new Map<number, TeamsTranscriptIndexMessage[]>();
  for (const message of messages) {
    const collected = bySection.get(message.section);
    if (collected) collected.push(message);
    else bySection.set(message.section, [message]);
  }
  return bySection;
}

function sectionTitle(section: TeamsTranscriptIndexSection): string {
  return section.teamName
    ? `${section.title} · ${section.teamName}`
    : section.title;
}

/** The header line: how much of the conversation this card stands for. */
function sectionMeta(
  section: TeamsTranscriptIndexSection,
  count: number,
): string {
  const countLabel = t({
    id: "officeAddin.teams.preview.messageCount",
    message: plural(count, { one: "# message", other: "# messages" }),
  });
  return [countLabel, dateRange(section.window)]
    .filter((part) => part.length > 0)
    .join(" · ");
}

/**
 * Mirrors the transcript's own "Included:" line, minus the date range the
 * group header already carries.
 */
function includedSummary(
  section: TeamsTranscriptIndexSection,
  count: number,
): string {
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
  if (section.skippedCount > 0) {
    parts.push(
      t({
        id: "officeAddin.teams.preview.skipped",
        message: plural(section.skippedCount, {
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

function messageSublabel(message: TeamsTranscriptIndexMessage): string {
  const when = toDate(message.createdAt);
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
function claimAssets(
  message: TeamsTranscriptIndexMessage,
  claim: (name: string) => FileUploadItem | null,
): FileUploadItem[] {
  const files: FileUploadItem[] = [];
  for (const name of message.assets) {
    const file = claim(name);
    if (file) files.push(file);
  }
  return files;
}

function dateRange(window: TeamsTranscriptIndexWindow): string {
  const from = formatDay(window.from);
  const to = formatDay(window.to);
  if (from === null || to === null) return "";
  return from === to ? from : `${from} – ${to}`;
}

function formatDay(iso: string | null): string | null {
  const date = toDate(iso);
  return date
    ? date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
