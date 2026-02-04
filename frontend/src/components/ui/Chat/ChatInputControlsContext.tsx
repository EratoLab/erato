import { createContext, useContext } from "react";

export type DraftMessageOptions = {
  focus?: boolean;
};

export interface ChatInputControls {
  setDraftMessage: (message: string, options?: DraftMessageOptions) => void;
  focusInput: () => void;
  setSelectedFacetIds: (facetIds: string[]) => void;
  toggleFacetId: (facetId: string) => void;
}

export type ChatInputControlsHandle = ChatInputControls;

const noop = () => {};

const defaultControls: ChatInputControls = {
  setDraftMessage: noop,
  focusInput: noop,
  setSelectedFacetIds: noop,
  toggleFacetId: noop,
};

const ChatInputControlsContext =
  createContext<ChatInputControls>(defaultControls);

export const ChatInputControlsProvider = ChatInputControlsContext.Provider;

export const useChatInputControls = (): ChatInputControls =>
  useContext(ChatInputControlsContext);
