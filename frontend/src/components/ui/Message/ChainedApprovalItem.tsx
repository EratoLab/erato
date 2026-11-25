import { t } from "@lingui/core/macro";

import { approvalDisplayOf } from "@/lib/toolCallGist/approvalCard";
import {
  alwaysAllowLockedLine,
  thisToolLabel,
  toolDenyLabel,
} from "@/lib/toolCallGist/decisionLabels";

import { ActionConfirmationCard } from "./ActionConfirmationCard";

import type { ActionConfirmationStatus } from "./ActionConfirmationCard";
import type { ApprovalItemPart } from "./approvalItems";
import type { ToolApprovalDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

/**
 * The generic card for a call the server made itself to apply a change the
 * user's app checked and accepted: the change's title and summary as the
 * server has them, and the decision.
 *
 * Only the app that prepared the change can make it. Where the tool cannot
 * run, the card says where to go and offers no approval; denying works
 * anywhere.
 */
export const ChainedApprovalItem = ({
  item,
  runsHere,
  allowAlways,
  note,
  status,
  resolvedLabel,
  isBusy,
  scrollIntoViewOnMount,
  onDecide,
}: {
  item: ApprovalItemPart;
  /** The tool has an executor in this client. */
  runsHere: boolean;
  allowAlways: boolean;
  /** A host's own line, such as why its review is gone. */
  note?: ReactNode;
  status: ActionConfirmationStatus;
  resolvedLabel: string | undefined;
  isBusy: boolean;
  scrollIntoViewOnMount: boolean;
  onDecide: (decision: ToolApprovalDecision) => void;
}) => {
  const display = approvalDisplayOf(item.display, item.tool_name);
  const title = display?.title ?? item.tool_name;
  const summary = display?.description ?? undefined;
  // A card that needs a choice on screen never offers Always: the next
  // change would need that choice too.
  const onScreen = item.follows?.decide_on_screen === true;
  const offersAlways = runsHere && !onScreen;
  return (
    <div
      className="space-y-1"
      data-testid="chained-approval-item"
      data-runs-here={runsHere}
    >
      <p
        dir="auto"
        className="text-sm font-medium text-theme-fg-primary [overflow-wrap:anywhere]"
      >
        {title}
      </p>
      {summary ? (
        <p
          dir="auto"
          className="text-sm text-theme-fg-secondary [overflow-wrap:anywhere]"
        >
          {summary}
        </p>
      ) : null}
      {note ? (
        <div
          className="text-sm text-theme-fg-secondary"
          data-testid="chained-approval-note"
        >
          {note}
        </div>
      ) : null}
      {!runsHere ? (
        <p
          className="text-sm text-theme-fg-secondary"
          data-testid="chained-approval-elsewhere"
        >
          {t({
            id: "chainedApproval.elsewhere",
            message:
              "Open the Erato pane where this change was prepared to apply it.",
          })}
        </p>
      ) : null}
      <ActionConfirmationCard
        title={t({
          id: "chainedApproval.title",
          message: "Allow this change?",
        })}
        onAllowOnce={runsHere ? () => onDecide("approve") : undefined}
        standingLabel={thisToolLabel()}
        standingNote={
          offersAlways && !allowAlways ? alwaysAllowLockedLine() : undefined
        }
        onAlwaysAllow={
          // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
          offersAlways ? () => onDecide("approve_always") : undefined
        }
        alwaysAllowDisabledReason={
          offersAlways && !allowAlways ? alwaysAllowLockedLine() : undefined
        }
        onDeny={() => onDecide("reject")}
        denyLabel={toolDenyLabel()}
        // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
        onNeverAllow={() => onDecide("reject_always")}
        status={status}
        resolvedLabel={resolvedLabel}
        isBusy={isBusy}
        scrollIntoViewOnMount={scrollIntoViewOnMount}
        data-testid="mcp-tool-approval-card"
      />
    </div>
  );
};
