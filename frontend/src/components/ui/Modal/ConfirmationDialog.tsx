import { t } from "@lingui/core/macro";

import { ModalBase } from "./ModalBase";
import { Button } from "../Controls/Button"; // Assuming ButtonVariant is exported

import type { ButtonVariant } from "../Controls/Button";
import type React from "react";

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  message: React.ReactNode; // Allow richer content like formatted text
  confirmButtonText?: string;
  cancelButtonText?: string;
  confirmButtonVariant?: ButtonVariant;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmButtonText = t`Confirm`,
  cancelButtonText = t`Cancel`,
  confirmButtonVariant = "primary",
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      contentClassName="max-w-md" // Keep modal smaller for confirmation
    >
      <div className="space-y-4">
        {typeof message === "string" ? (
          <p className="text-sm text-theme-fg-secondary">{message}</p>
        ) : (
          message // Render ReactNode directly if provided
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={onClose} // Use onClose directly
            aria-label={t`Cancel action`}
          >
            {cancelButtonText}
          </Button>
          <Button
            variant={confirmButtonVariant}
            onClick={onConfirm} // Use onConfirm directly
            aria-label={t`Confirm action`}
          >
            {confirmButtonText}
          </Button>
        </div>
      </div>
    </ModalBase>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
ConfirmationDialog.displayName = "ConfirmationDialog";
