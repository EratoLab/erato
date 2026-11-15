import {
  useConversationDropzone,
  useUploadFeature,
} from "@erato/frontend/library";
import { useState } from "react";

import { PowerPointChatInput } from "./components/PowerPointChatInput";
import { AddinChatCoreView } from "../core/AddinChatCore";
import { AddinSettingsDialogCore } from "../core/AddinSettingsDialogCore";

import type { AddinChatHostProps } from "../core/AddinChatCore";

/** The neutral host, with a composer that offers the open presentation. */
export function PowerPointAddinChatHost({ controller }: AddinChatHostProps) {
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();
  const [slidePictureBusy, setSlidePictureBusy] = useState(false);
  const dropzone = useConversationDropzone({
    uploadFiles: controller.uploadFiles,
    onUploaded: (files) => controller.chatInputControls.addUploadedFiles(files),
    acceptedFileTypes: controller.acceptedFileTypes,
    isUploading: controller.isUploading,
    // A drop while a slide picture is made would take the room it was counted against.
    disabled: controller.composerLocked || slidePictureBusy,
    maxSize: maxSizeBytes,
    maxSizeFormatted,
  });

  return (
    <AddinChatCoreView
      controller={controller}
      dropzone={dropzone}
      showDropOverlay={dropzone.isDragActive && dropzone.isDragAccept}
      renderInput={(props) => (
        <PowerPointChatInput
          chatInputProps={props}
          onSlidePictureBusyChange={setSlidePictureBusy}
        />
      )}
      renderSettings={(props) => <AddinSettingsDialogCore {...props} />}
    />
  );
}
