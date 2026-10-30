import { plural, select, t } from "@lingui/core/macro";

import { ToolCallInput } from "@/components/ui/ToolCall";
import {
  TASK_BRIEF_PREVIEW_CHARS,
  taskBriefFromInput,
} from "@/lib/delegation/taskBrief";

import { ComputerIcon, ResolvedIcon } from "../icons";
import { ActionConfirmationCard } from "./ActionConfirmationCard";
import { stagedItemPresentation } from "./ApprovalDecisionActions";
import { ApprovalToolHeading } from "./ApprovalToolHeading";

import type { ApprovalItemPart, ApprovalScopeOffer } from "./approvalItems";
import type { ToolApprovalDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const allowScopeLabel = ({ covers }: ApprovalScopeOffer) =>
  t({
    id: "approvalScope.allow",
    message: select(covers, {
      turn: "Allow for this response",
      other: "Allow for this document",
    }),
  });

/**
 * The lines under the scope button: what one decision allows and until when,
 * and the other tasks it answers with this one.
 */
const scopeHint = ({ covers, others }: ApprovalScopeOffer) => (
  <>
    <p>
      {t({
        id: "approvalScope.hint",
        message: select(covers, {
          turn: "Tasks of this response use this tool without asking again until the response is done.",
          other:
            "Tasks in this chat read this document without asking again until it changes outside this chat.",
        }),
      })}
    </p>
    {others > 0 && (
      <p data-testid="approval-scope-others">
        {t({
          id: "approvalScope.others",
          message: select(covers, {
            turn: plural(others, {
              one: "Also covers # other task of this response",
              other: "Also covers # other tasks of this response",
            }),
            other: plural(others, {
              one: "Also covers # other task reading this document",
              other: "Also covers # other tasks reading this document",
            }),
          }),
        })}
      </p>
    )}
  </>
);

/**
 * One parked child: which task it is, and the call it stopped on.
 *
 * The task brief is the only thing that names it — a task child has no
 * assistant of its own — and the tool referent is the child's, never the
 * parent's: what is being decided is a call in another chat, and the
 * `delegate_task` name on the item describes the dispatch, not the tool. A
 * child's call is either an MCP tool's or a client tool's on this device.
 */
export const ParkedChildItem = ({
  item,
  scrollIntoViewOnMount,
  staged,
  allowAlways,
  isArchived,
  isBusy,
  onDecide,
  scopeOffer,
  onDecideScope,
}: {
  item: ApprovalItemPart;
  scrollIntoViewOnMount: boolean;
  staged: ToolApprovalDecision | undefined;
  allowAlways: boolean;
  isArchived: boolean;
  isBusy: boolean;
  onDecide: (decision: ToolApprovalDecision) => void;
  /** Set when the task's call may be allowed for its whole document or response. */
  scopeOffer?: ApprovalScopeOffer;
  onDecideScope?: () => void;
}) => {
  const child = item.child ?? undefined;
  const isClientTool = child?.kind === "client_tool";
  const brief = taskBriefFromInput(item.input, TASK_BRIEF_PREVIEW_CHARS);
  const { status, resolvedLabel } = stagedItemPresentation(
    staged,
    isArchived,
    scopeOffer?.covers,
  );
  const scopeButton =
    scopeOffer?.anchorable && onDecideScope
      ? {
          allowOnceLabel: t({
            id: "approvalScope.allowCall",
            message: "Allow this call",
          }),
          onAllowScope: onDecideScope,
          allowScopeLabel: allowScopeLabel(scopeOffer),
          allowScopeHint: scopeHint(scopeOffer),
        }
      : {};
  // The server marks a change, and needs a position, only for a document.
  const scopeNotices =
    scopeOffer?.covers === "document" &&
    (scopeOffer.changed || !scopeOffer.anchorable) ? (
      <div className="space-y-1 text-sm text-theme-fg-secondary">
        {scopeOffer.changed && (
          <p data-testid="approval-scope-changed">
            {t({
              id: "approvalScope.changed",
              message: "The document changed since you allowed it.",
            })}
          </p>
        )}
        {!scopeOffer.anchorable && (
          <p
            className="text-xs text-theme-fg-muted"
            data-testid="approval-scope-elsewhere"
          >
            {t({
              id: "approvalScope.elsewhere",
              message:
                "To allow the whole document, decide in the pane that has it open.",
            })}
          </p>
        )}
      </div>
    ) : undefined;

  return (
    <div
      data-testid="delegated-task-approval-item"
      data-approval-id={item.approval_id}
      data-child-chat-id={child?.child_chat_id ?? ""}
      className="rounded-md border border-theme-border p-2"
    >
      <p className="text-sm font-medium text-theme-fg-primary">
        {brief ??
          t({
            id: "delegatedTaskApproval.unnamedTask",
            message: "A task this response started",
          })}
      </p>
      {child ? (
        <>
          <ApprovalToolHeading
            className="mt-1"
            toolName={child.tool_name}
            display={child.display}
            icon={
              isClientTool ? (
                <ComputerIcon className="size-4 shrink-0 text-theme-fg-secondary" />
              ) : (
                <ResolvedIcon
                  iconId="simpleicons-modelcontextprotocol"
                  className="size-4 shrink-0 text-theme-fg-secondary"
                />
              )
            }
            source={
              isClientTool
                ? t({
                    id: "clientToolApproval.thisDevice",
                    message: "This device",
                  })
                : child.mcp_server_id
            }
            // The task brief above is this item's heading.
            titleClassName="font-normal"
          />
          <div className="mt-2 max-h-48 overflow-y-auto">
            <ToolCallInput input={child.input} />
          </div>
          {/* A client tool declares no annotations of its own. */}
          {!isClientTool && child.annotations.openWorldHint && (
            <p className="mt-1 text-xs text-theme-fg-muted">
              {t({
                id: "mcpApproval.openWorldWarning",
                message: "This tool may send data to an external service.",
              })}
            </p>
          )}
        </>
      ) : (
        // The item outlived the child's own record — the decision still has to
        // be answerable, because the turn cannot go on until every item is.
        <p className="mt-1 text-xs text-theme-fg-muted">
          {t({
            id: "delegatedTaskApproval.childMissing",
            message: "The run this decision covers was not recorded.",
          })}
        </p>
      )}
      <ActionConfirmationCard
        title={t({
          id: "delegatedTaskApproval.itemTitle",
          message: "Allow this task to make the call?",
        })}
        description={scopeNotices}
        onAllowOnce={() => onDecide("approve")}
        {...scopeButton}
        // Standing decisions are keyed on the CHILD's server and tool — the
        // parent's `delegate_task` is a synthetic name no grant can name — so
        // they are offered only for an item that names a child. Disabled
        // rather than missing when the deployment forbids them, as in the MCP
        // layout.
        {...(child
          ? {
              // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
              onAlwaysAllow: () => onDecide("approve_always"),
              // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
              onNeverAllow: () => onDecide("reject_always"),
              alwaysAllowDisabledReason: allowAlways
                ? undefined
                : t({
                    id: "mcpApproval.alwaysAllowDisabled",
                    message:
                      "Locked: your organization requires confirmation each time this tool runs.",
                  }),
            }
          : {})}
        onDeny={() => onDecide("reject")}
        status={status}
        resolvedLabel={resolvedLabel}
        isBusy={isBusy}
        scrollIntoViewOnMount={scrollIntoViewOnMount}
        data-testid="delegated-task-approval-item-card"
      />
    </div>
  );
};
