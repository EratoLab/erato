/**
 * E2E / Development overrides for the component registry.
 *
 * This file imports all example components and applies them when the
 * `window.__E2E_COMPONENT_VARIANT__` flag is set (via Playwright's
 * `page.addInitScript`).
 *
 * Called once from `main.tsx` before the app renders.
 *
 * ## For customer forks:
 * You do NOT need to modify this file. It is upstream-only and
 * provides E2E test infrastructure. Keep it as-is during merges.
 */

import { ChatMessageBubble } from "@/customer/examples/ChatMessageBubble.example";
import { FileSourceSelectorGrid } from "@/customer/examples/FileSourceSelectorGrid.example";
import { MessageControls } from "@/customer/examples/MessageControls.example";
import {
  AssistantWelcomeScreen,
  WelcomeScreen,
} from "@/customer/examples/WelcomeScreens.example";

import { componentRegistry } from "./componentRegistry";

/**
 * Applies E2E example overrides to the registry when a variant flag is set.
 * Only fills in keys that are still `null` (preserves any fork overrides).
 *
 * Must be called before the app renders (e.g. in `main.tsx`).
 */
export const initE2EOverrides = () => {
  if (typeof window === "undefined") return;

  const variant = window.__E2E_COMPONENT_VARIANT__ ?? null;
  if (variant !== "welcome-screen-example") return;

  componentRegistry.ChatWelcomeScreen ??= WelcomeScreen;
  componentRegistry.AssistantWelcomeScreen ??= AssistantWelcomeScreen;
  componentRegistry.ChatFileSourceSelector ??= FileSourceSelectorGrid;
  componentRegistry.AssistantFileSourceSelector ??= FileSourceSelectorGrid;
  componentRegistry.MessageControls ??= MessageControls;
  componentRegistry.ChatMessageRenderer ??= ChatMessageBubble;
};
