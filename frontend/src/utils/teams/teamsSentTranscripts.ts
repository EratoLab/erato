import { UploadClaims } from "./teamsAttachmentGroups";
import { isTeamsMintedUpload, isTeamsTranscriptName } from "./teamsUploadName";

import type { TeamsTranscriptIndexRead } from "@/hooks/teams/useTeamsTranscriptIndex";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface TeamsSentTranscript {
  transcript: FileUploadItem;
  /** The uploads the transcript brought, each placed under one transcript only. */
  assets: FileUploadItem[];
  read: TeamsTranscriptIndexRead;
}

const NOTHING_TO_READ: TeamsTranscriptIndexRead = {
  index: null,
  isReading: false,
};

/**
 * The Teams transcripts among a sent message's files, each with the uploads
 * it brought. A read index places its assets by the names it records; until
 * then, and for a transcript that cannot be read, the uploads the picker
 * minted go to the first such transcript, as the sent message groups them, so
 * no claimed file shows as a loose tile in between.
 *
 * A `teams-*.md` file that read as no transcript and brought no minted upload
 * is an ordinary attachment and is left out.
 */
export function teamsSentTranscripts(
  files: readonly FileUploadItem[],
  reads: ReadonlyMap<string, TeamsTranscriptIndexRead>,
): TeamsSentTranscript[] {
  const transcripts = files.filter((file) =>
    isTeamsTranscriptName(file.filename),
  );
  if (transcripts.length === 0) return [];

  const uploads = new UploadClaims(files);
  for (const transcript of transcripts) uploads.claimFile(transcript);

  const indexedAssets = new Map<string, FileUploadItem[]>();
  for (const transcript of transcripts) {
    const index = reads.get(transcript.id)?.index;
    if (!index) continue;
    indexedAssets.set(
      transcript.id,
      index.messages.flatMap((message) =>
        message.assets.flatMap((asset) => {
          const file = uploads.claim(asset.name);
          return file ? [file] : [];
        }),
      ),
    );
  }

  let minted = files.filter(
    (file) =>
      isTeamsMintedUpload(file.filename) && !uploads.claimed.has(file.id),
  );
  return transcripts.flatMap((transcript) => {
    const read = reads.get(transcript.id) ?? NOTHING_TO_READ;
    const indexed = indexedAssets.get(transcript.id);
    if (indexed) {
      return [{ transcript, assets: indexed, read }];
    }
    const assets = minted;
    minted = [];
    if (!read.isReading && assets.length === 0) return [];
    return [{ transcript, assets, read }];
  });
}
