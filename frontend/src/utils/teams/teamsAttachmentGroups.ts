/**
 * Turns a sent Teams transcript back into the conversations it was built from,
 * as attachment groups: one card per conversation, with the transcript demoted
 * to a single summary row inside it. (The composer shows a transcript as one
 * context chip instead; see `useTeamsTranscriptContextItems`.)
 *
 * Everything it renders comes out of the stored upload's own index block, so
 * every surface describes the file that was actually uploaded.
 *
 * One group per section, never one merged stream — a selection can span chats
 * and channels that share no timeline. A conversation stays a summary: the
 * default window is a few hundred messages, and that many cards in a task pane
 * is unusable.
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
  TeamsTranscriptIndexSection,
  TeamsTranscriptIndexWindow,
} from "./teamsTranscriptIndex";
import type { FileResource } from "@/components/ui/FileUpload/FilePreviewBase";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
} from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface TeamsAttachmentPreviewGroups {
  groups: FileAttachmentGroup[];
  /** Uploads the groups account for; the rest stay ordinary flat chips. */
  claimedFileIds: Set<string>;
}

interface CardSection {
  key: string;
  section: TeamsTranscriptIndexSection;
  messages: TeamsTranscriptIndexMessage[];
}

/**
 * A sent or generated message's grouping, for every attached transcript whose
 * stored index has been read (`indexes`, by file id). Opening a row hands the
 * transcript to the file preview, which renders it as the conversation.
 *
 * Null when none has: the caller then renders the attachments as it otherwise
 * would.
 */
export function buildTeamsMessageAttachmentGroups(
  files: readonly FileUploadItem[],
  indexes: ReadonlyMap<string, TeamsTranscriptIndex>,
): TeamsAttachmentPreviewGroups | null {
  const transcripts = files.flatMap((file) => {
    const index = indexes.get(file.id);
    return index && index.sections.length > 0 ? [{ file, index }] : [];
  });
  if (transcripts.length === 0) return null;

  const uploads = new UploadClaims(files);
  for (const { file } of transcripts) uploads.claimFile(file);

  const groups = transcripts.flatMap(({ file, index }) =>
    // A message can carry two transcripts of one conversation, so the upload
    // keeps their group ids apart.
    cardSections(
      index,
      (section) => `${file.id}:${conversationKey(section.ref)}`,
    ).map((card) =>
      buildGroup(card, {
        transcript: file,
        // The whole upload, so a row can show its thumbnail and open it.
        rowFile: (upload, displayName) => ({ ...upload, displayName }),
        uploads,
      }),
    ),
  );

  return { groups, claimedFileIds: uploads.claimed };
}

function cardSections(
  index: TeamsTranscriptIndex,
  key: (section: TeamsTranscriptIndexSection) => string,
): CardSection[] {
  const bySection = messagesBySection(index.messages);
  // Index order, not a re-sort: the rows then read in the order the transcript
  // itself does, which for a channel is thread by thread rather than one
  // interleaved timeline.
  return index.sections.map((section, position) => ({
    key: key(section),
    section,
    messages: bySection.get(position) ?? [],
  }));
}

/**
 * Uploads by the filename the asset collector stamped into the markers — the
 * same key the backend keys parsed uploads by — each placed at most once.
 */
export class UploadClaims {
  readonly claimed = new Set<string>();
  private readonly uploadsByName = new Map<string, FileUploadItem>();

  constructor(files: readonly FileUploadItem[]) {
    for (const file of files) {
      if (!this.uploadsByName.has(file.filename)) {
        this.uploadsByName.set(file.filename, file);
      }
    }
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
}

function buildGroup(
  { key, section, messages }: CardSection,
  { transcript, rowFile, uploads }: GroupOptions,
): FileAttachmentGroup {
  const items: FileAttachmentGroupItem[] = [
    {
      kind: "attachment",
      id: `${key}:transcript`,
      // One transcript covers every section, so it is named by what this
      // section contributes to it rather than by its filename. The preview
      // shows the file itself, and is titled by it.
      file: rowFile(transcript, includedSummary(section)),
      previewFile: transcript,
      labelOverride: t({
        id: "teams.preview.transcriptLabel",
        message: "Teams conversation",
      }),
    },
  ];

  // The summary row stands for the messages; the files that rode along with
  // them still get a row each, so nothing is attached invisibly.
  const assets = messages.flatMap((message) => message.assets);
  for (const claimed of claimAssets(assets, uploads)) {
    items.push({
      kind: "attachment",
      id: claimed.file.id,
      file: rowFile(claimed.file, assetDisplayName(claimed.asset)),
    });
  }

  return {
    id: `teams:${key}`,
    label: section.teamName
      ? `${section.title} · ${section.teamName}`
      : section.title,
    metaLabel: sectionMeta(section, messages.length),
    items,
    collapsible: true,
    // Only the transcript row opens the conversation, so it must not hide.
    defaultCollapsed: false,
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
function sectionMeta(
  section: TeamsTranscriptIndexSection,
  count: number,
): string {
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
function includedSummary(section: TeamsTranscriptIndexSection): string {
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
