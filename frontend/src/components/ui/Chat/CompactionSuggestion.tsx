import { t } from "@lingui/core/macro";

import { env } from "@/app/env";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";

import type { TokenUsageEstimationResult } from "@/hooks/chat/useTokenUsageEstimation";

export function CompactionSuggestion({
  estimation,
  onCompact,
  pending,
}: {
  estimation: TokenUsageEstimationResult;
  onCompact: () => void;
  pending?: boolean;
}) {
  if (
    !estimation.tokenUsage ||
    estimation.usagePercentage * 100 <
      (env().chatHistoryCompactionThresholdPercentage ?? 80)
  )
    return null;
  return (
    <Alert type="warning" geometryVariant="message">
      <p>
        {t({
          id: "chat.compaction.suggestion",
          message:
            "This chat is approaching its context limit. Compact it to continue with a summary. Some details may be lost.",
        })}
      </p>
      <Button
        type="button"
        variant="secondary"
        onClick={onCompact}
        disabled={pending}
      >
        {t({ id: "chat.compaction.action", message: "Compact chat history" })}
      </Button>
    </Alert>
  );
}
