import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import { ComposerContextArea } from "@/components/ui/Chat/ComposerContext/ComposerContextArea";
import { FileAttachmentsPreview } from "@/components/ui/FileUpload";
import { componentRegistry } from "@/config/componentRegistry";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import { isImeComposing } from "@/utils/isImeComposing";

import { useEditComposerContext } from "./useEditComposerContext";
import { Button } from "../Controls";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type { KeyboardEvent, ReactNode } from "react";

/** What the edit would send now, for the token check under the textarea. */
export interface MessageEditorTokenContext {
  files: FileUploadItem[];
  /** The context the server sends again with the edit, as estimates. */
  virtualFiles: File[];
}

export interface MessageEditorProps {
  message: Message;
  onCancel: () => void;
  onSubmit: (content: string, inputFileIds: string[]) => void;
  /** Rendered under the textarea; reports back whether Submit must be blocked. */
  renderTokenUsage?: (
    draft: string,
    context: MessageEditorTokenContext,
  ) => ReactNode;
  isSubmitBlocked?: boolean;
  /** The message's own attachments, editable for this turn. */
  initialFiles?: FileUploadItem[];
  onFilePreview?: (file: FileUploadItem) => void;
  /** Whether the server still offers a facet; one it would drop shows no chip. */
  isActionFacetAvailable?: (facetId: string) => boolean;
}

export const MessageEditor = ({
  message,
  onCancel,
  onSubmit,
  renderTokenUsage,
  isSubmitBlocked = false,
  initialFiles = [],
  onFilePreview,
  isActionFacetAvailable,
}: MessageEditorProps) => {
  const [attachedFiles, setAttachedFiles] =
    useState<FileUploadItem[]>(initialFiles);
  const [draft, setDraft] = useState(() =>
    extractTextFromContent(message.content),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  const removeFiles = useCallback((fileIds: string[]) => {
    const ids = new Set(fileIds);
    setAttachedFiles((previous) => {
      const next = previous.filter((file) => !ids.has(file.id));
      return next.length === previous.length ? previous : next;
    });
  }, []);

  const focusTextarea = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const { items, slotFiles, estimates } = useEditComposerContext({
    message,
    files: attachedFiles,
    onRemoveFiles: removeFiles,
    onFilePreview,
    isActionFacetAvailable,
  });

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

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeComposing(event)) {
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // On the root, so Escape on a chip cancels as it does in the textarea. A
  // chip's detail is portaled out of the editor but still bubbles here
  // through React: it closes itself, and only that.
  const handleRootKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        isImeComposing(event) ||
        !rootRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      event.preventDefault();
      onCancel();
    },
    [onCancel],
  );

  const hasLane = items.length > 0 || slotFiles.length > 0;
  const someClaimed = slotFiles.length !== attachedFiles.length;
  const Slot = componentRegistry.ChatInputAttachmentPreview;
  const slotProps = {
    attachedFiles: slotFiles,
    maxFiles: attachedFiles.length,
    onRemoveFile: (fileId: string) => removeFiles([fileId]),
    onRemoveAllFiles: () => removeFiles(slotFiles.map((file) => file.id)),
    onFilePreview,
    sharedHeightCap: true,
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape is caught for the editor's own controls, which stay the focus targets
    <div
      ref={rootRef}
      className="w-full"
      data-testid="message-editor"
      data-ui="message-editor"
      onKeyDown={handleRootKeyDown}
    >
      {/* Above the textarea, matching both the composer and the sent message.
          Below it, switching into edit mode would move the tiles from one side
          of the text to the other and back again on cancel. */}
      <div
        className={clsx(
          hasLane && "mb-2",
          // "Sent as before" is why a chip here cannot be removed: the label
          // gives way first, down to its own floor.
          "[&_[data-locked=true]_[data-ui=composer-context-chip-meta]]:shrink-[0.0001]",
        )}
      >
        <ComposerContextArea
          items={items}
          hasFiles={slotFiles.length > 0}
          onFocusComposer={focusTextarea}
          onRemoveClaimedFiles={removeFiles}
          label={t({
            id: "chat.messageEditor.laneLabel",
            message: "Attachments of this message",
          })}
          files={
            Slot ? (
              <Slot {...slotProps} />
            ) : (
              <FileAttachmentsPreview
                {...slotProps}
                stagedCount={someClaimed ? attachedFiles.length : undefined}
              />
            )
          }
        />
      </div>

      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleTextareaKeyDown}
        aria-label={t({
          id: "chat.messageEditor.ariaLabel",
          message: "Edit your message",
        })}
        data-testid="message-editor-input"
        className="w-full resize-none rounded-md border border-theme-border bg-theme-bg-primary p-2 text-theme-fg-primary focus:outline-none focus:ring-2 focus:ring-theme-focus"
        rows={1}
      />

      {renderTokenUsage?.(draft, {
        files: attachedFiles,
        virtualFiles: estimates,
      })}

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
