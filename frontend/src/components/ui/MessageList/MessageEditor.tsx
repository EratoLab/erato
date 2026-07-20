import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";

import { Button } from "../Controls";

import type { Message } from "@/types/chat";
import type { KeyboardEvent } from "react";

export interface MessageEditorProps {
  message: Message;
  onCancel: () => void;
  onSubmit: (content: string, inputFileIds: string[]) => void;
  /** Rendered under the textarea; reports back whether Submit must be blocked. */
  renderTokenUsage?: (draft: string) => React.ReactNode;
  isSubmitBlocked?: boolean;
}

export const MessageEditor = ({
  message,
  onCancel,
  onSubmit,
  renderTokenUsage,
  isSubmitBlocked = false,
}: MessageEditorProps) => {
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
    onSubmit(draft.trim(), message.input_files_ids ?? []);
  }, [canSubmit, draft, message.input_files_ids, onSubmit]);

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
