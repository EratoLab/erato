import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";

import { Input } from "@/components/ui/Input/Input";
import { useFuzzySearch } from "@/hooks/search/useFuzzySearch";

import { Card } from "../Container/Card";
import { Row } from "../Controls/Row";
import { ModalBase } from "../Modal/ModalBase";

import type { AssistantToolsMenuDescriptionDisplay } from "@/app/env";
import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";
import type React from "react";

const SEARCH_KEYS = ["name", "description"];

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
  /**
   * The ones the user turns to most, listed first while nothing is searched;
   * the same list the "@" picker opens with.
   */
  suggested?: MentionableAssistant[];
  /** How much of each description shows, as in the composer's menus. */
  descriptionDisplay?: AssistantToolsMenuDescriptionDisplay;
  onSelect: (assistant: MentionableAssistant) => void;
}

/**
 * The assistant dialog behind the composer's "Ask an assistant…" row: every
 * accessible assistant, the ones the user turns to most first. Picking one
 * mentions it, as typing "@" does; the chat itself keeps its assistant.
 * Filtering is client-side over names and descriptions: the list is already
 * loaded for the picker, so a round trip per keystroke would only add latency.
 */
export function AssistantBrowserModal({
  isOpen,
  onClose,
  assistants,
  suggested = [],
  descriptionDisplay = "truncated",
  onSelect,
}: AssistantBrowserModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // Without a query the search hands the list back as it is, so this order
  // is what an empty search shows.
  const orderedAssistants = useMemo(() => {
    const suggestedIds = new Set(suggested.map((assistant) => assistant.id));
    return [
      ...suggested,
      ...assistants.filter((assistant) => !suggestedIds.has(assistant.id)),
    ];
  }, [assistants, suggested]);
  const matches = useFuzzySearch({
    items: orderedAssistants,
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
        id: "chatInput.mentions.dialogTitle",
        message: "Ask an assistant",
      })}
      contentClassName="max-w-lg"
    >
      <p className="mb-3 text-sm text-theme-fg-secondary">
        {t({
          id: "chatInput.mentions.dialogDescription",
          message:
            "Hands your message to the assistant you pick. This chat stays as it is.",
        })}
      </p>
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
                {assistant.description && descriptionDisplay !== "none" && (
                  <span
                    className={clsx(
                      "w-full text-sm text-theme-fg-secondary",
                      descriptionDisplay === "truncated" && "truncate",
                    )}
                  >
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
