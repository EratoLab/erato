import { t } from "@lingui/core/macro";

/**
 * Backend validation error for action-facet args (e.g. the Outlook draft
 * `full_body`) is a plain-text response of the shape:
 *   "Argument '<arg>' for action facet '<id>' exceeds maximum size of <max>
 *    bytes (got <got> bytes)"
 * The frontend SSE client surfaces it on `Error.message`. We pattern-match
 * here so the user sees actionable copy instead of a raw server string.
 */
const ACTION_FACET_SIZE_RE =
  /Argument '([^']+)' for action facet '([^']+)' exceeds maximum size of (\d+) bytes \(got (\d+) bytes\)/;

/**
 * Returns a localized, actionable string for known chat-send error shapes
 * (currently the action-facet arg-size limit), or `null` when the input is
 * not an `Error`. Unknown error shapes fall through to `error.message` so
 * we don't swallow detail.
 *
 * Uses the Lingui `t` macro so messages are extracted at build time and
 * resolved against the global `i18n` instance at call time. Safe to call
 * from React components and imperative paths alike.
 */
export function resolveChatSendErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message) {
    return null;
  }

  const sizeMatch = ACTION_FACET_SIZE_RE.exec(error.message);
  if (sizeMatch) {
    const max = Number(sizeMatch[3]);
    const actual = Number(sizeMatch[4]);
    const maxKb = Math.round(max / 1024);
    const actualKb = Math.round(actual / 1024);
    return t({
      id: "chat.send.error.actionFacetArgTooLarge",
      message: `This draft is too long for the AI to process (${actualKb} KB / ${maxKb} KB max). Try shortening it, or select only the new portion of your reply and use the rewrite action.`,
    });
  }

  return error.message;
}
