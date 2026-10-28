import { useMemo } from "react";

import { AttachmentTileList } from "./AttachmentTileList";
import { audioTranscriptionTileStatus } from "./audioTranscriptionStatus";

import type {
  AttachmentTileItem,
  AttachmentTileListProps,
} from "./AttachmentTileList";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

/** What the composer lets a staged recording's tile offer. */
export interface ChatInputAudioTranscriptionControls {
  /** The recorder still holds this recording, so its transcription can run again. */
  canRetry: (fileId: string) => boolean;
  retryingFileId: string | null;
  onRetry: (fileId: string) => void;
  /** The composer is locked or a recording is uploading. */
  disabled: boolean;
  /**
   * `onRemoveFile` cancels a recording that is still being worked on, so its
   * remove control is named for that and stays enabled while `disabled`.
   */
  cancelable?: boolean;
}

/**
 * The staged-attachments contract a component kit implements.
 *
 * Lives here rather than under `src/types` so the shared-surface generator,
 * which only walks `src/components`, can export it to kits.
 */
export interface ChatInputAttachmentPreviewProps {
  /** Array of file attachments to preview */
  attachedFiles: FileUploadItem[];
  /** Max number of files allowed, shown as the staged count */
  maxFiles: number;
  /** Handler to remove a specific file */
  onRemoveFile: (fileId: string) => void;
  /** Handler to remove all files */
  onRemoveAllFiles: () => void;
  /** Optional handler for file preview interaction */
  onFilePreview?: (file: FileUploadItem) => void;
  /** Whether the component is in a disabled state */
  disabled?: boolean;
  /** Whether to show file type info */
  showFileTypes?: boolean;
  /**
   * The composer caps the staged area as a whole (context chips and files
   * together); do not add a scroll area of your own.
   */
  sharedHeightCap?: boolean;
  /**
   * Passed by the composer for its staged files: recordings carry their
   * status in `audio_transcription`; draw it on the file (see
   * `audioTranscriptionTileStatus`), and offer the retry for the ids
   * `canRetry` accepts. Absent elsewhere (an edited message), where the
   * default preview draws no status.
   */
  audioTranscription?: ChatInputAudioTranscriptionControls;
}

/**
 * What the default preview additionally accepts. Declared as an extension so
 * the kit contract above stays the single source of truth for the shared
 * props rather than a hand-kept copy of them.
 */
export interface FileAttachmentsPreviewProps
  extends ChatInputAttachmentPreviewProps {
  renderAttachment?: AttachmentTileListProps["renderAttachment"];
  renderItems?: AttachmentTileListProps["renderItems"];
  /** Whether to display file size */
  showFileSizes?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Length to truncate filenames */
  filenameTruncateLength?: number;
  /** Optional surface variant for chat message geometry */
  surfaceVariant?: "default" | "message";
  /**
   * Files staged in all, when some of them are shown elsewhere (a Teams
   * transcript's files). The count reads it against `maxFiles`, and "Remove
   * all" is named by the files shown here.
   */
  stagedCount?: number;
}

/**
 * Staged file attachments, drawn with the shared attachment tile.
 *
 * The props are the component-kit override contract and stay as they are even
 * where the tile no longer needs them: `showFileSizes` has never had a size to
 * show (the API type carries none) and `filenameTruncateLength` is now handled
 * by CSS truncation against the tile width.
 */
export const FileAttachmentsPreview: React.FC<FileAttachmentsPreviewProps> = ({
  attachedFiles,
  maxFiles,
  onRemoveFile,
  onRemoveAllFiles,
  onFilePreview,
  disabled = false,
  className = "",
  renderAttachment,
  renderItems,
  stagedCount,
  sharedHeightCap = false,
  audioTranscription,
}) => {
  const items = useMemo<AttachmentTileItem[]>(
    () =>
      attachedFiles.map((file) => {
        // Only the composer passes the controls; an edited message's files show no status.
        const audio = audioTranscription
          ? audioTranscriptionTileStatus(file, {
              retryable: audioTranscription.canRetry(file.id),
              retrying: audioTranscription.retryingFileId === file.id,
              locked: audioTranscription.disabled,
              cancelable: audioTranscription.cancelable,
            })
          : null;
        if (!audio) {
          return { id: file.id, file, previewUrl: file.preview_url };
        }
        const retry = audioTranscription?.onRetry;
        return {
          id: file.id,
          file,
          previewUrl: file.preview_url,
          metaLabel: audio.metaLabel,
          ...(audio.cancel ? { disabled: false } : {}),
          status: {
            busy: audio.busy,
            ...(audio.tone ? { tone: audio.tone } : {}),
            ...(audio.title ? { title: audio.title } : {}),
            ...(audio.transcript
              ? {
                  transcript: {
                    ...(audio.transcript.excerpt
                      ? { excerpt: audio.transcript.excerpt }
                      : {}),
                    ...(audio.transcript.more
                      ? {
                          more: {
                            label: audio.transcript.more.label,
                            accessibleName: audio.transcript.more.name,
                          },
                        }
                      : {}),
                  },
                }
              : {}),
            ...(audio.cancel
              ? {
                  remove: {
                    label: audio.cancel.label,
                    accessibleName: audio.cancel.name,
                  },
                }
              : {}),
            ...(audio.action && retry
              ? {
                  action: {
                    label: audio.action.label,
                    accessibleName: audio.action.name,
                    disabled: audio.action.disabled,
                    onSelect: () => retry(file.id),
                  },
                }
              : {}),
          },
        };
      }),
    [attachedFiles, audioTranscription],
  );

  if (attachedFiles.length === 0) {
    return null;
  }

  return (
    <AttachmentTileList
      items={items}
      renderAttachment={renderAttachment}
      renderItems={renderItems}
      size="compact"
      onRemove={onRemoveFile}
      onRemoveAll={onRemoveAllFiles}
      onActivate={
        onFilePreview
          ? (item) => onFilePreview(item.file as FileUploadItem)
          : undefined
      }
      disabled={disabled}
      capHeight={!sharedHeightCap}
      stickyBulkControls={sharedHeightCap}
      maxFiles={maxFiles}
      stagedCount={stagedCount}
      className={className}
    />
  );
};
