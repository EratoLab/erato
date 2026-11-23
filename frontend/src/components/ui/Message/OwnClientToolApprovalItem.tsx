import { memo, useCallback } from "react";

import { componentRegistry } from "@/config/componentRegistry";
import { getClientToolExecutor } from "@/hooks/chat/clientToolExecutors";

import { ChainedApprovalItem } from "./ChainedApprovalItem";
import { OwnCallApprovalItem } from "./OwnCallApprovalItem";

import type { ActionConfirmationStatus } from "./ActionConfirmationCard";
import type { ApprovalItemPart } from "./approvalItems";
import type { ApprovalItemDecisionExtras } from "@/config/componentRegistry";
import type { ToolApprovalDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

/**
 * Whether a server-chained item can be approved here: only a client with the
 * tool's executor can make the change. Any other item can.
 */
export const approvableHere = (
  item: Pick<ApprovalItemPart, "chained" | "tool_name">,
): boolean =>
  item.chained == null || getClientToolExecutor(item.tool_name) !== undefined;

/**
 * The turn's own client tool call in the decision place: the host's own card
 * where one is registered, else the generic one. A chained item whose tool
 * cannot run here always gets the generic card, which offers no approval.
 *
 * Memoized, so a caller that keeps `onDecide` stable does not redraw a host
 * card on every render of the message around it.
 */
export const OwnClientToolApprovalItem = memo(
  function OwnClientToolApprovalItem({
    item,
    serverId,
    messageId,
    chatId,
    allowAlways,
    status,
    resolvedLabel,
    isBusy,
    scrollIntoViewOnMount,
    onDecide,
  }: {
    item: ApprovalItemPart;
    /** The request's `mcp_server_id`: the client tool's namespace. */
    serverId: string;
    messageId: string;
    chatId: string | null;
    allowAlways: boolean;
    status: ActionConfirmationStatus;
    resolvedLabel: string | undefined;
    isBusy: boolean;
    scrollIntoViewOnMount: boolean;
    onDecide: (
      approvalId: string,
      decision: ToolApprovalDecision,
      extras?: ApprovalItemDecisionExtras,
    ) => void;
  }) {
    const approvalId = item.approval_id;
    const chained = item.chained != null;
    const decide = useCallback(
      (decision: ToolApprovalDecision, extras?: ApprovalItemDecisionExtras) => {
        // The server refuses a confirmation on a call it did not chain.
        const sent =
          extras && !chained
            ? { ...extras, clientConfirmation: undefined }
            : extras;
        onDecide(approvalId, decision, sent);
      },
      [approvalId, chained, onDecide],
    );
    const runsHere = approvableHere(item);
    const renderDefault = useCallback(
      (options?: { note?: ReactNode }): ReactNode =>
        item.chained ? (
          <ChainedApprovalItem
            item={item}
            runsHere={runsHere}
            allowAlways={allowAlways}
            note={options?.note}
            status={status}
            resolvedLabel={resolvedLabel}
            isBusy={isBusy}
            scrollIntoViewOnMount={scrollIntoViewOnMount}
            onDecide={decide}
          />
        ) : (
          <>
            {options?.note ? (
              <div className="mb-1 text-sm text-theme-fg-secondary">
                {options.note}
              </div>
            ) : null}
            <OwnCallApprovalItem
              toolName={item.tool_name}
              display={item.display}
              input={item.input}
              serverId={serverId}
              isClientTool
              openWorld={false}
              allowAlways={allowAlways}
              status={status}
              resolvedLabel={resolvedLabel}
              isBusy={isBusy}
              scrollIntoViewOnMount={scrollIntoViewOnMount}
              onDecide={decide}
            />
          </>
        ),
      [
        allowAlways,
        decide,
        isBusy,
        item,
        resolvedLabel,
        runsHere,
        scrollIntoViewOnMount,
        serverId,
        status,
      ],
    );
    const HostCard = componentRegistry.ApprovalItemCard;
    if (!HostCard || !runsHere) return renderDefault();
    return (
      <HostCard
        item={item}
        serverId={serverId}
        messageId={messageId}
        chatId={chatId}
        allowAlways={allowAlways}
        status={status}
        resolvedLabel={resolvedLabel}
        isBusy={isBusy}
        onDecide={decide}
        renderDefault={renderDefault}
      />
    );
  },
);
