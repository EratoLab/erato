import { t } from "@lingui/core/macro";

import { archivedNoticeText } from "@/components/ui/Chat/chatArchiveActions";
import { isApprovalDecision } from "@/lib/toolApprovalDecisions";

import { Button } from "../Controls/Button";

import type { ActionConfirmationStatus } from "./ActionConfirmationCard";
import type { ToolApprovalDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The shell every approval card renders in. Shared as a class list rather than
 * a component: the `mcp_tool` layout carries `data-tool-name` and no kind or
 * item count, and the per-item cards space their rows out themselves.
 */
export const APPROVAL_CARD_SHELL_CLASS =
  "my-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary p-3";

/**
 * What a row says once it has been answered but not yet sent.
 *
 * The server requires one request to cover every open item, so a card with
 * several rows holds the answers until the last row is decided. A row that
 * just says "denied" would read as done and leave the user waiting for a turn
 * that has not been asked to continue yet.
 */
export const stagedDecisionLabel = (decision: ToolApprovalDecision): string =>
  isApprovalDecision(decision)
    ? t({
        id: "toolApproval.staged.allowed",
        message: "Allowed — sent once every item is decided",
      })
    : t({
        id: "toolApproval.staged.denied",
        message: "Denied — sent once every item is decided",
      });

/**
 * How one row of a per-item card reads: held answer first, then the archive
 * notice, then the question still being asked.
 *
 * Status and label are decided together so they cannot disagree about whether
 * a held answer was an allow or a denial.
 */
export const stagedItemPresentation = (
  staged: ToolApprovalDecision | undefined,
  isArchived: boolean,
): { status: ActionConfirmationStatus; resolvedLabel: string | undefined } => {
  if (staged !== undefined) {
    return {
      status: isApprovalDecision(staged) ? "confirmed" : "dismissed",
      resolvedLabel: stagedDecisionLabel(staged),
    };
  }
  if (isArchived) {
    return { status: "dismissed", resolvedLabel: archivedNoticeText() };
  }
  return { status: "pending", resolvedLabel: undefined };
};

/**
 * The answers that apply to the whole stop: one for all of it, or a withdrawal.
 *
 * Withdraw is a decision value, not a cancellation: every open item is denied
 * with `reason: "withdrawn"` and the turn goes on with those denials. The copy
 * has to say so, or it reads as a way to call the turn off.
 */
export const ApprovalBulkActions = ({
  itemCount,
  onDecideAll,
  isBusy,
  testId,
}: {
  itemCount: number;
  onDecideAll: (decision: ToolApprovalDecision) => void;
  isBusy: boolean;
  testId: string;
}) => (
  <div className="space-y-1" data-testid={testId}>
    <div className="flex flex-wrap gap-2">
      {itemCount > 1 && (
        <>
          <Button
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => onDecideAll("approve")}
            data-testid="tool-approval-allow-all"
          >
            {t({ id: "toolApproval.allowAll", message: "Allow all" })}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => onDecideAll("reject")}
            data-testid="tool-approval-deny-all"
          >
            {t({ id: "toolApproval.denyAll", message: "Deny all" })}
          </Button>
        </>
      )}
      <Button
        variant="secondary"
        size="sm"
        disabled={isBusy}
        onClick={() => onDecideAll("withdraw")}
        data-testid="tool-approval-withdraw"
      >
        {t({ id: "toolApproval.withdraw", message: "Withdraw" })}
      </Button>
    </div>
    <p className="text-xs text-theme-fg-muted">
      {t({
        id: "toolApproval.withdraw.hint",
        message:
          "Withdrawing denies everything still open; the assistant answers with what it has.",
      })}
    </p>
  </div>
);
