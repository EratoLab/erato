import { plural, t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import {
  McpToolDecisionControl,
  mcpToolDecisionLabel,
  mcpToolDecisionUnavailableReason,
  mcpToolDecisionUnavailableText,
} from "./McpToolDecisionControl";
import { McpToolGroup } from "./McpToolGroup";
import { McpToolRow } from "./McpToolRow";
import {
  MCP_TOOL_DECISIONS,
  groupChoiceChanges,
  groupCommonDecision,
  planDecisionChanges,
  decisionOfEffective,
} from "./mcpToolDecisions";
import { groupMcpTools, mcpToolGroupLabel } from "./mcpToolGroups";
import { DropdownMenu } from "../Controls/DropdownMenu";
import {
  CheckIcon,
  ChevronDownIcon,
  HandIcon,
  ProhibitionIcon,
} from "../icons";

import type {
  McpToolDecision,
  McpToolDecisionAvailability,
  McpToolDecisionChange,
  McpToolGroupChoice,
} from "./mcpToolDecisions";
import type { McpToolGroupKey } from "./mcpToolGroups";
import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

/** How long a group's skip note stays before the header line is clean again. */
const NOTE_LIFETIME_MS = 6000;

const ICONS: Record<McpToolDecision, ReactNode> = {
  allow: <CheckIcon className="size-4" />,
  ask: <HandIcon className="size-4" />,
  never: <ProhibitionIcon className="size-4" />,
};

const groupDescription = (decision: McpToolDecision): string => {
  switch (decision) {
    case "allow":
      return t({
        id: "preferences.dialog.mcpServers.approvals.group.allow.description",
        message: "Runs every tool in this group without asking.",
      });
    case "ask":
      return t({
        id: "preferences.dialog.mcpServers.approvals.group.ask.description",
        message: "Asks you before each run of these tools.",
      });
    case "never":
      return t({
        id: "preferences.dialog.mcpServers.approvals.group.never.description",
        message: "Keeps these tools away from the assistant.",
      });
  }
};

// The placeholder must stay `count`: component-kit catalogs merge last and
// format these ids with {count, plural, …}.
const skippedNote = (decision: McpToolDecision, count: number): string =>
  decision === "allow"
    ? t({
        id: "preferences.dialog.mcpServers.approvals.group.skipped.allow",
        message: plural(count, {
          one: "# tool skipped: Always allow is switched off by the approval policy.",
          other:
            "# tools skipped: Always allow is switched off by the approval policy.",
        }),
      })
    : t({
        id: "preferences.dialog.mcpServers.approvals.group.skipped.ask",
        message: plural(count, {
          one: "# tool skipped: asking before a run is switched off by the approval policy.",
          other:
            "# tools skipped: asking before a run is switched off by the approval policy.",
        }),
      });

function McpToolGroupDecision({
  group,
  tools,
  availability,
  disabled,
  onChoose,
}: {
  group: McpToolGroupKey;
  tools: McpServerTool[];
  availability: McpToolDecisionAvailability;
  disabled: boolean;
  onChoose: (choice: McpToolGroupChoice) => void;
}) {
  const common = groupCommonDecision(tools);
  const groupLabel = mcpToolGroupLabel(group);
  const stateLabel =
    common === "mixed"
      ? t({
          id: "preferences.dialog.mcpServers.approvals.group.mixed",
          message: "Mixed",
        })
      : mcpToolDecisionLabel(common);

  const items: DropdownMenuItem[] = MCP_TOOL_DECISIONS.map((decision) => {
    // A state no tool in the group can take is offered as unavailable, with
    // the reason; where some can, the menu applies it to those and the
    // roster says what it skipped.
    const applicable = tools.filter(
      (tool) =>
        mcpToolDecisionUnavailableReason(
          decision,
          tool.policy,
          availability,
        ) === null,
    );
    const reason =
      applicable.length === 0 && decision !== "never"
        ? mcpToolDecisionUnavailableText(decision)
        : null;
    return {
      id: decision,
      label: mcpToolDecisionLabel(decision),
      icon: ICONS[decision],
      description: reason ?? groupDescription(decision),
      checked: common === decision,
      disabled: disabled || applicable.length === 0,
      onClick: () => onChoose(decision),
    };
  });
  items.push({
    id: "default",
    label: t({
      id: "preferences.dialog.mcpServers.approvals.group.default.label",
      message: "Policy default",
    }),
    description: t({
      id: "preferences.dialog.mcpServers.approvals.group.default.description",
      message: "Forgets your decisions for these tools.",
    }),
    disabled,
    onClick: () => onChoose("default"),
  });

  return (
    <DropdownMenu
      items={items}
      align="right"
      triggerButtonVariant="secondary"
      triggerButtonClassName="gap-1.5"
      triggerAriaLabel={t({
        id: "preferences.dialog.mcpServers.approvals.group.triggerLabel",
        message: `${groupLabel}: ${stateLabel}`,
      })}
      dataUi="mcp-tool-group-decision"
      triggerIcon={
        <>
          {common === "mixed" ? null : (
            <span aria-hidden="true" className="shrink-0">
              {ICONS[common]}
            </span>
          )}
          <span className="text-xs">{stateLabel}</span>
          <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
        </>
      }
    />
  );
}

export interface McpToolPermissionsRosterProps {
  tools: McpServerTool[];
  availability: McpToolDecisionAvailability;
  /**
   * Applies the changes the roster planned. The roster has already left out
   * every tool whose target the deployment cannot store, so the batch is
   * sendable as is.
   */
  onApply: (changes: McpToolDecisionChange[]) => void;
  /** A batch is in flight; the controls wait for it. */
  pending?: boolean;
}

/**
 * The server's tools in their two annotation groups, each row with the
 * three-state control and each group with a decision menu that moves every
 * row at once. Everything shown is the backend's word: the group a tool sits
 * in is its normalized annotation, the checked state is its effective state,
 * and an option is unavailable exactly where the deployment flags say so.
 */
export function McpToolPermissionsRoster({
  tools,
  availability,
  onApply,
  pending = false,
}: McpToolPermissionsRosterProps) {
  const [notes, setNotes] = useState<Partial<Record<McpToolGroupKey, string>>>(
    {},
  );
  const noteTimers = useRef(new Map<McpToolGroupKey, NodeJS.Timeout>());

  useEffect(() => {
    const timers = noteTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const showNote = (group: McpToolGroupKey, note: string) => {
    const previous = noteTimers.current.get(group);
    if (previous) {
      clearTimeout(previous);
    }
    setNotes((current) => ({ ...current, [group]: note }));
    noteTimers.current.set(
      group,
      setTimeout(() => {
        noteTimers.current.delete(group);
        setNotes((current) => ({ ...current, [group]: undefined }));
      }, NOTE_LIFETIME_MS),
    );
  };

  const chooseForGroup = (
    group: McpToolGroupKey,
    groupTools: McpServerTool[],
    choice: McpToolGroupChoice,
  ) => {
    const changes = groupChoiceChanges(groupTools, choice);
    const plan = planDecisionChanges(changes, availability);
    if (plan.skipped.length > 0 && choice !== "default") {
      showNote(group, skippedNote(choice, plan.skipped.length));
    }
    onApply(changes.filter((change) => plan.projected.has(change.tool.name)));
  };

  return (
    <div className="space-y-4" data-testid="mcp-tool-permissions-roster">
      {groupMcpTools(tools).map(({ key, tools: groupTools }) => (
        <McpToolGroup
          key={key}
          group={key}
          count={groupTools.length}
          data-testid="mcp-tool-group"
          note={notes[key]}
          action={
            <McpToolGroupDecision
              group={key}
              tools={groupTools}
              availability={availability}
              disabled={pending}
              onChoose={(choice) => chooseForGroup(key, groupTools, choice)}
            />
          }
        >
          {groupTools.map((tool) => (
            <McpToolRow
              key={tool.name}
              as="li"
              tool={tool}
              data-testid="mcp-tool-approval-row"
              control={
                <McpToolDecisionControl
                  value={decisionOfEffective(tool.effective)}
                  policy={tool.policy}
                  availability={availability}
                  disabled={pending}
                  aria-label={tool.title}
                  onChange={(next) => onApply([{ tool, next }])}
                />
              }
            />
          ))}
        </McpToolGroup>
      ))}
    </div>
  );
}
