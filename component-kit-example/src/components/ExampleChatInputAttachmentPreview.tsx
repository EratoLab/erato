import { audioTranscriptionTileStatus } from "@erato/frontend/shared";
import { useLingui } from "@lingui/react";

import type { ChatInputAttachmentPreviewProps } from "@erato/frontend/library";
import type { ReactNode } from "react";

// Opening and removing are separate targets: a click on a name previews the
// file, and only the named x removes it. `sharedHeightCap` needs nothing here
// because this preview never adds a scroll area of its own. A recording shows
// its transcription status beside its name, the host's words for it.
export const ExampleChatInputAttachmentPreview = ({
  attachedFiles,
  maxFiles,
  onRemoveFile,
  onRemoveAllFiles,
  onFilePreview,
  disabled,
  audioTranscription,
}: ChatInputAttachmentPreviewProps): ReactNode => {
  const { _ } = useLingui();

  return (
    <div
      data-component-kit="example"
      className="erato-component-kit-example erato-component-kit-example-files"
    >
      {attachedFiles.slice(0, maxFiles).map((file) => {
        const audio = audioTranscriptionTileStatus(file, {
          retryable: audioTranscription?.canRetry(file.id) ?? false,
          retrying: audioTranscription?.retryingFileId === file.id,
          locked: audioTranscription?.disabled,
        });
        return (
          <span key={file.id} className="erato-component-kit-example-file">
            {onFilePreview ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onFilePreview(file)}
              >
                {file.filename}
              </button>
            ) : (
              <span>{file.filename}</span>
            )}
            {audio ? (
              <span
                className="erato-component-kit-example-file-status"
                data-status={audio.tone ?? (audio.busy ? "busy" : undefined)}
                title={audio.title}
              >
                {audio.metaLabel}
              </span>
            ) : null}
            {audio?.action && audioTranscription ? (
              <button
                type="button"
                disabled={disabled || audio.action.disabled}
                aria-label={_({
                  id: "componentKit.example.attachment.retryNamed",
                  message: "Retry transcription: {filename}",
                  values: { filename: file.filename },
                })}
                onClick={() => audioTranscription.onRetry(file.id)}
              >
                {_({
                  id: "componentKit.example.attachment.retry",
                  message: "Retry transcription",
                })}
              </button>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              aria-label={_({
                id: "componentKit.example.attachment.remove",
                message: "Remove {filename}",
                values: { filename: file.filename },
              })}
              onClick={() => onRemoveFile(file.id)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        );
      })}
      {attachedFiles.length > 0 ? (
        <button type="button" disabled={disabled} onClick={onRemoveAllFiles}>
          {_({
            id: "componentKit.example.attachment.removeAll",
            message: "Remove all",
          })}
        </button>
      ) : null}
    </div>
  );
};
