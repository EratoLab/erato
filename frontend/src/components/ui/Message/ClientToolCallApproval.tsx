import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";

import { ToolCallInput } from "@/components/ui/ToolCall";
import { useClientToolCallApprovalStore } from "@/hooks/chat/store/clientToolCallApprovalStore";
import { saveClientToolDecision } from "@/lib/desktopSidecar/toolDecisions";
import { sidecarToolLabel } from "@/lib/desktopSidecar/toolLabels";
import { profileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { ActionConfirmationCard } from "./ActionConfirmationCard";

import type { ClientToolCallApprovalRequest } from "@/hooks/chat/store/clientToolCallApprovalStore";
import type { ClientToolDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Per-call consent for a device tool the user set to "Ask each time". */
export function ClientToolCallApprovals({ messageId }: { messageId: string }) {
  const requests = useClientToolCallApprovalStore((state) => state.requests);
  return requests
    .filter((request) => request.context.messageId === messageId)
    .map((request) => (
      <ClientToolCallApprovalCard key={request.id} request={request} />
    ));
}

function ClientToolCallApprovalCard({
  request,
}: {
  request: ClientToolCallApprovalRequest;
}) {
  const queryClient = useQueryClient();
  const bareName = request.qualifiedName.split("/").pop() ?? "";
  const label = sidecarToolLabel(bareName);
  // The call is decided at once; if storing the standing decision fails the
  // tool simply stays on "ask", so the next call asks again.
  const decideAndRemember = (
    approved: boolean,
    decision: ClientToolDecision,
  ) => {
    request.finish(approved);
    void saveClientToolDecision(request.qualifiedName, decision)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: profileQuery({}).queryKey }),
      )
      .catch(() => undefined);
  };
  return (
    <ActionConfirmationCard
      title={t({
        id: "chat.clientToolCallApproval.title",
        message: `Allow "${label}" on this device?`,
      })}
      description={
        <>
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "chat.clientToolCallApproval.description",
              message:
                "The assistant wants to use the desktop sidecar with these parameters. Results are shared with the AI provider.",
            })}
          </p>
          <ToolCallInput input={request.input} />
        </>
      }
      onAllowOnce={() => request.finish(true)}
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value.
      onAlwaysAllow={() => decideAndRemember(true, "always_allow")}
      onDeny={() => request.finish(false)}
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API enum value.
      onNeverAllow={() => decideAndRemember(false, "never_allow")}
      scrollIntoViewOnMount
      data-testid="client-tool-call-approval"
    />
  );
}
