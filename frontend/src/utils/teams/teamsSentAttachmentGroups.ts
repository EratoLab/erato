/**
 * Recovers, from a sent message alone, which uploads came from a Teams
 * conversation — so the transcript and the files shared inside it read as one
 * thing rather than as loose siblings.
 *
 * Membership comes from the names the picker minted, which are already in the
 * message. The composer groups far more richly, per conversation and per
 * message, but it does that from the transcript's index block, which it reads
 * out of the local `File` it is holding. That file is gone once the message is
 * sent, and re-deriving it would mean downloading and parsing every transcript
 * in the rendered history. This buys the part that matters — "these belong
 * together" — for nothing.
 *
 * Both halves of the pattern are required before anything is grouped. A
 * transcript name is only `teams-*.md`, which a user could plausibly upload by
 * hand; a minted upload carries a hex content hash, which they could not. One
 * of each in the same message is the signal.
 */

import { t } from "@lingui/core/macro";

import {
  isTeamsMintedUpload,
  isTeamsTranscriptName,
  teamsUploadDisplayName,
} from "./teamsUploadName";

import type { FileAttachmentGroup } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface TeamsSentAttachmentGrouping {
  groups: FileAttachmentGroup[];
  /** Files the groups account for; anything else stays an ordinary tile. */
  claimedFileIds: Set<string>;
}

/**
 * Null when this message shows no sign of a Teams conversation, which is the
 * common case — the caller then renders its attachments as it always would.
 */
export function groupTeamsSentAttachments(
  files: readonly FileUploadItem[],
): TeamsSentAttachmentGrouping | null {
  const transcript = files.find((file) => isTeamsTranscriptName(file.filename));
  const shared = files.filter((file) => isTeamsMintedUpload(file.filename));

  if (!transcript || shared.length === 0) {
    return null;
  }

  const claimedFileIds = new Set<string>([
    transcript.id,
    ...shared.map((file) => file.id),
  ]);

  const sharedCount = shared.length;

  return {
    groups: [
      {
        id: `teams-conversation:${transcript.id}`,
        label: t`Teams conversation`,
        metaLabel:
          sharedCount === 1 ? t`1 shared file` : t`${sharedCount} shared files`,
        items: [
          // The transcript leads: it is the conversation, and the rest are
          // what was shared inside it.
          {
            kind: "attachment" as const,
            id: transcript.id,
            file: transcript,
          },
          ...shared.map((file) => ({
            kind: "attachment" as const,
            id: file.id,
            file: {
              ...file,
              displayName: teamsUploadDisplayName(file.filename) ?? undefined,
            },
          })),
        ],
      },
    ],
    claimedFileIds,
  };
}
