/**
 * What a Teams transcript in the composer says about itself: the chip's text
 * and the detail's sections, read from the transcript's own index block and
 * the uploads the composer has staged for it.
 *
 * Pure. Dates follow the app's language, not the browser's, so a German user
 * on an English browser reads German dates beside German labels.
 */

import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";

import { conversationKey } from "./teamsConversationRef";

import type {
  TeamsTranscriptIndex,
  TeamsTranscriptIndexAsset,
  TeamsTranscriptIndexMessage,
  TeamsTranscriptIndexSection,
  TeamsTranscriptIndexWindow,
} from "./teamsTranscriptIndex";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface TeamsTranscriptChipText {
  label: string;
  meta: string;
  spokenLabel: string;
}

export const teamsTranscriptName = () =>
  t({ id: "teams.context.name", message: "Teams transcript" });

export const teamsConversationCount = (count: number) =>
  t({
    id: "teams.context.meta.conversations",
    message: plural(count, {
      one: "# conversation",
      other: "# conversations",
    }),
  });

const messageCount = (count: number) =>
  t({
    id: "teams.preview.messageCount",
    message: plural(count, { one: "# message", other: "# messages" }),
  });

/**
 * "Product sync +2 · 3 conversations · 240 messages". An index with no
 * sections is as unreadable as no index: there is nothing to name.
 */
export function teamsTranscriptChipText(
  index: TeamsTranscriptIndex | null,
  { reading }: { reading: boolean },
): TeamsTranscriptChipText {
  const spokenLabel = teamsTranscriptName();
  if (reading) {
    return {
      label: spokenLabel,
      meta: t({
        id: "teams.context.meta.reading",
        message: "Reading transcript…",
      }),
      spokenLabel,
    };
  }
  const first = index?.sections[0];
  if (!index || !first) {
    return {
      label: spokenLabel,
      meta: t({
        id: "teams.context.meta.unreadable",
        message: "Conversations can't be shown",
      }),
      spokenLabel,
    };
  }
  const title = first.title;
  const count = index.sections.length - 1;
  const label =
    count > 0
      ? t({ id: "teams.context.label.more", message: `${title} +${count}` })
      : title;
  return {
    label,
    meta: [
      teamsConversationCount(index.sections.length),
      messageCount(index.messages.length),
    ].join(" · "),
    spokenLabel,
  };
}

export interface TeamsTranscriptPickedMessage {
  key: string;
  sender: string;
  when: string;
  excerpt: string;
}

export interface TeamsTranscriptSectionFile {
  upload: FileUploadItem;
  /** As Teams named it; never the minted upload filename. */
  displayName: string;
  isImage: boolean;
}

export interface TeamsTranscriptSectionView {
  /** Position in the index, as `TeamsConversationView` takes it. */
  position: number;
  key: string;
  kind: TeamsTranscriptIndexSection["kind"];
  selection: TeamsTranscriptIndexSection["selection"];
  /** "Design review · Platform Team" */
  title: string;
  /** "120 messages · Oct 1, 2026 – Oct 14, 2026" */
  meta: string;
  /** "All messages · Chat" */
  selectionLine: string;
  /** Hand-picked messages only; a whole conversation is its summary. */
  picked: TeamsTranscriptPickedMessage[];
  /** Staged uploads the section's messages carried, each upload once. */
  files: TeamsTranscriptSectionFile[];
}

/**
 * One view per section in index order. `uploads` are the staged uploads the
 * transcript brought; an asset whose upload is not staged has no row.
 */
export function teamsTranscriptSections(
  index: TeamsTranscriptIndex,
  uploads: readonly FileUploadItem[],
): TeamsTranscriptSectionView[] {
  const uploadsByName = new Map<string, FileUploadItem>();
  for (const upload of uploads) {
    if (!uploadsByName.has(upload.filename)) {
      uploadsByName.set(upload.filename, upload);
    }
  }
  const placed = new Set<string>();
  const bySection = new Map<number, TeamsTranscriptIndexMessage[]>();
  for (const message of index.messages) {
    const collected = bySection.get(message.section);
    if (collected) collected.push(message);
    else bySection.set(message.section, [message]);
  }

  return index.sections.map((section, position) => {
    const messages = bySection.get(position) ?? [];
    const files: TeamsTranscriptSectionFile[] = [];
    for (const asset of messages.flatMap((message) => message.assets)) {
      const upload = uploadsByName.get(asset.name);
      if (!upload || placed.has(upload.id)) continue;
      placed.add(upload.id);
      files.push({
        upload,
        displayName: teamsAssetDisplayName(asset),
        isImage: asset.kind === "image",
      });
    }
    return {
      position,
      key: `${position}:${conversationKey(section.ref)}`,
      kind: section.kind,
      selection: section.selection,
      title: sectionTitle(section),
      meta: [messageCount(messages.length), dateRange(section.window)]
        .filter((part) => part.length > 0)
        .join(" · "),
      selectionLine: selectionLine(section),
      picked:
        section.selection === "messages"
          ? messages.map((message) => pickedMessage(message, section))
          : [],
      files,
    };
  });
}

export function sectionTitle(section: TeamsTranscriptIndexSection): string {
  return section.teamName
    ? `${section.title} · ${section.teamName}`
    : section.title;
}

/**
 * Never the upload's filename: that is the minted name, a content hash the
 * index exists to keep out of sight.
 */
export function teamsAssetDisplayName(
  asset: TeamsTranscriptIndexAsset,
): string {
  return (
    asset.displayName ??
    (asset.kind === "image"
      ? t({ id: "teams.preview.image", message: "Image" })
      : t({ id: "teams.preview.attachment", message: "Attachment" }))
  );
}

function selectionLine(section: TeamsTranscriptIndexSection): string {
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
        : t({ id: "teams.preview.allMessages", message: "All messages" }),
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
  parts.push(
    section.kind === "channel"
      ? t({ id: "teams.context.detail.kind.channel", message: "Channel" })
      : t({ id: "teams.context.detail.kind.chat", message: "Chat" }),
  );
  return parts.join(" · ");
}

/** Enough of a message to tell two from the same sender apart, no more. */
const EXCERPT_LENGTH = 100;

function pickedMessage(
  message: TeamsTranscriptIndexMessage,
  section: TeamsTranscriptIndexSection,
): TeamsTranscriptPickedMessage {
  const createdAt = toDate(message.createdAt);
  return {
    key: message.ref.messageId,
    sender:
      section.viewer !== null && message.sender === section.viewer
        ? t({ id: "branding.user_form_of_address", message: "You" })
        : message.sender,
    when: createdAt
      ? createdAt.toLocaleString(appLocale(), {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    excerpt: excerpt(message.text),
  };
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH
    ? `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : flat;
}

/** Before a catalog is active Lingui reports no locale; the runtime's default then applies. */
export const appLocale = (): string | undefined => i18n.locale || undefined;

/** "Oct 1, 2026", in the app's language. */
export function formatTeamsDay(iso: string | null): string | null {
  const date = toDate(iso);
  return date
    ? date.toLocaleDateString(appLocale(), {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
}

function dateRange(window: TeamsTranscriptIndexWindow): string {
  const from = formatTeamsDay(window.from);
  const to = formatTeamsDay(window.to);
  if (from === null || to === null) return "";
  return from === to ? from : `${from} – ${to}`;
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
