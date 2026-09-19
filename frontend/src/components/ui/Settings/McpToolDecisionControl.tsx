import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useRef, useState } from "react";

import {
  MCP_TOOL_DECISIONS,
  offeredDecisions,
  policyDefault,
} from "./mcpToolDecisions";
import { Tooltip } from "../Controls/Tooltip";
import { CheckIcon, HandIcon, ProhibitionIcon } from "../icons";

import type {
  McpToolDecision,
  McpToolDecisionAvailability,
} from "./mcpToolDecisions";
import type { McpServerToolPolicy } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";

const ICONS: Record<McpToolDecision, ReactNode> = {
  allow: <CheckIcon className="size-4" />,
  ask: <HandIcon className="size-4" />,
  never: <ProhibitionIcon className="size-4" />,
};

/** The short name of each state, shared by the row control and the group menu. */
export const mcpToolDecisionLabel = (decision: McpToolDecision): string => {
  switch (decision) {
    case "allow":
      // Named as the in-chat card names it: the same standing grant.
      return t({
        id: "preferences.dialog.mcpServers.approvals.allow.label",
        message: "Always allow",
      });
    case "ask":
      return t({
        id: "preferences.dialog.mcpServers.approvals.ask.label",
        message: "Ask each time",
      });
    case "never":
      return t({
        id: "preferences.dialog.mcpServers.approvals.never.label",
        message: "Never allow",
      });
  }
};

/** Why the deployment does not store this decision. */
export const mcpToolDecisionUnavailableText = (
  decision: Exclude<McpToolDecision, "never">,
): string =>
  decision === "allow"
    ? t({
        id: "preferences.dialog.mcpServers.approvals.allow.unavailable",
        message: "Always allow is switched off by the approval policy.",
      })
    : t({
        id: "preferences.dialog.mcpServers.approvals.ask.unavailable",
        message: "Asking before a run is switched off by the approval policy.",
      });

/** Why a state cannot be stored for this tool, or null while it can. */
export const mcpToolDecisionUnavailableReason = (
  decision: McpToolDecision,
  policy: McpServerToolPolicy,
  availability: McpToolDecisionAvailability,
): string | null =>
  decision === "never" ||
  offeredDecisions(policy, availability).includes(decision)
    ? null
    : mcpToolDecisionUnavailableText(decision);

const defaultLabel = (decision: McpToolDecision): string =>
  decision === "allow"
    ? t({
        id: "preferences.dialog.mcpServers.approvals.allow.defaultLabel",
        message: "Always allow (policy default)",
      })
    : t({
        id: "preferences.dialog.mcpServers.approvals.ask.defaultLabel",
        message: "Ask each time (policy default)",
      });

export interface McpToolDecisionControlProps {
  /** The state the backend reports as effective; never derived here. */
  value: McpToolDecision;
  policy: McpServerToolPolicy;
  availability: McpToolDecisionAvailability;
  onChange: (next: McpToolDecision) => void;
  /** Locks every option, for a decision still in flight. */
  disabled?: boolean;
  /** Accessible name of the group — the tool's title. */
  "aria-label": string;
  "data-testid"?: string;
}

/**
 * The three-state segmented control of a tool row: check = Allow, hand =
 * Ask, ban = Never. A radio group with a roving tab stop: arrows walk the
 * options and Home/End jump to the ends, and the tab stop follows the walk.
 * Landing on an option does not check it — every check is a stored
 * decision and a locked roster until the backend answers, so the walk
 * commits only on Space or Enter, which the buttons turn into a click on
 * their own. An option the deployment does not honor stays in the walk but
 * is `aria-disabled` rather than `disabled`, so its explanatory tooltip is
 * reachable by keyboard as well as by pointer; it is never checked. The
 * option the policy applies on its own carries a small marker and says so
 * in its name.
 */
export function McpToolDecisionControl({
  value,
  policy,
  availability,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  "data-testid": dataTestId,
}: McpToolDecisionControlProps) {
  const refs = useRef(new Map<McpToolDecision, HTMLButtonElement>());
  // The option the walk is on while focus is inside the group; the tab stop
  // sits there so leaving and coming back lands where the walk was.
  const [focused, setFocused] = useState<McpToolDecision | null>(null);
  const isDefault = policyDefault(policy);

  const select = (decision: McpToolDecision) => {
    if (disabled || decision === value) {
      return;
    }
    if (
      mcpToolDecisionUnavailableReason(decision, policy, availability) !== null
    ) {
      return;
    }
    onChange(decision);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const { length } = MCP_TOOL_DECISIONS;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + length) % length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    refs.current.get(MCP_TOOL_DECISIONS[nextIndex])?.focus();
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setFocused(null);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-busy={disabled || undefined}
      data-ui="segmented-radio"
      data-testid={dataTestId}
      onBlur={handleBlur}
      className="tab-rail-geometry tab-rail-track-geometry inline-flex border-theme-border bg-theme-bg-secondary"
    >
      {MCP_TOOL_DECISIONS.map((decision, index) => {
        const isChecked = decision === value;
        const unavailable = mcpToolDecisionUnavailableReason(
          decision,
          policy,
          availability,
        );
        const isPolicyDefault = decision === isDefault;
        const label = isPolicyDefault
          ? defaultLabel(decision)
          : mcpToolDecisionLabel(decision);
        return (
          <Tooltip key={decision} content={unavailable ?? label}>
            <button
              ref={(element) => {
                if (element) {
                  refs.current.set(decision, element);
                } else {
                  refs.current.delete(decision);
                }
              }}
              type="button"
              role="radio"
              aria-checked={isChecked}
              aria-disabled={disabled || unavailable !== null || undefined}
              aria-label={label}
              tabIndex={(focused ?? value) === decision ? 0 : -1}
              data-decision={decision}
              data-policy-default={isPolicyDefault || undefined}
              onFocus={() => setFocused(decision)}
              onClick={() => select(decision)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={clsx(
                "tab-item-geometry theme-transition relative flex items-center justify-center px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
                isChecked
                  ? "bg-theme-bg-selected text-theme-fg-primary shadow-sm"
                  : "text-theme-fg-secondary hover:text-theme-fg-primary",
                unavailable !== null && "cursor-not-allowed opacity-40",
                disabled && unavailable === null && "cursor-wait",
              )}
            >
              <span aria-hidden="true">{ICONS[decision]}</span>
              {isPolicyDefault ? (
                // The visible half of the "(policy default)" in the name.
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 size-1 rounded-full bg-current opacity-60"
                />
              ) : null}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
