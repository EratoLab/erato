import { i18n } from "@lingui/core";

/**
 * Look up a translation that may not be present in the active catalog.
 *
 * Lingui treats a missing message with an empty fallback as the message ID,
 * then warns in production because that ID is an uncompiled string. Check the
 * catalog before asking Lingui to resolve the message so optional translations
 * stay silent when they are not configured.
 */
export function getOptionalTranslation(translationId: string): string | null {
  const message = i18n.messages[translationId];
  if (!(translationId in i18n.messages)) {
    return null;
  }

  // Raw catalog entries are valid for optional translations without values,
  // and returning them directly also avoids Lingui's production warning when
  // a dynamically loaded catalog has not been compiled.
  if (typeof message === "string") {
    return message.trim() === "" ? null : message;
  }

  const result = i18n._(translationId);
  return typeof result === "string" && result.trim() !== "" ? result : null;
}

/**
 * Hook to get an optional translation.
 * Returns the translated string if it exists, or null if no translation is provided.
 *
 * When a translation ID has no entry in the locale files, this returns null,
 * allowing conditional rendering based on whether a customer has provided a
 * translation.
 *
 * @param translationId - The translation ID to look up
 * @returns The translated string if available, or null if not provided
 *
 * @example
 * ```tsx
 * const tooltip = useOptionalTranslation("assistant.myAssistant.tooltip");
 * if (tooltip) {
 *   return <Tooltip content={tooltip}><InfoIcon /></Tooltip>;
 * }
 * return null;
 * ```
 */
export function useOptionalTranslation(translationId: string): string | null {
  return getOptionalTranslation(translationId);
}
