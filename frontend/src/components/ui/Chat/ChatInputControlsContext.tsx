import { createContext, useContext } from "react";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type DraftMessageOptions = {
  focus?: boolean;
  /** Keep what the user already typed instead of replacing it. */
  onlyIfEmpty?: boolean;
};

export interface ChatInputControls {
  setDraftMessage: (message: string, options?: DraftMessageOptions) => void;
  /**
   * Adds a block after what the user typed: an empty line before it when
   * there is text, an empty line after it, the caret at the end and the
   * composer focused. Optional, so a provider value built before shared
   * surface 1.28 still satisfies the type; callers use `?.()`.
   */
  appendToDraft?: (block: string) => void;
  focusInput: () => void;
  setSelectedFacetIds: (facetIds: string[]) => void;
  setSelectedChatProviderId: (chatProviderId: string) => void;
  toggleFacetId: (facetId: string) => void;
  addUploadedFiles: (files: FileUploadItem[]) => void;
  /** Unstages files by id, for hosts that own some of the staged files. */
  removeUploadedFiles: (fileIds: string[]) => void;
  /** Drops any queued follow-up, e.g. when an edit supersedes its branch. */
  clearQueuedMessage: () => void;
}

export type ChatInputControlsHandle = ChatInputControls;

const noop = () => {};

const defaultControls: ChatInputControls = {
  setDraftMessage: noop,
  appendToDraft: noop,
  focusInput: noop,
  setSelectedFacetIds: noop,
  setSelectedChatProviderId: noop,
  toggleFacetId: noop,
  addUploadedFiles: noop,
  removeUploadedFiles: noop,
  clearQueuedMessage: noop,
};

const ChatInputControlsContext =
  createContext<ChatInputControls>(defaultControls);

export const ChatInputControlsProvider = ChatInputControlsContext.Provider;

export const useChatInputControls = (): ChatInputControls =>
  useContext(ChatInputControlsContext);
