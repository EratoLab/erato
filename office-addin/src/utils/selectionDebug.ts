/**
 * TEMPORARY selection-preview diagnostics.
 *
 * Flip {@link SELECTION_DEBUG} to `false` to silence, or delete this file and
 * its imports (useOutlookComposeSelection, useOutlookSelectionProbe,
 * AddinChatInput) once the selection-preview issue is diagnosed.
 *
 * All output is prefixed with `[SELDEBUG]` so it is easy to filter in the
 * task-pane dev tools console and copy out.
 */
export const SELECTION_DEBUG = true;

export function selLog(...args: unknown[]): void {
  if (SELECTION_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[SELDEBUG]", ...args);
  }
}
