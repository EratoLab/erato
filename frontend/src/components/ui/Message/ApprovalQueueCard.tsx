import { plural, t } from "@lingui/core/macro";
import { useCallback, useId, useRef } from "react";

import {
  reviewLinkKey,
  useSidecarReviewLinks,
} from "@/lib/desktopSidecar/sidecarReviewLinks";

import {
  APPROVAL_CARD_SHELL_CLASS,
  ApprovalBulkActions,
  stagedItemPresentation,
} from "./ApprovalDecisionActions";
import { BuiltinToolApprovalItem } from "./BuiltinToolApprovalItem";
import { OwnCallApprovalItem } from "./OwnCallApprovalItem";
import { ParkedChildItem } from "./ParkedChildItem";
import { ToolCallLimitItem } from "./ToolCallLimitItem";
import { WaitingTaskItem } from "./WaitingTaskItem";
import {
  approvalQueueOf,
  isChildItem,
  itemAllowsAlways,
} from "./approvalItems";

import type {
  ApprovalItemPart,
  ApprovalScopeOffer,
  StagedDecisions,
} from "./approvalItems";
import type { SidecarReviewLink } from "@/lib/desktopSidecar/sidecarReviewLinks";
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
 * parked child is named by its task. On the tool-call limit's stop the limit's
 * choice comes first. Its Stop answers the whole stop at once and sends the
 * tasks' questions back to their own chats, so that stop offers no bulk
 * answers. Tasks that wait for a call on the device are listed below without
 * decisions: the response goes on once they finish. A task whose call waits
 * for its review in the Erato desktop app shows that review, so the card says
 * the task waits for the user, not that it goes on.
 * A stop behind the response's own waiting client tool call says the tasks go
 * on, but the response only continues once that call has finished too.
 *
 * The card is a group named by its title, and takes the focus a waiting task's
 * item held when the item goes.
 */
export const ApprovalQueueCard = ({
  request,
  items,
  waiting = [],
  awaitsOwnCall = false,
  staged,
  isArchived,
  isBusy,
  onDecideItem,
  onDecideAll,
  scopeOffer,
  onDecideScope,
}: {
  request: Pick<
    ContentPartToolApprovalRequest,
    "kind" | "requested_at" | "allow_always" | "mcp_server_id" | "annotations"
  >;
  /** The stop's open items, in row order. */
  items: ApprovalItemPart[];
  /** The stop's task children that still wait on the device, in row order. */
  waiting?: ApprovalItemPart[];
  /**
   * The response also waits for its own client tool call, so a decision lets
   * the tasks go on but not the response.
   */
  awaitsOwnCall?: boolean;
  staged: StagedDecisions;
  isArchived: boolean;
  isBusy: boolean;
  onDecideItem: (approvalId: string, decision: ToolApprovalDecision) => void;
  onDecideAll: (decision: ToolApprovalDecision) => void;
  /** How an item's document or response scope is offered, if it has one. */
  scopeOffer?: (item: ApprovalItemPart) => ApprovalScopeOffer | undefined;
  /** Allow an item, and every open item of its tool and scope, for that scope. */
  onDecideScope?: (item: ApprovalItemPart) => void;
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
  const waitingCount = waiting.length;
  // A waiting task whose call is in review waits for the user, not on its own.
  const reviewCount = useSidecarReviewLinks(
    ({ links }) =>
      waiting.filter(({ child }) => {
        if (!child) return false;
        const link = links[
          reviewLinkKey(child.child_message_id, child.child_tool_call_id)
        ] as SidecarReviewLink | undefined;
        return link?.state === "open";
      }).length,
  );
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const focusCard = useCallback(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      data-testid="approval-queue"
      data-approval-kind={kind}
      data-item-count={itemCount}
      data-position={ordinal}
      className={`${APPROVAL_CARD_SHELL_CLASS} focus-ring space-y-2`}
    >
      <div>
        {itemCount > 0 ? (
          <>
            <p
              id={titleId}
              className="text-sm font-medium text-theme-fg-primary"
            >
              {t({
                id: "approvalQueue.title",
                message: plural(itemCount, {
                  one: "This response is waiting on your decision",
                  other: "This response is waiting on # decisions",
                }),
              })}
            </p>
            <p className="text-sm text-theme-fg-secondary">
              {awaitsOwnCall
                ? t({
                    id: "approvalQueue.descriptionAwaitingCall",
                    message: plural(itemCount, {
                      one: "The task goes on once you decide. The response continues when the connected app has finished.",
                      other:
                        "They are shown one at a time. The tasks go on once all of them are decided. The response continues when the connected app has finished.",
                    }),
                  })
                : t({
                    id: "approvalQueue.description",
                    message: plural(itemCount, {
                      one: "The response continues once you decide.",
                      other:
                        "They are shown one at a time. The response continues once all of them are decided.",
                    }),
                  })}
            </p>
          </>
        ) : (
          <>
            <p
              id={titleId}
              className="text-sm font-medium text-theme-fg-primary"
            >
              {t({
                id: "approvalQueue.waitingTitle",
                message: plural(waitingCount, {
                  one: "This response is waiting on a task",
                  other: "This response is waiting on # tasks",
                }),
              })}
            </p>
            <p className="text-sm text-theme-fg-secondary">
              {reviewCount > 0 ? (
                <>
                  {t({
                    id: "approvalQueue.waitingReview",
                    message: plural(reviewCount, {
                      one: "A task waits for your review in the Erato desktop app.",
                      other:
                        "# tasks wait for your review in the Erato desktop app.",
                    }),
                  })}{" "}
                  {awaitsOwnCall
                    ? t({
                        id: "approvalQueue.waitingReviewContinuesAwaitingCall",
                        message: plural(waitingCount, {
                          one: "The response continues once the task and the connected app have finished.",
                          other:
                            "The response continues once the tasks and the connected app have finished.",
                        }),
                      })
                    : t({
                        id: "approvalQueue.waitingReviewContinues",
                        message: plural(waitingCount, {
                          one: "The response continues once the task finishes.",
                          other:
                            "The response continues once the tasks finish.",
                        }),
                      })}
                </>
              ) : awaitsOwnCall ? (
                t({
                  id: "approvalQueue.waitingDescriptionAwaitingCall",
                  message: plural(waitingCount, {
                    one: "It continues on its own once the task and the connected app have finished.",
                    other:
                      "It continues on its own once the tasks and the connected app have finished.",
                  }),
                })
              ) : (
                t({
                  id: "approvalQueue.waitingDescription",
                  message: plural(waitingCount, {
                    one: "It continues on its own once the task finishes.",
                    other: "It continues on its own once they finish.",
                  }),
                })
              )}
            </p>
          </>
        )}
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
            scopeOffer={scopeOffer?.(current)}
            onDecideScope={
              onDecideScope ? () => onDecideScope(current) : undefined
            }
          />
        ) : kind === "tool_call_limit" ? (
          <div
            key={current.approval_id}
            data-testid="tool-call-limit-approval"
            data-approval-id={current.approval_id}
          >
            <ToolCallLimitItem
              tasksAsk={itemCount > 1}
              // Held answers are not shown on it: it comes first, and Stop
              // sends the stop at once.
              {...stagedItemPresentation(undefined, isArchived)}
              isBusy={isBusy}
              scrollIntoViewOnMount
              onDecide={(decision) =>
                decision === "withdraw"
                  ? onDecideAll(decision)
                  : onDecideItem(current.approval_id, decision)
              }
            />
          </div>
        ) : (
          <div
            key={current.approval_id}
            data-testid="mcp-tool-approval-item"
            data-approval-id={current.approval_id}
            data-tool-name={current.tool_name}
            className="rounded-md border border-theme-border p-2"
          >
            {kind === "builtin_tool" ? (
              <BuiltinToolApprovalItem
                toolName={current.tool_name}
                display={current.display}
                input={current.input}
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
            ) : (
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
            )}
          </div>
        ))}
      {!isArchived && itemCount > 0 && kind !== "tool_call_limit" && (
        <ApprovalBulkActions
          itemCount={itemCount}
          onDecideAll={onDecideAll}
          isBusy={isBusy}
          testId="approval-queue-bulk"
        />
      )}
      {waitingCount > 0 && (
        <div className="space-y-2" data-testid="approval-queue-waiting">
          {itemCount > 0 && (
            <p className="text-xs font-medium text-theme-fg-muted">
              {t({
                id: "approvalQueue.waitingHeading",
                message: plural(waitingCount, {
                  one: "Also waiting on a task",
                  other: "Also waiting on # tasks",
                }),
              })}
            </p>
          )}
          {waiting.map((item) => (
            <WaitingTaskItem
              key={item.approval_id}
              item={item}
              isArchived={isArchived}
              onRemovedWithFocus={focusCard}
            />
          ))}
        </div>
      )}
    </div>
  );
};
