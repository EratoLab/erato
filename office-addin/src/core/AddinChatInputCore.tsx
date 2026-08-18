import {
  ChatInput,
  type ChatInputControlsHandle,
  type ChatModel,
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
    mentionedAssistantIds?: string[],
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
  virtualFiles?: File[];
  maxFiles?: number;
  controlledAvailableModels?: ChatModel[];
  controlledSelectedModel?: ChatModel | null;
  onControlledSelectedModelChange?: (model: ChatModel) => void;
  controlledIsModelSelectionReady?: boolean;
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
