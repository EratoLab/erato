/**
 * E2E / Development overrides for the component registry.
 *
 * This file loads the example components only when the
 * `window.__E2E_COMPONENT_VARIANT__` flag is set (via Playwright's
 * `page.addInitScript`). Keeping the imports behind that flag prevents test
 * fixtures and their dependencies from entering the production entry chunk.
 *
 * Called once from `main.tsx` before the app renders.
 *
 * ## For customer forks:
 * You do NOT need to modify this file. It is upstream-only and
 * provides E2E test infrastructure. Keep it as-is during merges.
 */

import { componentRegistry } from "./componentRegistry";

/**
 * Applies E2E example overrides to the registry when a variant flag is set.
 * Only fills in keys that are still `null` (preserves any fork overrides).
 *
 * Must be called before the app renders (e.g. in `main.tsx`).
 */
export const initE2EOverrides = async (): Promise<void> => {
  if (typeof window === "undefined") return;

  const variant = window.__E2E_COMPONENT_VARIANT__ ?? null;
  if (variant !== "welcome-screen-example") return;

  const [
    { ChatMessageBubble },
    { FileSourceSelectorGrid },
    { MessageControls },
    { AssistantWelcomeScreen, WelcomeScreen },
  ] = await Promise.all([
    import("@/customer/examples/ChatMessageBubble.example"),
    import("@/customer/examples/FileSourceSelectorGrid.example"),
    import("@/customer/examples/MessageControls.example"),
    import("@/customer/examples/WelcomeScreens.example"),
  ]);

  componentRegistry.ChatWelcomeScreen ??= WelcomeScreen;
  componentRegistry.AssistantWelcomeScreen ??= AssistantWelcomeScreen;
  componentRegistry.ChatFileSourceSelector ??= FileSourceSelectorGrid;
  componentRegistry.AssistantFileSourceSelector ??= FileSourceSelectorGrid;
  componentRegistry.MessageControls ??= MessageControls;
  componentRegistry.ChatMessageRenderer ??= ChatMessageBubble;
};
