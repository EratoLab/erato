import { t } from "@lingui/core/macro";

import { useOptionalTranslation } from "@/hooks/i18n";
import { useChatInputFeature } from "@/providers/FeatureConfigProvider";

const advisoryStyle = {
  maxWidth: "var(--theme-layout-chat-input-max-width)",
} as const;

/**
 * The "you are talking to an AI" line that sits beneath the composer shell.
 * Renders nothing when the feature is off or the deployment has no
 * translation for it.
 */
export function ChatUsageAdvisory() {
  const { showUsageAdvisory = true } = useChatInputFeature();
  // Dummy for i18n:extract
  void t({
    id: "chat.ai_usage_advisory",
    message:
      "You are interacting with an AI chatbot. Generated answers may contain factual errors and should be verified before use.",
  });
  const aiUsageAdvisory = useOptionalTranslation("chat.ai_usage_advisory");

  if (!showUsageAdvisory || !aiUsageAdvisory) {
    return null;
  }

  return (
    <div
      className="relative mx-auto h-10 w-full shrink-0"
      style={advisoryStyle}
      data-ui="chat-usage-advisory"
    >
      <p className="absolute inset-0 flex items-center justify-center text-center text-xs text-theme-fg-muted">
        {aiUsageAdvisory}
      </p>
    </div>
  );
}
