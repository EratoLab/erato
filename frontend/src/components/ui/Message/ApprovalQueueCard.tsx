import { plural, t } from "@lingui/core/macro";

import {
  APPROVAL_CARD_SHELL_CLASS,
  ApprovalBulkActions,
  stagedItemPresentation,
} from "./ApprovalDecisionActions";
import { OwnCallApprovalItem } from "./OwnCallApprovalItem";
import { ParkedChildItem } from "./ParkedChildItem";
import {
  approvalQueueOf,
  isChildItem,
  itemAllowsAlways,
} from "./approvalItems";

import type { ApprovalItemPart, StagedDecisions } from "./approvalItems";
import type {
  ContentPartToolApprovalRequest,
  ToolApprovalDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Every approval a turn and its tasks are waiting on, one at a time, oldest
 * first.
 *
 * The server still takes one request covering every open item, so an answer
 * is held until the last one is in; the queue only decides what the user sees
 * next. The turn's own gated call keeps its MCP or client-tool layout, and each
 * parked child is named by its task.
 */
export const ApprovalQueueCard = ({
  request,
  items,
  staged,
  isArchived,
  isBusy,
  onDecideItem,
  onDecideAll,
}: {
  request: Pick<
    ContentPartToolApprovalRequest,
    "kind" | "requested_at" | "allow_always" | "mcp_server_id" | "annotations"
  >;
  /** The stop's open items, in row order. */
  items: ApprovalItemPart[];
  staged: StagedDecisions;
  isArchived: boolean;
  isBusy: boolean;
  onDecideItem: (approvalId: string, decision: ToolApprovalDecision) => void;
  onDecideAll: (decision: ToolApprovalDecision) => void;
}) => {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API kind value
  const kind = request.kind ?? "mcp_tool";
  const queue = approvalQueueOf(request, items);
  const itemCount = queue.length;
  // Once every item is answered the last one stays up with its held answer,
  // while the stop is on its way.
  const firstUnanswered = queue.findIndex(
    (item) => staged[item.approval_id] === undefined,
  );
  const position = firstUnanswered === -1 ? itemCount - 1 : firstUnanswered;
  const current = queue[position] as ApprovalItemPart | undefined;
  const ordinal = position + 1;
  const remaining = itemCount - ordinal;

  return (
    <div
      data-testid="approval-queue"
      data-approval-kind={kind}
      data-item-count={itemCount}
      data-position={ordinal}
      className={`${APPROVAL_CARD_SHELL_CLASS} space-y-2`}
    >
      <div>
        <p className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "approvalQueue.title",
            message: plural(itemCount, {
              one: "This response is waiting on your decision",
              other: "This response is waiting on # decisions",
            }),
          })}
        </p>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "approvalQueue.description",
            message: plural(itemCount, {
              one: "The response continues once you decide.",
              other:
                "They are shown one at a time, oldest first. The response continues once all of them are decided.",
            }),
          })}
        </p>
        {itemCount > 1 && (
          <p
            className="text-xs text-theme-fg-muted"
            data-testid="approval-queue-counter"
          >
            {t({
              id: "approvalQueue.position",
              message: `Decision ${ordinal} of ${itemCount}`,
            })}
            {remaining > 0 && (
              <>
                {" · "}
                {t({
                  id: "approvalQueue.remaining",
                  message: plural(remaining, {
                    one: "# more after this one",
                    other: "# more after this one",
                  }),
                })}
              </>
            )}
          </p>
        )}
      </div>
      {current &&
        (isChildItem(current, kind) ? (
          <ParkedChildItem
            key={current.approval_id}
            item={current}
            scrollIntoViewOnMount
            staged={staged[current.approval_id]}
            allowAlways={itemAllowsAlways(current, request)}
            isArchived={isArchived}
            isBusy={isBusy}
            onDecide={(decision) => onDecideItem(current.approval_id, decision)}
          />
        ) : (
          <div
            key={current.approval_id}
            data-testid="mcp-tool-approval-item"
            data-approval-id={current.approval_id}
            data-tool-name={current.tool_name}
            className="rounded-md border border-theme-border p-2"
          >
            <OwnCallApprovalItem
              toolName={current.tool_name}
              display={current.display}
              input={current.input}
              serverId={request.mcp_server_id}
              isClientTool={kind === "client_tool"}
              openWorld={request.annotations.openWorldHint}
              allowAlways={itemAllowsAlways(current, request)}
              {...stagedItemPresentation(
                staged[current.approval_id],
                isArchived,
              )}
              isBusy={isBusy}
              scrollIntoViewOnMount
              onDecide={(decision) =>
                onDecideItem(current.approval_id, decision)
              }
            />
          </div>
        ))}
      {!isArchived && (
        <ApprovalBulkActions
          itemCount={itemCount}
          onDecideAll={onDecideAll}
          isBusy={isBusy}
          testId="approval-queue-bulk"
        />
      )}
    </div>
  );
};
