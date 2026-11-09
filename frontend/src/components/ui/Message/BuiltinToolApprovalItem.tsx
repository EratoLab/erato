import { t } from "@lingui/core/macro";

import {
  CANCEL_REMINDER_TOOL_NAME,
  CREATE_REMINDER_TOOL_NAME,
} from "@/components/ui/Scheduled/reminderConfirmation";

import { ActionConfirmationCard } from "./ActionConfirmationCard";

import type { ActionConfirmationStatus } from "./ActionConfirmationCard";
import type {
  ToolApprovalDecision,
  ToolDisplayMetadata,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface Wording {
  title: string;
  /** What a created reminder will deliver, as the call states it. */
  message?: string;
  note?: string;
  allowLabel: string;
  denyLabel: string;
}

const textOf = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * The question for one of Erato's own tools, in what it does to what. The
 * server names what the call acts on in `display.title`.
 */
const wordingOf = (
  toolName: string,
  display: ToolDisplayMetadata | null | undefined,
  input: unknown,
): Wording => {
  const fields =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const name = textOf(display?.title) ?? textOf(fields.name) ?? toolName;
  if (toolName === CANCEL_REMINDER_TOOL_NAME) {
    // Worded as the reminder card's own Cancel asks it in the same chat.
    return {
      title: t({
        id: "builtinToolApproval.cancelReminder.title",
        message: `Cancel the reminder “${name}”?`,
      }),
      note: t({
        id: "scheduled.item.cancel.confirmMessage",
        message:
          "It will not be carried out. You can still find it under Past.",
      }),
      allowLabel: t({
        id: "scheduled.item.cancel.confirm",
        message: "Cancel it",
      }),
      denyLabel: t({
        id: "scheduled.item.cancel.keep",
        message: "Keep it",
      }),
    };
  }
  if (toolName === CREATE_REMINDER_TOOL_NAME) {
    return {
      title: t({
        id: "builtinToolApproval.createReminder.title",
        message: `Schedule the reminder “${name}”?`,
      }),
      // Shown because content the model read, not only the user, can fill it.
      message: textOf(fields.message),
      allowLabel: t({
        id: "builtinToolApproval.createReminder.confirm",
        message: "Schedule",
      }),
      denyLabel: t({
        id: "builtinToolApproval.createReminder.deny",
        message: "Don't schedule",
      }),
    };
  }
  return {
    title: t({
      id: "builtinToolApproval.title",
      message: `Allow “${name}”?`,
    }),
    allowLabel: t({ id: "builtinToolApproval.allow", message: "Allow" }),
    denyLabel: t({ id: "builtinToolApproval.deny", message: "Deny" }),
  };
};

/**
 * A call of one of Erato's own tools, such as cancelling a reminder, asked
 * about in what it does: no tool, server or raw input, and no standing
 * decision, since the card asks every time. A reminder to schedule shows the
 * message it will deliver.
 */
export const BuiltinToolApprovalItem = ({
  toolName,
  display,
  input,
  status,
  resolvedLabel,
  isBusy,
  scrollIntoViewOnMount,
  onDecide,
}: {
  toolName: string;
  display?: ToolDisplayMetadata | null;
  input: unknown;
  status: ActionConfirmationStatus;
  resolvedLabel: string | undefined;
  isBusy: boolean;
  scrollIntoViewOnMount: boolean;
  onDecide: (decision: ToolApprovalDecision) => void;
}) => {
  const wording = wordingOf(toolName, display, input);
  const when = textOf(display?.description);
  return (
    <ActionConfirmationCard
      title={wording.title}
      description={
        when || wording.message || wording.note ? (
          <div className="space-y-1 text-sm">
            {when && (
              <p
                className="text-theme-fg-primary"
                data-testid="builtin-tool-approval-when"
              >
                {when}
              </p>
            )}
            {wording.message && (
              <p
                className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-theme-border pl-2 text-theme-fg-primary"
                data-testid="builtin-tool-approval-message"
              >
                {wording.message}
              </p>
            )}
            {wording.note && (
              <p className="text-theme-fg-secondary">{wording.note}</p>
            )}
          </div>
        ) : undefined
      }
      allowOnceLabel={wording.allowLabel}
      denyLabel={wording.denyLabel}
      onAllowOnce={() => onDecide("approve")}
      onDeny={() => onDecide("reject")}
      status={status}
      resolvedLabel={resolvedLabel}
      isBusy={isBusy}
      scrollIntoViewOnMount={scrollIntoViewOnMount}
      data-testid="builtin-tool-approval-card"
    />
  );
};
