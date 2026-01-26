import { t } from "@lingui/core/macro";

/**
 * Hook to get an optional translation.
 * Returns the translated string if it exists, or null if no translation is provided.
 *
 * When a translation ID has no entry in the locale files, Lingui returns the ID itself.
 * This hook detects that case and returns null instead, allowing conditional rendering
 * based on whether a customer has provided a translation.
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
  // Attempt to translate with an empty fallback message
  // eslint-disable-next-line lingui/no-single-variables-to-translate
  const result = t({ id: translationId, message: "" });

  // If Lingui returns the ID itself, no translation exists
  if (result === translationId) {
    return null;
  }

  // If the result is empty, treat it as no translation
  if (!result || result.trim() === "") {
    return null;
  }

  return result;
}
