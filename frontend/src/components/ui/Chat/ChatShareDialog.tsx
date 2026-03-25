import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { Input } from "@/components/ui/Input/Input";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { useChatShareLink } from "@/hooks/useChatShareLink";

import { CheckIcon, CopyIcon } from "../icons";

// eslint-disable-next-line lingui/no-unlocalized-strings
const CHAT_SHARE_PATH_PREFIX = "/chat-share/";

interface ChatShareDialogProps {
  isOpen: boolean;
  chatId: string | null;
  onClose: () => void;
}

export function ChatShareDialog({
  isOpen,
  chatId,
  onClose,
}: ChatShareDialogProps) {
  const { shareLink, setEnabled, isUpdating } = useChatShareLink(
    isOpen ? chatId : null,
  );
  const [isCopied, setIsCopied] = useState(false);

  const shareUrl = useMemo(() => {
    if (!shareLink?.enabled) {
      return "";
    }

    return new URL(
      `${CHAT_SHARE_PATH_PREFIX}${shareLink.id}`,
      window.location.origin,
    ).toString();
  }, [shareLink]);

  const handleToggle = async (enabled: boolean) => {
    if (!chatId) {
      return;
    }

    await setEnabled(enabled);
    if (!enabled) {
      setIsCopied(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) {
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t({
        id: "chat.share.dialog.title",
        message: "Share chat",
      })}
      contentClassName="sm:max-w-lg"
    >
      <div className="space-y-5">
        <Alert type="warning">
          <div className="space-y-1">
            <p className="font-medium">
              {t({
                id: "chat.share.warning.title",
                message: "The conversation may contain sensitive information",
              })}
            </p>
            <p className="text-sm text-theme-fg-muted">
              {t({
                id: "chat.share.warning.body",
                message:
                  "Please take a moment to check the chat history for confidential information before sharing the link.",
              })}
            </p>
          </div>
        </Alert>

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[var(--theme-radius-shell)] border border-theme-border px-4 py-3">
          <div className="space-y-1">
            <p className="font-medium text-theme-fg-primary">
              {t({
                id: "chat.share.toggle.label",
                message: "Enable share link",
              })}
            </p>
            <p className="text-sm text-theme-fg-muted">
              {t({
                id: "chat.share.toggle.description",
                message: "Anyone logged in to this organization can view it.",
              })}
            </p>
          </div>
          <input
            type="checkbox"
            className="size-4 accent-[var(--theme-fg-accent)]"
            checked={!!shareLink?.enabled}
            disabled={isUpdating}
            onChange={(event) => {
              void handleToggle(event.target.checked);
            }}
            aria-label={t({
              id: "chat.share.toggle.aria",
              message: "Toggle chat sharing",
            })}
          />
        </label>

        {shareLink?.enabled ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              void handleCopy();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void handleCopy();
              }
            }}
            className={clsx(
              "flex w-full items-center gap-3 rounded-[var(--theme-radius-input)] border border-theme-border bg-theme-bg-secondary px-3 py-2 text-left",
              "theme-transition cursor-pointer hover:bg-theme-bg-hover",
            )}
          >
            <Input
              value={shareUrl}
              readOnly
              tabIndex={-1}
              aria-label={t({
                id: "chat.share.link.aria",
                message: "Shared chat link",
              })}
              className="pointer-events-none border-0 bg-transparent p-0 focus:ring-0"
            />
            <span className="shrink-0 text-theme-fg-secondary">
              {isCopied ? (
                <CheckIcon className="size-4 text-theme-success-fg" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </span>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button onClick={onClose} variant="secondary">
            {t({
              id: "common.close",
              message: "Close",
            })}
          </Button>
        </div>
      </div>
    </ModalBase>
  );
}
