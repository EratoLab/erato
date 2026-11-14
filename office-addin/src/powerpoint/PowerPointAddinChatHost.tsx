import {
  useConversationDropzone,
  useUploadFeature,
} from "@erato/frontend/library";

import { PowerPointChatInput } from "./components/PowerPointChatInput";
import { AddinChatCoreView } from "../core/AddinChatCore";
import { AddinSettingsDialogCore } from "../core/AddinSettingsDialogCore";

import type { AddinChatHostProps } from "../core/AddinChatCore";

/** The neutral host, with a composer that offers the open presentation. */
export function PowerPointAddinChatHost({ controller }: AddinChatHostProps) {
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();
  const dropzone = useConversationDropzone({
    uploadFiles: controller.uploadFiles,
    onUploaded: (files) => controller.chatInputControls.addUploadedFiles(files),
    acceptedFileTypes: controller.acceptedFileTypes,
    isUploading: controller.isUploading,
    disabled: controller.composerLocked,
    maxSize: maxSizeBytes,
    maxSizeFormatted,
  });

  return (
    <AddinChatCoreView
      controller={controller}
      dropzone={dropzone}
      showDropOverlay={dropzone.isDragActive && dropzone.isDragAccept}
      renderInput={(props) => <PowerPointChatInput chatInputProps={props} />}
      renderSettings={(props) => <AddinSettingsDialogCore {...props} />}
    />
  );
}
