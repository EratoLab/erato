import { createContext, useContext } from "react";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type DraftMessageOptions = {
  focus?: boolean;
};

export interface ChatInputControls {
  setDraftMessage: (message: string, options?: DraftMessageOptions) => void;
  focusInput: () => void;
  setSelectedFacetIds: (facetIds: string[]) => void;
  setSelectedChatProviderId: (chatProviderId: string) => void;
  toggleFacetId: (facetId: string) => void;
  addUploadedFiles: (files: FileUploadItem[]) => void;
}

export type ChatInputControlsHandle = ChatInputControls;

const noop = () => {};

const defaultControls: ChatInputControls = {
  setDraftMessage: noop,
  focusInput: noop,
  setSelectedFacetIds: noop,
  setSelectedChatProviderId: noop,
  toggleFacetId: noop,
  addUploadedFiles: noop,
};

const ChatInputControlsContext =
  createContext<ChatInputControls>(defaultControls);

export const ChatInputControlsProvider = ChatInputControlsContext.Provider;

export const useChatInputControls = (): ChatInputControls =>
  useContext(ChatInputControlsContext);
