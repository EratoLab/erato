/**
 * The Teams send preview: which transcripts the composer's next send carries,
 * read from the staged files and nothing else. A transcript is only uploads in
 * that list, so its chip exists exactly while its upload is staged, and claims
 * exactly the uploads of it that are.
 *
 * Keyed by upload id, never by filename: two transcripts of three
 * conversations are both `teams-chats-3.md`.
 */

import type { TeamsChatSelection } from "./teamsChatSelection";
import type { FileUploadItem } from "@erato/frontend/library";

/** What this session attached, kept while the dialog is closed. */
export interface TeamsTranscriptRecord {
  /** Stable across "Edit selection", so the chip updates in place. */
  lineage: string;
  transcriptUploadId: string;
  /** The uploads of its images and shared files that the composer took. */
  assetUploadIds: readonly string[];
  /** Upload names of every image and shared file handed over with it. */
  assetNames: readonly string[];
  /** Upload names the user removed from it; an Update leaves them out. */
  excludedAssetNames: readonly string[];
  /** The local transcript, read for its index block. */
  file: File;
  /** What the picker reopens with. */
  selections: readonly TeamsChatSelection[];
  messageLimit: number;
}

export interface TeamsComposerTranscript {
  record: TeamsTranscriptRecord;
  transcript: FileUploadItem;
  /** The record's staged assets, in staged order. */
  assets: FileUploadItem[];
  /**
   * Upload names of assets handed over that the composer did not take, past
   * its file limit or of a type it refuses, and that the user did not remove.
   */
  notAttachedAssetNames: string[];
}

export interface TeamsSendPreview {
  /** In the order their transcripts are staged. */
  transcripts: TeamsComposerTranscript[];
  /** Every id the send carries, transcripts and other files alike. */
  fileIds: string[];
}

export function previewTeamsSend(
  records: Iterable<TeamsTranscriptRecord>,
  staged: readonly FileUploadItem[],
): TeamsSendPreview {
  const byTranscriptId = new Map<string, TeamsTranscriptRecord>();
  for (const record of records) {
    byTranscriptId.set(record.transcriptUploadId, record);
  }
  const transcripts: TeamsComposerTranscript[] = [];
  for (const file of staged) {
    const record = byTranscriptId.get(file.id);
    if (!record) continue;
    const assetIds = new Set(record.assetUploadIds);
    const assets = staged.filter((candidate) => assetIds.has(candidate.id));
    const taken = new Set([
      ...assets.map((asset) => asset.filename),
      ...record.excludedAssetNames,
    ]);
    transcripts.push({
      record,
      transcript: file,
      assets,
      notAttachedAssetNames: record.assetNames.filter(
        (name) => !taken.has(name),
      ),
    });
  }
  return { transcripts, fileIds: staged.map((file) => file.id) };
}
