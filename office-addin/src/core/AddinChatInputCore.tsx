import {
  ChatInput,
  type AssistantMention,
  type ChatInputControlsHandle,
  type ChatModel,
  type ComposerSizeLimit,
  type DelegationRunMode,
  type FileType,
  type FileUploadItem,
} from "@erato/frontend/library";
import { forwardRef } from "react";

export interface AddinChatInputCoreProps {
  onSendMessage: (
    message: string,
    inputFileIds?: string[],
    modelId?: string,
    selectedFacetIds?: string[],
    mentionedAssistants?: AssistantMention[],
    delegationRunMode?: DelegationRunMode,
    /**
     * Present only on the first send of a new chat whose writes the user
     * turned off beforehand; every hop must hand it on or the chat row is
     * created with writes on while the switch shows off.
     */
    mcpWriteToolsEnabled?: boolean,
    /** Likewise for the servers switched off before the chat existed. */
    disabledMcpServerIds?: string[],
  ) => void;
  handleFileAttachments?: (files: FileUploadItem[]) => void;
  isLoading?: boolean;
  disabled?: boolean;
  acceptedFileTypes?: FileType[];
  onFilePreview?: (file: FileUploadItem) => void;
  chatId?: string | null;
  assistantId?: string;
  initialModel?: ChatModel | null;
  initialSelectedFacetIds?: string[];
  onFacetSelectionChange?: (selectedFacetIds: string[]) => void;
  uploadFiles?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  uploadError?: Error | string | null;
  sizeLimitExceeded?: ComposerSizeLimit | null;
  virtualFiles?: File[];
  maxFiles?: number;
  controlledAvailableModels?: ChatModel[];
  controlledSelectedModel?: ChatModel | null;
  onControlledSelectedModelChange?: (model: ChatModel) => void;
  controlledIsModelSelectionReady?: boolean;
  /**
   * Set by a host whose own action proposals the per-chat write switch
   * pauses too, so the switch's description names them. The neutral
   * composer leaves it unset: it proposes no actions of its own.
   */
  pausesHostActionsWhenWritesOff?: boolean;
}

/** Generic add-in composer. It has no host context, chips, or action facets. */
export const AddinChatInputCore = forwardRef<
  ChatInputControlsHandle,
  AddinChatInputCoreProps
>(function AddinChatInputCore(props, ref) {
  return (
    <ChatInput
      ref={ref}
      className="p-2 sm:p-4"
      showControls={true}
      showFileTypes={true}
      {...props}
    />
  );
});
