import {
  UploadTooLargeError,
  useFileUploadStore,
  validateFileSizes,
} from "@erato/frontend/library";
import { useMemo } from "react";

import type { TeamsTranscriptRecord } from "../utils/teamsComposerTranscripts";
import type {
  ChatInputControlsHandle,
  FileUploadItem,
} from "@erato/frontend/library";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

/**
 * What the chat picker may do to one composer. Uploading through the host,
 * rather than handing files to the composer's own file sources, is what gives
 * the picker the upload ids its records are keyed by.
 */
export interface TeamsComposerBridge {
  /**
   * The composer's own upload path, without staging. Null when nothing usable
   * came back: a throw, an empty result, or no transcript among the uploads.
   * Fewer assets than were handed in is still a result: the composer uploads
   * at most `maxFiles`, and drops a type it can't take with its own error.
   */
  upload: (files: File[]) => Promise<FileUploadItem[] | null>;
  add: (uploaded: FileUploadItem[]) => void;
  /** Unstages what `previous` still has staged, then stages `uploaded`. */
  replace: (
    previous: TeamsTranscriptRecord,
    uploaded: FileUploadItem[],
  ) => void;
  remove: (fileIds: readonly string[]) => void;
  /** The record's uploads that are still staged. */
  claimedIds: (record: TeamsTranscriptRecord) => string[];
  announce: (text: string) => void;
  focusComposer: () => void;
}

export interface UseTeamsComposerBridgeOptions {
  uploadFiles?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  controls: Pick<
    ChatInputControlsHandle,
    "addUploadedFiles" | "removeUploadedFiles" | "focusInput"
  >;
  stagedRef: MutableRefObject<readonly FileUploadItem[]>;
  /**
   * The host's mirror of the staged files. Changed in the same batch as the
   * composer, so a chip whose record swaps in that batch never loses its
   * upload for a render; the composer's own report reconciles it before paint.
   */
  setStaged: Dispatch<SetStateAction<FileUploadItem[]>>;
  announce: (text: string) => void;
  maxSizeBytes: number;
  maxSizeFormatted: string;
}

const withFiles = (
  current: readonly FileUploadItem[],
  added: readonly FileUploadItem[],
): FileUploadItem[] => {
  const known = new Set(current.map((file) => file.id));
  return [...current, ...added.filter((file) => !known.has(file.id))];
};

export function useTeamsComposerBridge({
  uploadFiles,
  controls,
  stagedRef,
  setStaged,
  announce,
  maxSizeBytes,
  maxSizeFormatted,
}: UseTeamsComposerBridgeOptions): TeamsComposerBridge {
  return useMemo(() => {
    const claimedIds = (record: TeamsTranscriptRecord) => {
      const staged = new Set(stagedRef.current.map((file) => file.id));
      return [record.transcriptUploadId, ...record.assetUploadIds].filter(
        (id) => staged.has(id),
      );
    };
    const remove = (fileIds: readonly string[]) => {
      if (fileIds.length === 0) return;
      const ids = new Set(fileIds);
      controls.removeUploadedFiles([...ids]);
      setStaged((current) => current.filter((file) => !ids.has(file.id)));
    };
    const add = (uploaded: FileUploadItem[]) => {
      controls.addUploadedFiles(uploaded);
      setStaged((current) => withFiles(current, uploaded));
    };
    return {
      async upload(files) {
        const [transcript] = files;
        const store = useFileUploadStore.getState();
        if (!transcript || !uploadFiles || store.isUploading) return null;
        const sizes = validateFileSizes(files, maxSizeBytes);
        if (!sizes.valid) {
          store.setError(
            new UploadTooLargeError(
              maxSizeFormatted,
              sizes.oversizedFiles.map((file) => file.name),
            ),
          );
          return null;
        }
        let uploaded: FileUploadItem[] | undefined;
        try {
          uploaded = await uploadFiles(files);
        } catch (error) {
          console.warn(
            "[TeamsComposer] uploading the transcript failed",
            error,
          );
          return null;
        }
        if (!uploaded?.some((file) => file.filename === transcript.name)) {
          return null;
        }
        return uploaded;
      },
      add,
      // Removed first: the composer trims to `maxFiles` as it adds, and the
      // old files would otherwise still count against the new ones.
      replace(previous, uploaded) {
        remove(claimedIds(previous));
        add(uploaded);
      },
      remove,
      claimedIds,
      announce,
      focusComposer: () => controls.focusInput(),
    };
  }, [
    announce,
    controls,
    maxSizeBytes,
    maxSizeFormatted,
    setStaged,
    stagedRef,
    uploadFiles,
  ]);
}
