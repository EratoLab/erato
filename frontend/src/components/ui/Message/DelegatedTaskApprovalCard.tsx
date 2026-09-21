import { plural, t } from "@lingui/core/macro";

import { ToolCallInput } from "@/components/ui/ToolCall";
import {
  TASK_BRIEF_PREVIEW_CHARS,
  taskBriefFromInput,
} from "@/lib/delegation/taskBrief";

import { ResolvedIcon } from "../icons";
import { ActionConfirmationCard } from "./ActionConfirmationCard";
import {
  APPROVAL_CARD_SHELL_CLASS,
  ApprovalBulkActions,
  stagedItemPresentation,
} from "./ApprovalDecisionActions";

import type { ApprovalItemPart, StagedDecisions } from "./approvalItems";
import type { ToolApprovalDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * One parked child: which task it is, and the call it stopped on.
 *
 * The task brief is the only thing that names it — a task child has no
 * assistant of its own — and the MCP referent is the child's, never the
 * parent's: what is being decided is a call in another chat, and the
 * `delegate_task` name on the item describes the dispatch, not the tool.
 */
const ParkedChildItem = ({
  item,
  isFirst,
  staged,
  allowAlways,
  isArchived,
  isBusy,
  onDecide,
}: {
  item: ApprovalItemPart;
  /** Only the first row scrolls the card into view; N would fight over it. */
  isFirst: boolean;
  staged: ToolApprovalDecision | undefined;
  allowAlways: boolean;
  isArchived: boolean;
  isBusy: boolean;
  onDecide: (decision: ToolApprovalDecision) => void;
}) => {
  const child = item.child ?? undefined;
  const brief = taskBriefFromInput(item.input, TASK_BRIEF_PREVIEW_CHARS);
  const { status, resolvedLabel } = stagedItemPresentation(staged, isArchived);

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
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ResolvedIcon
              iconId="simpleicons-modelcontextprotocol"
              className="size-4 shrink-0 text-theme-fg-secondary"
            />
            <span className="text-sm text-theme-fg-primary">
              {child.tool_name}
            </span>
            <span className="text-xs text-theme-fg-muted">
              {child.mcp_server_id}
            </span>
          </div>
          <div className="mt-2 max-h-48 overflow-y-auto">
            <ToolCallInput input={child.input} />
          </div>
          {child.annotations.openWorldHint && (
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
        onAllowOnce={() => onDecide("approve")}
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
        scrollIntoViewOnMount={isFirst}
        data-testid="delegated-task-approval-item-card"
      />
    </div>
  );
};

/**
 * The parent's surface for children that stopped to ask.
 *
 * One card for the whole stop, one row per parked child: the turn is waiting on
 * all of them, and the server settles them in one request — so a row answered
 * while another is still open is held, not sent. The child's own card in its
 * own chat is refused while this one is open, because only this turn can use
 * the answer.
 */
export const DelegatedTaskApprovalCard = ({
  items,
  staged,
  allowAlways,
  isArchived,
  isBusy,
  onDecideItem,
  onDecideAll,
}: {
  items: ApprovalItemPart[];
  staged: StagedDecisions;
  allowAlways: boolean;
  isArchived: boolean;
  isBusy: boolean;
  onDecideItem: (approvalId: string, decision: ToolApprovalDecision) => void;
  onDecideAll: (decision: ToolApprovalDecision) => void;
}) => {
  const itemCount = items.length;
  return (
    <div
      data-testid="delegated-task-approval"
      data-approval-kind="delegated_task"
      data-item-count={itemCount}
      className={`${APPROVAL_CARD_SHELL_CLASS} space-y-2`}
    >
      <div>
        <p className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "delegatedTaskApproval.title",
            message: plural(itemCount, {
              one: "A task is waiting on your decision",
              other: "Tasks are waiting on your decision",
            }),
          })}
        </p>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "delegatedTaskApproval.description",
            message: plural(itemCount, {
              one: "It stopped at a tool call it needs permission for. The response continues once you decide.",
              other:
                "Each one stopped at a tool call it needs permission for. The response continues once all of them are decided.",
            }),
          })}
        </p>
      </div>
      {items.map((item, index) => (
        <ParkedChildItem
          key={item.approval_id}
          item={item}
          isFirst={index === 0}
          staged={staged[item.approval_id]}
          allowAlways={allowAlways}
          isArchived={isArchived}
          isBusy={isBusy}
          onDecide={(decision) => onDecideItem(item.approval_id, decision)}
        />
      ))}
      {!isArchived && (
        <ApprovalBulkActions
          itemCount={itemCount}
          onDecideAll={onDecideAll}
          isBusy={isBusy}
          testId="delegated-task-approval-bulk"
        />
      )}
    </div>
  );
};
