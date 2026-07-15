import type { ChatInputAttachmentPreviewProps } from "@erato/frontend/library";
import type { ReactNode } from "react";

export const ExampleChatInputAttachmentPreview = ({
  attachedFiles,
  maxFiles,
  onRemoveFile,
  onRemoveAllFiles,
  disabled,
}: ChatInputAttachmentPreviewProps): ReactNode => (
  <div
    data-component-kit="example"
    className="erato-component-kit-example erato-component-kit-example-files"
  >
    {attachedFiles.slice(0, maxFiles).map((file) => (
      <button
        key={file.id}
        type="button"
        disabled={disabled}
        onClick={() => onRemoveFile(file.id)}
      >
        {file.filename}
      </button>
    ))}
    {attachedFiles.length > 0 ? (
      <button type="button" disabled={disabled} onClick={onRemoveAllFiles}>
        x
      </button>
    ) : null}
  </div>
);
