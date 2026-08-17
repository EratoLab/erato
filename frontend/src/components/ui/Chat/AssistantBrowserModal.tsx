import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/Input/Input";
import { useFuzzySearch } from "@/hooks/search/useFuzzySearch";

import { ModalBase } from "../Modal/ModalBase";

import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";

const SEARCH_KEYS = ["name", "description"];

export interface AssistantBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  assistants: MentionableAssistant[];
  onSelect: (assistant: MentionableAssistant) => void;
}

/**
 * Full accessible-assistant list behind the picker's "Browse" row. Filtering is
 * client-side: the list is already loaded for the picker, so a round trip per
 * keystroke would only add latency.
 */
export function AssistantBrowserModal({
  isOpen,
  onClose,
  assistants,
  onSelect,
}: AssistantBrowserModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const matches = useFuzzySearch({
    items: assistants,
    keys: SEARCH_KEYS,
    query: searchQuery,
    // A single character is a legitimate filter here: the list is short and the
    // user is narrowing it, not searching prose.
    minMatchCharLength: 1,
  });

  // The surface that opened this dialog is a popover closing in the same
  // interaction, and its focus-return to its own trigger lands after the
  // dialog's. Claiming focus a frame later puts the caret in the search box
  // rather than behind the overlay.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const closeAndReset = useCallback(() => {
    setSearchQuery("");
    onClose();
  }, [onClose]);

  const handleSelect = (assistant: MentionableAssistant) => {
    onSelect(assistant);
    closeAndReset();
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={closeAndReset}
      title={t({
        id: "chatInput.mentions.browseTitle",
        message: "Mention an assistant",
      })}
      contentClassName="max-w-lg"
    >
      {/* Single return keeps the input mounted across every result state, so
          typing never loses focus. */}
      <div className="mb-3">
        <Input
          ref={searchRef}
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t({
            id: "chatInput.mentions.searchPlaceholder",
            message: "Search assistants...",
          })}
          aria-label={t({
            id: "chatInput.mentions.searchPlaceholder",
            message: "Search assistants...",
          })}
          data-testid="chat-input-mention-browse-search"
        />
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-theme-border">
        {matches.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-theme-fg-muted">
              {t({
                id: "chatInput.mentions.noResults",
                message: "No assistants match your search",
              })}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-theme-border">
            {matches.map((assistant) => (
              <button
                key={assistant.id}
                type="button"
                onClick={() => handleSelect(assistant)}
                data-testid={`chat-input-mention-browse-option-${assistant.id}`}
                className="theme-transition focus-ring-tight flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-theme-bg-hover"
              >
                <span className="w-full truncate font-medium text-theme-fg-primary">
                  {assistant.name}
                </span>
                {assistant.description && (
                  <span className="w-full truncate text-sm text-theme-fg-secondary">
                    {assistant.description}
                  </span>
                )}
                {assistant.ownerEmail && (
                  <span className="w-full truncate text-xs text-theme-fg-muted">
                    {assistant.ownerEmail}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </ModalBase>
  );
}
