/**
 * Turns a Teams transcript back into the conversations it was built from, as
 * attachment groups: one card per conversation, with the transcript demoted to
 * a single summary row inside it.
 *
 * Two sources describe a transcript. The composer reads the full index block
 * out of the `File` it is holding; a sent or generated message only has the
 * summary the backend derived from the same block at upload. Both become the
 * same cards, so a conversation looks alike wherever it is attached.
 *
 * One group per section, never one merged stream — a selection can span chats
 * and channels that share no timeline. A whole conversation stays a summary:
 * the default window is a few hundred messages, and that many cards in a task
 * pane is unusable. Hand-picked messages get a card each where the index is at
 * hand, because verifying them one by one is exactly why the user picked them.
 *
 * Pure, and null whenever the structure is not fully available — a
 * half-rendered conversation is worse than the flat chips it replaces.
 */

import { plural, t } from "@lingui/core/macro";

import { conversationKey } from "./teamsConversationRef";

import type {
  TeamsTranscriptIndex,
  TeamsTranscriptIndexAsset,
  TeamsTranscriptIndexMessage,
  TeamsTranscriptIndexWindow,
} from "./teamsTranscriptIndex";
import type { FileResource } from "@/components/ui/FileUpload/FilePreviewBase";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
} from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
import type {
  FileUploadItem,
  TeamsTranscriptSummary,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

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

/** One conversation as a card needs it, whichever source described it. */
interface CardSection {
  key: string;
  title: string;
  teamName: string | null;
  selection: "whole-chat" | "messages";
  truncated: boolean;
  skippedCount: number;
  window: TeamsTranscriptIndexWindow;
  messageCount: number;
  /** Hand-picked messages, a card each; only the full index carries them. */
  pickedMessages: TeamsTranscriptIndexMessage[] | null;
  assets: TeamsTranscriptIndexAsset[];
}

/** The composer's grouping, from the index block of the transcript it holds. */
export function buildTeamsAttachmentGroups(
  attached: TeamsAttachedTranscript | null,
  attachedFiles: readonly FileUploadItem[],
  /** Makes the summary row the way into the conversation it stands for. */
  onOpenSection?: (sectionIndex: number) => void,
): TeamsAttachmentPreviewGroups | null {
  if (!attached || attached.index.sections.length === 0) return null;

  const uploads = new UploadClaims(attachedFiles);
  const transcript = uploads.byName(attached.fileName);
  if (!transcript) return null;
  uploads.claimFile(transcript);

  const bySection = messagesBySection(attached.index.messages);
  const sections = attached.index.sections.map(
    (section, position): CardSection => {
      // Index order, not a re-sort: the rows then read in the order the
      // transcript itself does, which for a channel is thread by thread rather
      // than one interleaved timeline.
      const messages = bySection.get(position) ?? [];
      return {
        key: conversationKey(section.ref),
        title: section.title,
        teamName: section.teamName,
        selection: section.selection,
        truncated: section.truncated,
        skippedCount: section.skippedCount,
        window: section.window,
        messageCount: messages.length,
        pickedMessages: section.selection === "messages" ? messages : null,
        assets: messages.flatMap((message) => message.assets),
      };
    },
  );

  const groups = sections.map((section, position) =>
    buildGroup(section, {
      transcript,
      rowFile: (file, displayName) => ({
        id: file.id,
        filename: file.filename,
        displayName,
      }),
      uploads,
      onOpen: onOpenSection ? () => onOpenSection(position) : undefined,
      // The composer stays reachable below a whole conversation's files.
      defaultCollapsed: section.selection !== "messages",
    }),
  );

  return { groups, claimedFileIds: uploads.claimed };
}

/**
 * A message's grouping, from the summary the backend stored with each
 * transcript upload. Opening a row hands the transcript itself to the file
 * preview, which renders it as the conversation.
 *
 * Null when no file carries a summary: the caller then falls back to whatever
 * it renders otherwise.
 */
export function buildTeamsSummaryAttachmentGroups(
  files: readonly FileUploadItem[],
): TeamsAttachmentPreviewGroups | null {
  const transcripts = files.flatMap((file) => {
    const summary = file.teams_transcript;
    return summary && summary.sections.length > 0 ? [{ file, summary }] : [];
  });
  if (transcripts.length === 0) return null;

  const uploads = new UploadClaims(files);
  for (const { file } of transcripts) uploads.claimFile(file);

  const groups = transcripts.flatMap(({ file, summary }) =>
    summarySections(file, summary).map((section) =>
      buildGroup(section, {
        transcript: file,
        // The whole upload, so a row can show its thumbnail and open it.
        rowFile: (upload, displayName) => ({ ...upload, displayName }),
        uploads,
        // Only the transcript row opens the conversation, so it must not hide.
        defaultCollapsed: false,
      }),
    ),
  );

  return { groups, claimedFileIds: uploads.claimed };
}

function summarySections(
  file: FileUploadItem,
  summary: TeamsTranscriptSummary,
): CardSection[] {
  return summary.sections.map((section, position) => ({
    // A message can carry two transcripts of the same conversation, so the
    // upload, not the conversation, keeps the group ids apart.
    key: `${file.id}:${position}`,
    title: section.title,
    teamName: section.team_name ?? null,
    selection: section.selection,
    truncated: section.truncated,
    skippedCount: section.skipped_count,
    window: {
      from: section.window.from ?? null,
      to: section.window.to ?? null,
    },
    messageCount: section.message_count,
    pickedMessages: null,
    assets: section.assets.map((asset) => ({
      name: asset.name,
      displayName: asset.display_name ?? null,
      kind: asset.kind,
    })),
  }));
}

/**
 * Uploads by the filename the asset collector stamped into the markers — the
 * same key the backend keys parsed uploads by — each placed at most once.
 */
class UploadClaims {
  readonly claimed = new Set<string>();
  private readonly uploadsByName = new Map<string, FileUploadItem>();

  constructor(files: readonly FileUploadItem[]) {
    for (const file of files) {
      if (!this.uploadsByName.has(file.filename)) {
        this.uploadsByName.set(file.filename, file);
      }
    }
  }

  byName(name: string): FileUploadItem | undefined {
    return this.uploadsByName.get(name);
  }

  claimFile(file: FileUploadItem) {
    this.claimed.add(file.id);
  }

  /** Null once an upload has been placed, so it never gets a second row. */
  claim(name: string): FileUploadItem | null {
    const file = this.uploadsByName.get(name);
    if (!file || this.claimed.has(file.id)) return null;
    this.claimed.add(file.id);
    return file;
  }
}

interface GroupOptions {
  transcript: FileUploadItem;
  /** What a row shows for an upload, under a name fit for a reader. */
  rowFile: (file: FileUploadItem, displayName: string) => FileResource;
  uploads: UploadClaims;
  onOpen?: () => void;
  defaultCollapsed: boolean;
}

function buildGroup(
  section: CardSection,
  { transcript, rowFile, uploads, onOpen, defaultCollapsed }: GroupOptions,
): FileAttachmentGroup {
  const items: FileAttachmentGroupItem[] = [
    {
      kind: "attachment",
      id: `${section.key}:transcript`,
      // One transcript covers every section, so it is named by what this
      // section contributes to it rather than by its filename. Removing the
      // row removes the file, which drops the whole preview back to chips.
      file: rowFile(transcript, includedSummary(section)),
      labelOverride: t({
        id: "teams.preview.transcriptLabel",
        message: "Teams conversation",
      }),
      onOpen,
    },
  ];

  if (section.pickedMessages) {
    for (const message of section.pickedMessages) {
      items.push({
        kind: "threadMessageGroup",
        id: `${section.key}:${message.ref.messageId}`,
        label: message.sender,
        sublabel: messageSublabel(message),
        defaultCollapsed: false,
        attachments: claimAssets(message.assets, uploads).map((claimed) => ({
          id: claimed.file.id,
          file: rowFile(claimed.file, assetDisplayName(claimed.asset)),
        })),
      });
    }
  } else {
    // The summary row stands for the messages; the files that rode along
    // with them still get a row each, so nothing is attached invisibly.
    for (const claimed of claimAssets(section.assets, uploads)) {
      items.push({
        kind: "attachment",
        id: claimed.file.id,
        file: rowFile(claimed.file, assetDisplayName(claimed.asset)),
      });
    }
  }

  return {
    id: `teams:${section.key}`,
    label: section.teamName
      ? `${section.title} · ${section.teamName}`
      : section.title,
    metaLabel: sectionMeta(section),
    items,
    collapsible: true,
    defaultCollapsed,
  };
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

/** The header line: how much of the conversation this card stands for. */
function sectionMeta(section: CardSection): string {
  const count = section.messageCount;
  const countLabel = t({
    id: "teams.preview.messageCount",
    message: plural(count, { one: "# message", other: "# messages" }),
  });
  return [countLabel, dateRange(section.window)]
    .filter((part) => part.length > 0)
    .join(" · ");
}

/**
 * What the row stands for, never how much of it: the group header above it
 * already carries the message count and the date range, and a row that repeats
 * them says nothing while crowding out the part only it knows.
 *
 * A partial window is not called "recent": the desktop export centres it on a
 * search hit, so newer messages can be missing as well as older ones.
 */
function includedSummary(section: CardSection): string {
  const parts = [
    section.selection === "messages"
      ? t({
          id: "teams.preview.selectedMessages",
          message: "Selected messages",
        })
      : section.truncated
        ? t({
            id: "teams.preview.partialConversation",
            message: "Part of the conversation",
          })
        : t({
            id: "teams.preview.allMessages",
            message: "All messages",
          }),
  ];
  // Named, not `section.skippedCount`: the catalogues spell the placeholder
  // `{skipped}`, and a member expression would extract as `{0}`.
  const skipped = section.skippedCount;
  if (skipped > 0) {
    parts.push(
      t({
        id: "teams.preview.skipped",
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

interface ClaimedAsset {
  asset: TeamsTranscriptIndexAsset;
  file: FileUploadItem;
}

function claimAssets(
  assets: readonly TeamsTranscriptIndexAsset[],
  uploads: UploadClaims,
): ClaimedAsset[] {
  const claimed: ClaimedAsset[] = [];
  for (const asset of assets) {
    const file = uploads.claim(asset.name);
    if (file) claimed.push({ asset, file });
  }
  return claimed;
}

/**
 * The upload's own name is a content hash minted to join file to message; it
 * is not something to put in front of a user. The index carries the name Teams
 * gave the file, and a pasted image — which never had one — is simply an image.
 */
function assetDisplayName(asset: TeamsTranscriptIndexAsset): string {
  // Never the upload's filename: that is the minted name, and falling back to
  // it shows the content hash this whole indirection exists to hide.
  return (
    asset.displayName ??
    (asset.kind === "image"
      ? t({ id: "teams.preview.image", message: "Image" })
      : t({ id: "teams.preview.attachment", message: "Attachment" }))
  );
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
