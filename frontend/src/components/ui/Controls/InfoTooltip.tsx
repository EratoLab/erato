import { t } from "@lingui/core/macro";

import { useOptionalTranslation } from "@/hooks/i18n";

import { InfoIcon } from "../icons";
import { Tooltip } from "./Tooltip";

import type { ReactNode } from "react";

interface InfoTooltipProps {
  /**
   * The Lingui translation ID for the tooltip content.
   * If no translation exists for this ID, the component renders nothing.
   */
  translationId: string;

  /**
   * Position of the tooltip relative to the icon.
   * @default "top"
   */
  position?: "top" | "right" | "bottom" | "left";

  /**
   * Size of the info icon.
   * @default "sm"
   */
  size?: "sm" | "md";

  /**
   * Additional CSS classes for the icon wrapper.
   */
  className?: string;
}

/**
 * InfoTooltip - A conditional tooltip component controlled by translation files.
 *
 * Renders an info icon ("i" in a circle) with a tooltip only when a translation
 * exists for the given translationId. If no translation is provided in the locale
 * files, the component renders nothing.
 *
 * This enables customer-configurable tooltips via language files without
 * cluttering the UI when no tooltip content is provided.
 *
 * @example
 * ```tsx
 * // In a component:
 * <h3>
 *   Assistant Name
 *   <InfoTooltip translationId="assistant.myAssistant.tooltip" />
 * </h3>
 *
 * // In locale file (messages.po):
 * msgid "assistant.myAssistant.tooltip"
 * msgstr "This assistant helps with customer support queries."
 *
 * // If the translation exists, shows: "Assistant Name [i]" with tooltip
 * // If no translation, shows: "Assistant Name" (nothing extra)
 * ```
 */
export function InfoTooltip({
  translationId,
  position = "top",
  size = "sm",
  className = "",
}: InfoTooltipProps): ReactNode {
  const tooltipContent = useOptionalTranslation(translationId);

  // If no translation exists, render nothing
  if (!tooltipContent) {
    return null;
  }

  const iconSizeClasses = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
  };

  return (
    <Tooltip content={tooltipContent} position={position}>
      <button
        type="button"
        className={`inline-flex cursor-help items-center justify-center rounded-full text-theme-fg-muted transition-colors hover:text-theme-fg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-border-focus ${className}`}
        aria-label={t({
          id: "infotooltip.aria.label",
          message: "More information",
        })}
      >
        <InfoIcon className={iconSizeClasses[size]} />
      </button>
    </Tooltip>
  );
}
