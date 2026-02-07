/**
 * Component Registry
 *
 * This file provides extension points for customer forks to override
 * specific components without modifying core application code.
 *
 * ## How it works:
 * - Main repo: All values are `null` (use default implementations)
 * - Customer fork: Import custom components and assign them here
 *
 * ## For customer forks:
 * 1. Create your custom component in `/src/customer/components/`
 * 2. Import and assign it in this file
 * 3. The application will use your component instead of the default
 *
 * ## Merge strategy:
 * When pulling upstream changes, keep your version of this file:
 * ```
 * git checkout --ours src/config/componentRegistry.ts
 * git add src/config/componentRegistry.ts
 * ```
 */

import type { AssistantWelcomeScreenProps } from "@/components/ui/Assistant/AssistantWelcomeScreen";
import type { FileSourceSelectorProps } from "@/components/ui/FileUpload/FileSourceSelector";
import type { WelcomeScreenProps } from "@/components/ui/WelcomeScreen";
import type { MessageControlsProps } from "@/types/message-controls";
import type { ComponentType } from "react";

/**
 * Registry of overridable components.
 * Each key maps to either a custom component or null (use default).
 */
export interface ComponentRegistry {
  /**
   * Override for FileSourceSelector in the Assistant form.
   * Used when adding default files to an assistant.
   *
   * Set to a custom component to replace the default dropdown layout.
   * Example: A two-column grid of buttons instead of a dropdown menu.
   */
  AssistantFileSourceSelector: ComponentType<FileSourceSelectorProps> | null;

  /**
   * Override for FileSourceSelector in the Chat input.
   * Used when uploading files to a conversation.
   *
   * Set to a custom component to replace the default dropdown layout.
   */
  ChatFileSourceSelector: ComponentType<FileSourceSelectorProps> | null;

  /**
   * Override for the default chat welcome/empty state component.
   * Used when a chat has no messages.
   */
  ChatWelcomeScreen: ComponentType<WelcomeScreenProps> | null;

  /**
   * Override for the assistant chat welcome/empty state component.
   * Used when opening an assistant chat with no messages.
   */
  AssistantWelcomeScreen: ComponentType<AssistantWelcomeScreenProps> | null;

  /**
   * Override for message action controls (copy, edit, feedback buttons, etc.).
   * Used for every message in the chat.
   *
   * Set to a custom component to:
   * - Add custom actions (reactions, share, export, etc.)
   * - Remove unwanted buttons (hide feedback, hide edit, etc.)
   * - Change button styling or positioning
   */
  MessageControls: ComponentType<MessageControlsProps> | null;
}

export const resolveComponentOverride = <TProps>(
  override: ComponentType<TProps> | null,
  fallback: ComponentType<TProps>,
): ComponentType<TProps> => override ?? fallback;

const getE2EComponentVariant = () => {
  if (typeof window === "undefined") return null;
  return window.__E2E_COMPONENT_VARIANT__ ?? null;
};

const applyE2EOverrides = (registry: ComponentRegistry): ComponentRegistry => {
  const variant = getE2EComponentVariant();
  if (variant === "welcome-screen-example") {
    return {
      ...registry,
      ChatWelcomeScreen: registry.ChatWelcomeScreen ?? WelcomeScreenExample,
      AssistantWelcomeScreen:
        registry.AssistantWelcomeScreen ?? AssistantWelcomeScreenExample,
      ChatFileSourceSelector:
        registry.ChatFileSourceSelector ?? FileSourceSelectorGrid,
      AssistantFileSourceSelector:
        registry.AssistantFileSourceSelector ?? FileSourceSelectorGrid,
      MessageControls: registry.MessageControls ?? MessageControls,
    };
  }

  return registry;
};

/**
 * The component registry instance.
 *
 * In the main repo, all values are null (use defaults).
 * Customer forks modify this file to provide custom implementations.
 */
export const componentRegistry: ComponentRegistry = applyE2EOverrides({
  AssistantFileSourceSelector: null,
  ChatFileSourceSelector: null,
  ChatWelcomeScreen: null,
  AssistantWelcomeScreen: null,
  MessageControls: null, // Temporarily enabled to showcase the creative example
});
