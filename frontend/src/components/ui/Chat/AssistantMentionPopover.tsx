import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useImperativeHandle, useRef } from "react";

import { useRovingMenuFocus } from "@/hooks/ui/useRovingMenuFocus";

import { ADD_MENU_ITEM_SELECTOR } from "./ChatInputAddMenu";
import { AnchoredPopover } from "../Controls/AnchoredPopover";
import { PopoverChrome, PopoverSeparator } from "../Controls/PopoverPanel";
import { Row } from "../Controls/Row";

import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";

export interface AssistantMentionPopoverHandle {
  /**
   * True when the open picker consumed the key, in which case the composer
   * must not act on it — notably Enter, which would otherwise send.
   */
  handleComposerKeyDown: (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => boolean;
}

export interface AssistantMentionPopoverProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  assistants: MentionableAssistant[];
  onSelect: (assistant: MentionableAssistant) => void;
  onBrowse: () => void;
  /**
   * Called when the panel closes while it holds focus, which only happens after
   * the user arrowed into it. Focus belongs back in the composer.
   */
  onRestoreFocus: () => void;
  ref?: Ref<AssistantMentionPopoverHandle>;
}

/**
 * Suggestion list for an in-progress `@` mention. The panel is anchored to the
 * composer shell rather than the caret: `AnchoredPopover` measures a real
 * button, and a caret has no element to measure.
 *
 * Unlike every other popover, this one opens while the user is typing, so it
 * must leave the caret alone: `manageFocus` is off and focus only ever enters
 * the panel on an explicit arrow key.
 */
export function AssistantMentionPopover({
  isOpen,
  onOpenChange,
  assistants,
  onSelect,
  onBrowse,
  onRestoreFocus,
  ref,
}: AssistantMentionPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const panelHasFocusRef = useRef(false);
  const wasOpenRef = useRef(false);
  const { focusEdge } = useRovingMenuFocus({
    containerRef: panelRef,
    enabled: isOpen,
    itemSelector: ADD_MENU_ITEM_SELECTOR,
  });

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      panelHasFocusRef.current = false;
    }
    if (!isOpen && wasOpenRef.current && panelHasFocusRef.current) {
      panelHasFocusRef.current = false;
      onRestoreFocus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, onRestoreFocus]);

  const handleComposerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (!isOpen) {
        return false;
      }
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusEdge("first");
          return true;
        case "ArrowUp":
          event.preventDefault();
          focusEdge("last");
          return true;
        case "Enter":
        case "Tab": {
          if (event.shiftKey || assistants.length === 0) {
            return false;
          }
          event.preventDefault();
          onSelect(assistants[0]);
          return true;
        }
        case "Escape":
          event.preventDefault();
          onOpenChange(false);
          return true;
        default:
          return false;
      }
    },
    [assistants, focusEdge, isOpen, onOpenChange, onSelect],
  );

  useImperativeHandle(ref, () => ({ handleComposerKeyDown }), [
    handleComposerKeyDown,
  ]);

  // Enter already activates the focused row natively; Tab is the mention
  // convention for "take this one" and would otherwise leave the panel.
  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || event.shiftKey) {
      return;
    }
    const focusedRow = document.activeElement;
    if (
      focusedRow instanceof HTMLElement &&
      panelRef.current?.contains(focusedRow)
    ) {
      event.preventDefault();
      focusedRow.click();
    }
  };

  return (
    <AnchoredPopover
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      panelRef={panelRef}
      role="menu"
      ariaHasPopup="menu"
      preferredOrientation={{ vertical: "top", horizontal: "left" }}
      width="wide"
      dataUi="chat-input-mention-menu"
      manageFocus={false}
      ariaLabel={t({
        id: "chatInput.mentions.pickerLabel",
        message: "Assistant suggestions",
      })}
      // The anchor is geometry, not a control: it is never focused and
      // activating it would do nothing, so it stays out of the a11y tree and
      // the panel is named directly instead.
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          data-testid="chat-input-mention-anchor"
        />
      )}
    >
      <PopoverChrome
        onKeyDown={handlePanelKeyDown}
        onFocus={() => {
          panelHasFocusRef.current = true;
        }}
        dataUi="chat-input-mention-menu-content"
      >
        {assistants.map((assistant) => (
          <Row
            key={assistant.id}
            variant="menu"
            role="menuitem"
            tabIndex={-1}
            data-testid={`chat-input-mention-option-${assistant.id}`}
            onClick={() => onSelect(assistant)}
          >
            {/* The body is written out rather than handed to Row's
                `description` slot: the name truncates whether or not the
                assistant has a description, and Row drops the wrapper when
                there is none. */}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{assistant.name}</span>
              {assistant.description && (
                <span className="block truncate text-xs text-theme-fg-muted">
                  {assistant.description}
                </span>
              )}
            </span>
          </Row>
        ))}
        <PopoverSeparator />
        <Row
          variant="menu"
          role="menuitem"
          tabIndex={-1}
          data-testid="chat-input-mention-browse"
          onClick={onBrowse}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              {t({
                id: "chatInput.mentions.browse",
                message: "Browse assistants…",
              })}
            </span>
          </span>
        </Row>
      </PopoverChrome>
    </AnchoredPopover>
  );
}
