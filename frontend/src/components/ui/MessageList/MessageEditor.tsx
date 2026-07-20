import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import { FileAttachmentsPreview } from "@/components/ui/FileUpload";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";

import { Button } from "../Controls";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { KeyboardEvent } from "react";

export interface MessageEditorProps {
  message: Message;
  onCancel: () => void;
  onSubmit: (content: string, inputFileIds: string[]) => void;
  /** Rendered under the textarea; reports back whether Submit must be blocked. */
  renderTokenUsage?: (draft: string) => React.ReactNode;
  isSubmitBlocked?: boolean;
  /** The message's own attachments, editable for this turn. */
  initialFiles?: FileUploadItem[];
  onFilePreview?: (file: FileUploadItem) => void;
}

export const MessageEditor = ({
  message,
  onCancel,
  onSubmit,
  renderTokenUsage,
  isSubmitBlocked = false,
  initialFiles = [],
  onFilePreview,
}: MessageEditorProps) => {
  const [attachedFiles, setAttachedFiles] =
    useState<FileUploadItem[]>(initialFiles);
  const [draft, setDraft] = useState(() =>
    extractTextFromContent(message.content),
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  // Grow with the content rather than scrolling inside a fixed box.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  const isEmpty = draft.trim().length === 0;
  const canSubmit = !isEmpty && !isSubmitBlocked;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) {
      return;
    }
    onSubmit(
      draft.trim(),
      attachedFiles.map((file) => file.id),
    );
  }, [attachedFiles, canSubmit, draft, onSubmit]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, onCancel],
  );

  return (
    <div className="w-full" data-testid="message-editor">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label={t({
          id: "chat.messageEditor.ariaLabel",
          message: "Edit your message",
        })}
        data-testid="message-editor-input"
        className="w-full resize-none rounded-md border border-theme-border bg-theme-bg-primary p-2 text-theme-fg-primary focus:outline-none focus:ring-2 focus:ring-theme-focus"
        rows={1}
      />

      {attachedFiles.length > 0 && (
        <div className="mt-2">
          <FileAttachmentsPreview
            attachedFiles={attachedFiles}
            maxFiles={attachedFiles.length}
            onRemoveFile={(fileId) =>
              setAttachedFiles((previous) =>
                previous.filter((file) => file.id !== fileId),
              )
            }
            onRemoveAllFiles={() => setAttachedFiles([])}
            onFilePreview={onFilePreview}
          />
        </div>
      )}

      {renderTokenUsage?.(draft)}

      <div className="mt-2 flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onCancel}
          data-testid="message-editor-cancel"
        >
          {t({ id: "chat.messageEditor.cancel", message: "Cancel" })}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
          data-testid="message-editor-submit"
        >
          {t({ id: "chat.messageEditor.submit", message: "Submit" })}
        </Button>
      </div>
    </div>
  );
};
