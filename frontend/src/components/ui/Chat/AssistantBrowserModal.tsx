import { t } from "@lingui/core/macro";
import { useCallback, useState } from "react";

import { Input } from "@/components/ui/Input/Input";
import { useFuzzySearch } from "@/hooks/search/useFuzzySearch";

import { Card } from "../Container/Card";
import { Row } from "../Controls/Row";
import { ModalBase } from "../Modal/ModalBase";

import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";
import type React from "react";

const SEARCH_KEYS = ["name"];

// No fill of its own — the well sits on the modal shell. The inset is off the
// size scale and is what publishes the concentric corner the rows read.
const WELL_CARD_STYLE = {
  "--card-bg": "transparent",
  // eslint-disable-next-line lingui/no-unlocalized-strings
  "--card-inset": "0.25rem",
} as React.CSSProperties;

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
  const matches = useFuzzySearch({
    items: assistants,
    keys: SEARCH_KEYS,
    query: searchQuery,
    // A single character is a legitimate filter here: the list is short and the
    // user is narrowing it, not searching prose.
    minMatchCharLength: 1,
  });

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
          type="search"
          // Focused in the opening commit, so a key typed right after opening
          // cannot reach the composer behind the overlay.
          autoFocus // eslint-disable-line jsx-a11y/no-autofocus -- the dialog exists to search
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

      <Card
        variant="surface"
        className="max-h-64 overflow-y-auto"
        style={WELL_CARD_STYLE}
      >
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
          // Inset by the row corner rather than divided by hairlines: once a
          // row paints a rounded hover fill, a full-bleed rule between two of
          // them cuts across the corner it just drew.
          <div className="flex flex-col gap-0.5">
            {matches.map((assistant) => (
              <Row
                key={assistant.id}
                variant="list"
                onClick={() => handleSelect(assistant)}
                data-testid={`chat-input-mention-browse-option-${assistant.id}`}
                className="w-full flex-col items-start gap-1 px-3 py-2"
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
              </Row>
            ))}
          </div>
        )}
      </Card>
    </ModalBase>
  );
}
