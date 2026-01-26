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
import type { FileSourceSelectorProps } from "@/components/ui/FileUpload/FileSourceSelector";
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

  // Future extension points can be added here:
  // WelcomeScreen: ComponentType<WelcomeScreenProps> | null;
  // MessageControls: ComponentType<MessageControlsProps> | null;
}

/**
 * The component registry instance.
 *
 * In the main repo, all values are null (use defaults).
 * Customer forks modify this file to provide custom implementations.
 */
export const componentRegistry: ComponentRegistry = {
  AssistantFileSourceSelector: null,
  ChatFileSourceSelector: null,
};
