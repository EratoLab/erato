import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState } from "react";

import { AnchoredPopover } from "../Controls/AnchoredPopover";
import { CheckIcon, LoadingIcon, PlusIcon } from "../icons";

import type React from "react";

/**
 * A one-shot action in the "+" menu — uploading a file, picking a photo,
 * choosing a cloud source. Tapping it runs `onSelect` and closes the menu.
 */
export interface AddMenuActionItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Optional secondary line (e.g. file size, provider hint). */
  description?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * A persistent toggle in the "+" menu — a tool/facet that stays selected.
 * Rendered with a checkmark; the menu stays open after toggling so several
 * can be flipped in one pass.
 */
export interface AddMenuToolItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export interface ChatInputAddMenuProps {
  /** File-source actions (Upload from Computer, Sharepoint, …). */
  fileSources?: AddMenuActionItem[];
  /** Selectable tools / facets, rendered with checkmarks. */
  tools?: AddMenuToolItem[];
  /**
   * Host-injected content rendered as its own section — e.g. the Outlook
   * email-content accordion. This is the seam that lets a host contribute
   * extra sources without replacing the whole menu.
   */
  extraSection?: React.ReactNode;
  /** Disable the whole trigger. */
  disabled?: boolean;
  /** Show a spinner in the trigger while files are uploading/linking. */
  isProcessing?: boolean;
  /**
   * Count badge shown on the "+" trigger (mobile affordance for active
   * tools when chips are hidden). No badge when 0 or undefined.
   */
  selectedCount?: number;
  className?: string;
}

const sectionDivider = "my-1 h-px bg-theme-border";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-theme-fg-muted">
      {children}
    </div>
  );
}

/**
 * Unified "+" menu for the chat input. Presentational and prop-driven so it
 * can be exercised in isolation (Storybook/tests) without providers. The
 * container decides *what* goes in each section; this component owns only the
 * trigger, the popover, and the row/section layout.
 */
export function ChatInputAddMenu({
  fileSources = [],
  tools = [],
  extraSection,
  disabled = false,
  isProcessing = false,
  selectedCount = 0,
  className = "",
}: ChatInputAddMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  const isBusy = disabled || isProcessing;
  const hasFileSources = fileSources.length > 0;
  const hasTools = tools.length > 0;
  const showBadge = selectedCount > 0;

  // Each section that renders gets a leading divider once something precedes
  // it, so the menu reads as grouped without dangling rules.
  const sectionsBeforeTools = hasFileSources || extraSection != null;
  const sectionsBeforeExtra = hasFileSources;

  return (
    <AnchoredPopover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      ariaHasPopup="menu"
      role="menu"
      preferredOrientation={{ vertical: "top", horizontal: "left" }}
      initialFocusSelector="button:not(:disabled)"
      panelClassName="w-[min(20rem,calc(100vw-16px))] overflow-y-auto p-1"
      dataUi="chat-input-add-menu"
      trigger={(triggerProps) => (
        <button
          ref={triggerProps.ref}
          id={triggerProps.id}
          type={triggerProps.type}
          onClick={triggerProps.onClick}
          disabled={isBusy}
          aria-label={t({
            id: "chatInput.addMenu.trigger",
            message: "Add files and tools",
          })}
          aria-expanded={triggerProps["aria-expanded"]}
          aria-haspopup={triggerProps["aria-haspopup"]}
          aria-controls={triggerProps["aria-controls"]}
          data-testid="chat-input-add-menu-trigger"
          className={clsx(
            "relative inline-flex size-9 items-center justify-center rounded-md",
            "text-theme-fg-secondary transition-colors hover:bg-theme-bg-hover",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {isProcessing ? (
            <LoadingIcon className="size-5 animate-spin" />
          ) : (
            <PlusIcon className="size-5" />
          )}
          {showBadge && !isProcessing && (
            <span
              data-testid="chat-input-add-menu-badge"
              className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-theme-action-primary-bg px-1 text-[10px] font-semibold leading-4 text-theme-action-primary-fg"
            >
              {selectedCount}
            </span>
          )}
        </button>
      )}
    >
      <div className="flex flex-col" data-ui="chat-input-add-menu-content">
        {hasFileSources && (
          <div className="flex flex-col">
            {fileSources.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onSelect();
                  setIsOpen(false);
                }}
                disabled={isBusy || item.disabled}
                data-testid={`chat-input-add-menu-source-${item.id}`}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-theme-fg-primary transition-colors hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item.icon && (
                  <span className="flex size-5 shrink-0 items-center justify-center text-theme-fg-secondary">
                    {item.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.description && (
                    <span className="block truncate text-xs text-theme-fg-muted">
                      {item.description}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {extraSection != null && (
          <>
            {sectionsBeforeExtra && <div className={sectionDivider} />}
            <div className="flex flex-col">{extraSection}</div>
          </>
        )}

        {hasTools && (
          <>
            {sectionsBeforeTools && <div className={sectionDivider} />}
            <SectionHeader>
              {t({ id: "chatInput.addMenu.toolsHeader", message: "Tools" })}
            </SectionHeader>
            <div className="flex flex-col">
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={tool.checked}
                  onClick={tool.onToggle}
                  disabled={isBusy || tool.disabled}
                  data-testid={`chat-input-add-menu-tool-${tool.id}`}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-theme-fg-primary transition-colors hover:bg-theme-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tool.icon && (
                    <span className="flex size-5 shrink-0 items-center justify-center text-theme-fg-secondary">
                      {tool.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{tool.label}</span>
                  <CheckIcon
                    className={clsx(
                      "size-4 shrink-0 text-theme-fg-accent transition-opacity",
                      tool.checked ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </AnchoredPopover>
  );
}
