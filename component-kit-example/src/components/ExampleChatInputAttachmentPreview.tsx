import { useLingui } from "@lingui/react";

import type { ChatInputAttachmentPreviewProps } from "@erato/frontend/library";
import type { ReactNode } from "react";

// Opening and removing are separate targets: a click on a name previews the
// file, and only the named x removes it. `sharedHeightCap` needs nothing here
// because this preview never adds a scroll area of its own.
export const ExampleChatInputAttachmentPreview = ({
  attachedFiles,
  maxFiles,
  onRemoveFile,
  onRemoveAllFiles,
  onFilePreview,
  disabled,
}: ChatInputAttachmentPreviewProps): ReactNode => {
  const { _ } = useLingui();

  return (
    <div
      data-component-kit="example"
      className="erato-component-kit-example erato-component-kit-example-files"
    >
      {attachedFiles.slice(0, maxFiles).map((file) => (
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
      ))}
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
