/**
 * MessageControls - Example Customer Override
 *
 * Feature-rich message controls implementation with emoji reactions,
 * action buttons, dropdown menu, and metadata display.
 *
 * Features:
 * - Emoji reactions (👍 ❤️ 🎉 💡) with counters
 * - Copy, edit, regenerate actions
 * - Raw markdown toggle
 * - Dropdown menu (share, branch, delete)
 * - Metadata badges (model, tokens, processing time)
 *
 * To use this:
 * 1. Copy this file to: src/customer/components/MessageControls.tsx
 * 2. Update src/config/componentRegistry.ts to import and use it
 *
 * @example
 * // In componentRegistry.ts:
 * import { MessageControls } from "@/customer/components/MessageControls";
 *
 * export const componentRegistry: ComponentRegistry = {
 *   MessageControls: MessageControls,
 * };
 */

import clsx from "clsx";
import { useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { DropdownMenu } from "@/components/ui/Controls/DropdownMenu";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
import {
  CopyIcon,
  EditIcon,
  CheckIcon,
  CodeIcon,
  ShareIcon,
  MoreVertical,
} from "@/components/ui/icons";
import { createLogger } from "@/utils/debugLogger";

import type { DropdownMenuItem } from "@/components/ui/Controls/DropdownMenu";
import type { MessageControlsProps } from "@/types/message-controls";

const logger = createLogger("UI", "MessageControls");

interface MessageMetadata {
  model?: string;
  tokens?: number;
  processingTime?: number;
  hasToolCalls?: boolean;
  fileCount?: number;
}

// Emoji reaction types
type ReactionType = "thumbsUp" | "heart" | "party" | "idea";

interface ReactionConfig {
  emoji: string;
  label: string;
  activeClasses: string;
  inactiveClasses: string;
}

const REACTIONS: Record<ReactionType, ReactionConfig> = {
  thumbsUp: {
    emoji: "👍",
    label: "Thumbs up",
    activeClasses:
      "bg-blue-500/20 text-blue-600 border-blue-400 ring-1 ring-blue-200",
    inactiveClasses:
      "bg-theme-bg-secondary text-theme-fg-secondary hover:bg-blue-50 hover:text-blue-600 border-theme-border-primary",
  },
  heart: {
    emoji: "❤️",
    label: "Heart",
    activeClasses:
      "bg-red-500/20 text-red-600 border-red-400 ring-1 ring-red-200",
    inactiveClasses:
      "bg-theme-bg-secondary text-theme-fg-secondary hover:bg-red-50 hover:text-red-600 border-theme-border-primary",
  },
  party: {
    emoji: "🎉",
    label: "Party",
    activeClasses:
      "bg-yellow-500/20 text-yellow-600 border-yellow-400 ring-1 ring-yellow-200",
    inactiveClasses:
      "bg-theme-bg-secondary text-theme-fg-secondary hover:bg-yellow-50 hover:text-yellow-600 border-theme-border-primary",
  },
  idea: {
    emoji: "💡",
    label: "Light bulb",
    activeClasses:
      "bg-green-500/20 text-green-600 border-green-400 ring-1 ring-green-200",
    inactiveClasses:
      "bg-theme-bg-secondary text-theme-fg-secondary hover:bg-green-50 hover:text-green-600 border-theme-border-primary",
  },
};

export const MessageControls = ({
  messageId,
  isUserMessage,
  createdAt,
  context,
  onAction,
  className,
  showRawMarkdown = false,
  onToggleRawMarkdown,
}: MessageControlsProps) => {
  const [isCopied, setIsCopied] = useState(false);

  // Emoji reactions state (demo with mock data)
  const [reactions, setReactions] = useState<Record<ReactionType, number>>({
    thumbsUp: 0,
    heart: 0,
    party: 0,
    idea: 0,
  });

  // Track user's own reactions
  const [userReactions, setUserReactions] = useState<Set<ReactionType>>(
    new Set(),
  );

  // Chat-level edit permission
  const canEditChat = context.canEdit !== false;

  // Reset copy state after 2 seconds
  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => setIsCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  // Mock metadata (extend MessageControlsProps to pass real data)
  const metadata: MessageMetadata = {
    model: isUserMessage ? undefined : "GPT-4",
    tokens: isUserMessage ? undefined : 156,
    processingTime: isUserMessage ? undefined : 1.2,
    hasToolCalls: false,
    fileCount: 0,
  };

  const handleCopy = useCallback(async () => {
    const success = await onAction({ type: "copy", messageId });
    if (success) {
      setIsCopied(true);
      logger.log(`Copy succeeded for message ${messageId}`);
    }
  }, [onAction, messageId]);

  const handleEdit = useCallback(async () => {
    const success = await onAction({ type: "edit", messageId });
    if (success) {
      logger.log(`Edit initiated for message ${messageId}`);
    }
  }, [onAction, messageId]);

  const handleRegenerate = useCallback(async () => {
    const success = await onAction({ type: "regenerate", messageId });
    if (success) {
      logger.log(`Regenerate initiated for message ${messageId}`);
    }
  }, [onAction, messageId]);

  const handleReaction = useCallback(
    (reactionType: ReactionType) => {
      // Demo with local state - to persist, add "react" action type and send to backend
      const newUserReactions = new Set(userReactions);
      const wasActive = userReactions.has(reactionType);

      if (wasActive) {
        newUserReactions.delete(reactionType);
        setReactions((prev) => ({
          ...prev,
          [reactionType]: Math.max(0, prev[reactionType] - 1),
        }));
      } else {
        newUserReactions.add(reactionType);
        setReactions((prev) => ({
          ...prev,
          [reactionType]: prev[reactionType] + 1,
        }));
      }

      setUserReactions(newUserReactions);
      logger.log(
        `Reaction ${reactionType} ${wasActive ? "removed from" : "added to"} message ${messageId}`,
      );
    },
    [userReactions, messageId],
  );

  const dropdownItems: DropdownMenuItem[] = [
    {
      label: showRawMarkdown ? "Show Formatted" : "Show Raw Markdown",
      icon: <CodeIcon />,
      onClick: () => {
        onToggleRawMarkdown?.();
      },
      checked: showRawMarkdown,
    },
    {
      label: "Share Message",
      icon: <ShareIcon />,
      onClick: () => {
        logger.log(`Share clicked for message ${messageId}`);
        const mockLink = `${window.location.origin}/message/${messageId}`;
        void navigator.clipboard.writeText(mockLink);
      },
    },
    {
      label: "Branch from here",
      icon: (
        <svg className="size-4" viewBox="0 0 24 24" fill="none">
          <path
            d="M9 3L15 9M15 9L9 15M15 9H3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ),
      onClick: () => {
        logger.log(`Branch conversation from message ${messageId}`);
      },
      disabled: true,
    },
    {
      label: "Delete Message",
      icon: (
        <svg className="size-4" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 7V18C6 19.1046 6.89543 20 8 20H16C17.1046 20 18 19.1046 18 18V7M6 7H5M6 7H8M18 7H19M18 7H16M10 11V16M14 11V16M8 7V5C8 3.89543 8.89543 3 10 3H14C15.1046 3 16 3.89543 16 5V7M8 7H16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ),
      onClick: () => {
        void onAction({ type: "delete", messageId });
      },
      variant: "danger",
      disabled: !canEditChat,
    },
  ];

  const filteredDropdownItems = dropdownItems.filter((item) => {
    if (item.label.includes("Delete") && !isUserMessage && !canEditChat) {
      return false;
    }
    return true;
  });

  const safeCreatedAt =
    createdAt instanceof Date ? createdAt : new Date(createdAt ?? Date.now());

  return (
    <div
      className={clsx(
        "flex items-center gap-2 text-sm",
        "theme-transition",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {!isUserMessage && (
          <div className="flex items-center gap-1">
            {(
              Object.entries(REACTIONS) as [ReactionType, ReactionConfig][]
            ).map(([type, config]) => {
              const isActive = userReactions.has(type);
              const count = reactions[type];

              return (
                <button
                  key={type}
                  onClick={() => handleReaction(type)}
                  className={clsx(
                    "relative inline-flex items-center justify-center",
                    "rounded-full border px-2 py-0.5",
                    "text-sm transition-all duration-150",
                    "hover:scale-110 active:scale-95",
                    "focus:outline-none focus:ring-1 focus:ring-offset-1",
                    isActive ? config.activeClasses : config.inactiveClasses,
                  )}
                  aria-label={`${config.label}${count > 0 ? ` (${count})` : ""}`}
                  title={`${config.label}${count > 0 ? ` - ${count} reaction${count !== 1 ? "s" : ""}` : ""}`}
                  data-testid={`reaction-${type}`}
                >
                  <span className="select-none">{config.emoji}</span>
                  {count > 0 && (
                    <span className="ml-1 text-xs font-semibold">{count}</span>
                  )}
                </button>
              );
            })}
            <div className="mx-1 h-4 w-px bg-theme-bg-tertiary" />
          </div>
        )}

        <Button
          disabled={isCopied}
          onClick={() => {
            void handleCopy();
          }}
          variant="icon-only"
          icon={
            isCopied ? (
              <CheckIcon className="text-theme-success-fg" />
            ) : (
              <CopyIcon />
            )
          }
          size="sm"
          aria-label={isCopied ? "Copied" : "Copy message"}
          title={isCopied ? "Copied" : "Copy message"}
        />

        {isUserMessage && canEditChat && !context.isSharedDialog && (
          <Button
            onClick={() => {
              void handleEdit();
            }}
            variant="icon-only"
            icon={<EditIcon />}
            size="sm"
            aria-label="Edit message"
            title="Edit message"
          />
        )}

        {!isUserMessage && (
          <Button
            onClick={() => {
              void handleRegenerate();
            }}
            variant="icon-only"
            icon={
              <svg className="size-4" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 12C4 7.58172 7.58172 4 12 4C14.5264 4 16.7793 5.17107 18.2454 7M20 12C20 16.4183 16.4183 20 12 20C9.47362 20 7.22075 18.8289 5.75463 17"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M18 3V7H14M6 21V17H10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
            size="sm"
            aria-label="Regenerate response"
            title="Regenerate response"
          />
        )}

        {/* More Actions Dropdown */}
        <DropdownMenu
          items={filteredDropdownItems}
          triggerIcon={<MoreVertical className="size-4" />}
          align="right"
        />
      </div>

      {!isUserMessage && (
        <div className="mx-2 flex items-center gap-2 text-xs text-theme-fg-muted">
          {metadata.model && (
            <span
              className="rounded-full border border-theme-border-primary bg-theme-bg-secondary px-2 py-0.5"
              title="Model used"
            >
              {metadata.model}
            </span>
          )}

          {metadata.tokens !== undefined && metadata.tokens > 0 && (
            <span
              className="rounded-full border border-theme-border-primary bg-theme-bg-secondary px-2 py-0.5"
              title="Tokens used"
            >
              {metadata.tokens.toLocaleString()} tokens
            </span>
          )}

          {metadata.processingTime !== undefined &&
            metadata.processingTime > 0 && (
              <span
                className="rounded-full border border-theme-border-primary bg-theme-bg-secondary px-2 py-0.5"
                title="Processing time"
              >
                {metadata.processingTime.toFixed(1)}s
              </span>
            )}

          {metadata.hasToolCalls && (
            <span
              className="rounded-full border border-blue-400 bg-blue-500/10 px-2 py-0.5 text-blue-600"
              title="Used tools"
            >
              🔧 Tools
            </span>
          )}

          {metadata.fileCount !== undefined && metadata.fileCount > 0 && (
            <span
              className="rounded-full border border-purple-400 bg-purple-500/10 px-2 py-0.5 text-purple-600"
              title="File attachments"
            >
              📎 {metadata.fileCount}
            </span>
          )}
        </div>
      )}

      <div className="h-4 w-px bg-theme-bg-tertiary" />

      <MessageTimestamp createdAt={safeCreatedAt} />
    </div>
  );
};
