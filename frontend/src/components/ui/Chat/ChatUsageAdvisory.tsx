import { t } from "@lingui/core/macro";

import { ReadOnlyMarkdown } from "@/components/ui/Markdown/ReadOnlyMarkdown";
import { useOptionalTranslation } from "@/hooks/i18n";
import { useIsMobile } from "@/hooks/useResponsive";
import { useChatInputFeature } from "@/providers/FeatureConfigProvider";

const advisoryStyle = {
  maxWidth: "var(--theme-layout-chat-input-max-width)",
} as const;

/**
 * The advisory text when it shows, otherwise null. It needs the deployment to
 * opt in, a non-empty translation, and a screen wider than a phone: on a phone
 * nothing sits beneath the composer.
 */
export function useUsageAdvisory(): string | null {
  const { showUsageAdvisory } = useChatInputFeature();
  const isMobile = useIsMobile();
  // Dummy for i18n:extract
  void t({
    id: "chat.ai_usage_advisory",
    message:
      "You are interacting with an AI chatbot. Generated answers may contain factual errors and should be verified before use.",
  });
  const aiUsageAdvisory = useOptionalTranslation("chat.ai_usage_advisory");

  if (!showUsageAdvisory || isMobile) {
    return null;
  }
  return aiUsageAdvisory;
}

/** The "you are talking to an AI" line that sits beneath the composer shell. */
export function ChatUsageAdvisory() {
  const aiUsageAdvisory = useUsageAdvisory();

  if (!aiUsageAdvisory) {
    return null;
  }

  return (
    <div
      className="relative mx-auto h-10 w-full shrink-0"
      style={advisoryStyle}
      data-ui="chat-usage-advisory"
    >
      <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-theme-fg-muted">
        <div>
          <ReadOnlyMarkdown compact>{aiUsageAdvisory}</ReadOnlyMarkdown>
        </div>
      </div>
    </div>
  );
}
