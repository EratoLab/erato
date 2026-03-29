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
 * When pulling upstream changes, keep your version of this file.
 * New upstream override keys will appear as `NewKey: null` — add
 * them to your copy to satisfy the TypeScript interface:
 * ```
 * git checkout --ours src/config/componentRegistry.ts
 * git add src/config/componentRegistry.ts
 * ```
 */

import type { AssistantWelcomeScreenProps } from "@/components/ui/Assistant/AssistantWelcomeScreen";
import type { ChatHistoryListProps } from "@/components/ui/Chat/ChatHistoryList";
import type { ChatMessageProps } from "@/components/ui/Chat/ChatMessage";
import type { ChatTopLeftAccessoryProps } from "@/components/ui/Chat/ChatTopLeftAccessory";
import type { StarterPromptsRendererProps } from "@/components/ui/Chat/StarterPromptsSection";
import type { FileSourceSelectorProps } from "@/components/ui/FileUpload/FileSourceSelector";
import type { WelcomeScreenProps } from "@/components/ui/WelcomeScreen";
import type { ChatInputAttachmentPreviewProps } from "@/types/chat-input-attachment-preview";
import type { MessageControlsProps } from "@/types/message-controls";
import type { ComponentType } from "react";

export interface EratoEmailCodeBlockProps {
  /** The raw text content inside the erato-email code block. */
  content: string;
}

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
   * Override for the inline attachment preview shown in the chat composer.
   * Used to render custom attachment chips/thumbnails inside the chat input shell.
   */
  ChatInputAttachmentPreview: ComponentType<ChatInputAttachmentPreviewProps> | null;

  /**
   * Override for the chat history list shown in the sidebar.
   * Used to customize row layout, metadata presentation, and action affordances.
   */
  ChatHistoryList: ComponentType<ChatHistoryListProps> | null;

  /**
   * Override for the default chat welcome/empty state component.
   * Used when a chat has no messages.
   */
  ChatWelcomeScreen: ComponentType<WelcomeScreenProps> | null;

  /**
   * Override for the starter prompts section rendered inside the default chat welcome screen.
   * Used to customize only the prompt suggestion presentation while keeping upstream data flow.
   */
  StarterPrompts: ComponentType<StarterPromptsRendererProps> | null;

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

  /**
   * Override for the entire chat message renderer.
   * Replaces the full message layout: avatar, bubble, content, controls, etc.
   *
   * Set to a custom component to:
   * - Change message alignment (e.g. right-align user messages)
   * - Use chat bubbles instead of full-width rows
   * - Rearrange avatar, name, content, and controls positioning
   *
   * The component receives the same props as the default ChatMessage,
   * including the resolved `controls` component as a building block.
   */
  ChatMessageRenderer: ComponentType<ChatMessageProps> | null;

  /**
   * Override for chat-level accessory UI positioned by the chat shell.
   * Used for customer-specific chrome such as a floating model selector.
   */
  ChatTopLeftAccessory: ComponentType<ChatTopLeftAccessoryProps> | null;

  /**
   * Override for rendering `erato-email` fenced code blocks in message content.
   * When set, intercepts code blocks with language tag `erato-email` and renders
   * a custom component instead of the default syntax highlighter.
   *
   * Used by the Office addin to render action buttons (Replace Selection, Insert
   * at Cursor) that interact with the Outlook compose body via Office.js APIs.
   *
   * When null, `erato-email` blocks render as plain preformatted text with a
   * Copy button.
   */
  EratoEmailCodeBlock: ComponentType<EratoEmailCodeBlockProps> | null;
}

export const resolveComponentOverride = <TProps>(
  override: ComponentType<TProps> | null,
  fallback: ComponentType<TProps>,
): ComponentType<TProps> => override ?? fallback;

/**
 * The component registry instance.
 *
 * In the main repo, all values are null (use defaults).
 * Customer forks modify this file to provide custom implementations.
 *
 * E2E test overrides are applied at startup via `initE2EOverrides()`
 * in `componentRegistryE2E.ts` (called from `main.tsx`).
 */
export const componentRegistry: ComponentRegistry = {
  AssistantFileSourceSelector: null,
  ChatFileSourceSelector: null,
  ChatInputAttachmentPreview: null,
  ChatHistoryList: null,
  ChatWelcomeScreen: null,
  StarterPrompts: null,
  AssistantWelcomeScreen: null,
  MessageControls: null,
  ChatMessageRenderer: null,
  ChatTopLeftAccessory: null,
  EratoEmailCodeBlock: null,
};
