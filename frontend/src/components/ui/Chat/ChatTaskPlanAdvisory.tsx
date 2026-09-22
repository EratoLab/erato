import { t } from "@lingui/core/macro";

import { useAssistantsFeature } from "@/providers/FeatureConfigProvider";

import type { DelegationTasksApprovalMode } from "@/app/env";

const advisoryStyle = {
  maxWidth: "var(--theme-layout-chat-input-max-width)",
} as const;

/**
 * Says in advance that delegated work will stop to be approved.
 *
 * The stop lands after the model has already planned the work, so without a
 * word beforehand the interruption is the first the user hears of the policy
 * — which reads as the product refusing to act rather than asking.
 *
 * What it says depends on what the policy actually stops, because the three
 * modes stop different things and a line that overstated it would be its own
 * kind of surprise.
 */
const advisoryFor = (mode: DelegationTasksApprovalMode): string | null => {
  switch (mode) {
    case "always":
      return t({
        id: "chat.task_approval.always",
        message: "Any task run for you here needs your approval first.",
      });
    case "plan":
      return t({
        id: "chat.task_approval.plan",
        message:
          "If this is split into separate tasks, you will be asked to approve the plan before any of it runs.",
      });
    case "async_only":
      return t({
        id: "chat.task_approval.asyncOnly",
        message:
          "If any of this runs as a background task, you will be asked to approve it first.",
      });
    case "never":
      return null;
    default: {
      const exhaustive: never = mode;
      void exhaustive;
      return null;
    }
  }
};

/**
 * The approval pre-announcement beneath the composer shell, on the deployments
 * whose policy can actually stop a dispatch.
 *
 * Two things keep it quiet everywhere else. The backend publishes the approval
 * mode ungated, so `always` or `plan` can be configured on a deployment where
 * tasks are switched off entirely and no dispatch exists to stop — hence the
 * `delegationTasksEnabled` check. And `async_only` stops nothing at all until
 * `async` is a run mode the model may offer, which is precisely what
 * `delegationTasksAllowAsync` reports (the backend derives it from
 * `run_modes`). On a default deployment both are false and this renders
 * nothing.
 *
 * The mode published to clients is the GLOBAL one. A per-facet override is
 * resolved per turn from the facet selection, so this promises only what every
 * turn on the deployment shares.
 */
export function ChatTaskPlanAdvisory() {
  const {
    delegationTasksEnabled,
    delegationTasksAllowAsync,
    delegationTasksApprovalMode,
  } = useAssistantsFeature();

  if (!delegationTasksEnabled) {
    return null;
  }
  if (
    delegationTasksApprovalMode === "async_only" &&
    !delegationTasksAllowAsync
  ) {
    return null;
  }

  const advisory = advisoryFor(delegationTasksApprovalMode);
  if (!advisory) {
    return null;
  }

  return (
    <div
      className="relative mx-auto w-full shrink-0 pt-1"
      style={advisoryStyle}
      data-ui="chat-task-plan-advisory"
    >
      <p className="flex items-center justify-center text-center text-xs text-theme-fg-muted">
        {advisory}
      </p>
    </div>
  );
}
