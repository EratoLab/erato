/**
 * Recovers, from a sent message alone, which uploads came from a Teams
 * conversation — so the transcript and the files shared inside it read as one
 * thing rather than as loose siblings.
 *
 * The fallback behind `buildTeamsMessageAttachmentGroups`, which groups from
 * the transcript's own index block. This applies while that download is in
 * flight, when it fails, and for a transcript whose block is missing, damaged
 * or of a version this build cannot read. Membership comes from the names the
 * picker minted, which are already in the message.
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
