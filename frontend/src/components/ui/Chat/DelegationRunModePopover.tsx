import { t } from "@lingui/core/macro";
import { useEffect, useRef } from "react";

import { useRovingMenuFocus } from "@/hooks/ui/useRovingMenuFocus";

import { ADD_MENU_ITEM_SELECTOR, AddMenuActionRow } from "./ChatInputAddMenu";
import { AnchoredPopover } from "../Controls/AnchoredPopover";
import { PopoverChrome, PopoverSectionHeader } from "../Controls/PopoverPanel";

import type { DelegationRunMode } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface DelegationRunModePopoverProps {
  isOpen: boolean;
  /**
   * `undefined` means "wait for the answer" — the wire default, so the
   * request omits the field entirely.
   */
  onChoose: (runMode?: DelegationRunMode) => void;
  /** The send (or queue) is abandoned; the draft stays in the composer. */
  onCancel: () => void;
}

/**
 * Asks whether a send that @-mentions assistants should wait for the
 * delegates' answers or run them in the background, before the request leaves
 * the browser.
 *
 * Keyboard contract: the popover opens from the send gesture, so Enter — the
 * send muscle memory — resolves to "wait", the safe default: the popover opens
 * with that option focused, and an Enter that lands anywhere else in the panel
 * is caught below. Escape (and clicking away) cancels the send entirely and
 * leaves the draft untouched.
 *
 * The choice is deliberately asked on every mentioned send, never remembered:
 * the error costs are asymmetric. A wrongly backgrounded run produces a
 * confidently wrong answer built without the delegate's result, while wrongly
 * waiting merely costs time — so a persisted "background" default must not
 * fire silently. Revisit as an explicit setting.
 */
export function DelegationRunModePopover({
  isOpen,
  onChoose,
  onCancel,
}: DelegationRunModePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useRovingMenuFocus({
    containerRef: panelRef,
    enabled: isOpen,
    itemSelector: ADD_MENU_ITEM_SELECTOR,
  });

  // Focus the "wait" row one frame after opening (the panel is positioned
  // before paint, but the rows exist only after the portal mounts), so the
  // Enter still travelling from the send gesture activates the safe default.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const waitRow = panelRef.current?.querySelector<HTMLElement>(
        '[data-testid="chat-input-delegation-run-mode-wait"]',
      );
      waitRow?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  // Belt for an Enter that reaches the panel while no row is focused (e.g.
  // after clicking the header): resolve to "wait" rather than doing nothing.
  // Enter on a focused row is native button activation and is not intercepted,
  // so arrowing to "background" and confirming still works.
  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      return;
    }
    event.preventDefault();
    onChoose(undefined);
  };

  return (
    <AnchoredPopover
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      panelRef={panelRef}
      role="menu"
      preferredOrientation={{ vertical: "top", horizontal: "right" }}
      width="wide"
      dataUi="chat-input-delegation-run-mode-menu"
      manageFocus={false}
      ariaLabel={t({
        id: "chatInput.delegationRunMode.title",
        message: "How should mentioned assistants run?",
      })}
      // The anchor is geometry, not a control: the popover opens from the send
      // gesture, so the anchor stays out of the a11y tree and the panel is
      // named directly instead.
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          data-testid="chat-input-delegation-run-mode-anchor"
        />
      )}
    >
      <PopoverChrome
        onKeyDown={handlePanelKeyDown}
        dataUi="chat-input-delegation-run-mode-content"
        data-testid="chat-input-delegation-run-mode"
      >
        <PopoverSectionHeader>
          {t({
            id: "chatInput.delegationRunMode.title",
            message: "How should mentioned assistants run?",
          })}
        </PopoverSectionHeader>
        <AddMenuActionRow
          label={t({
            id: "chatInput.delegationRunMode.wait.label",
            message: "Wait for the answer",
          })}
          description={t({
            id: "chatInput.delegationRunMode.wait.description",
            message: "The answer arrives in this conversation.",
          })}
          testId="chat-input-delegation-run-mode-wait"
          onActivate={() => onChoose(undefined)}
        />
        <AddMenuActionRow
          label={t({
            id: "chatInput.delegationRunMode.background.label",
            message: "Run in the background",
          })}
          description={t({
            id: "chatInput.delegationRunMode.background.description",
            message:
              "The answer will not arrive in this conversation; it stays in a separate chat.",
          })}
          testId="chat-input-delegation-run-mode-background"
          onActivate={() => onChoose("background")}
        />
      </PopoverChrome>
    </AnchoredPopover>
  );
}
