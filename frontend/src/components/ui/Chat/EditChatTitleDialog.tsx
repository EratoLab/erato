import { t } from "@lingui/core/macro";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../Controls/Button";
import { Input } from "../Input/Input";
import { ModalBase } from "../Modal/ModalBase";

interface EditChatTitleDialogProps {
  isOpen: boolean;
  generatedTitle: string;
  initialUserProvidedTitle?: string | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void> | void;
}

export const EditChatTitleDialog = ({
  isOpen,
  generatedTitle,
  initialUserProvidedTitle,
  isSubmitting = false,
  onClose,
  onSubmit,
}: EditChatTitleDialogProps) => {
  const [title, setTitle] = useState(initialUserProvidedTitle ?? "");

  useEffect(() => {
    if (isOpen) {
      setTitle(initialUserProvidedTitle ?? "");
    }
  }, [initialUserProvidedTitle, isOpen]);

  const generatedTitleFallback = useMemo(
    () =>
      generatedTitle ||
      t({
        id: "chat.history.rename.generated.fallback",
        message: "Untitled Chat",
      }),
    [generatedTitle],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t({
        id: "chat.history.rename.dialog.title",
        message: "Rename chat",
      })}
      contentClassName="max-w-lg"
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-theme-fg-primary">
            {t({
              id: "chat.history.rename.generated.label",
              message: "Generated title",
            })}
          </p>
          <p
            className="mt-1 rounded-md border border-theme-border bg-theme-bg-secondary px-3 py-2 text-sm text-theme-fg-secondary"
            data-testid="generated-chat-title"
          >
            {generatedTitleFallback}
          </p>
        </div>

        <div>
          <label
            htmlFor="chat-user-provided-title"
            className="mb-1 block text-sm font-medium text-theme-fg-primary"
          >
            {t({
              id: "chat.history.rename.userProvided.label",
              message: "Custom title",
            })}
          </label>
          <Input
            id="chat-user-provided-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t({
              id: "chat.history.rename.userProvided.placeholder",
              message: "Leave empty to use generated title",
            })}
            aria-label={t({
              id: "chat.history.rename.userProvided.label",
              message: "Custom title",
            })}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label={t({ id: "Cancel", message: "Cancel" })}
          >
            {t({ id: "Cancel", message: "Cancel" })}
          </Button>
          <Button
            variant="primary"
            onClick={() => void onSubmit(title)}
            disabled={isSubmitting}
            aria-label={t({
              id: "chat.history.rename.save",
              message: "Rename",
            })}
          >
            {isSubmitting
              ? t({
                  id: "chat.history.rename.saving",
                  message: "Saving...",
                })
              : t({
                  id: "chat.history.rename.save",
                  message: "Rename",
                })}
          </Button>
        </div>
      </div>
    </ModalBase>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
EditChatTitleDialog.displayName = "EditChatTitleDialog";
