import {
  useConversationDropzone,
  useUploadFeature,
} from "@erato/frontend/library";
import { useRef, useState } from "react";

import { PowerPointChatInput } from "./components/PowerPointChatInput";
import { AddinChatCoreView } from "../core/AddinChatCore";
import { AddinSettingsDialogCore } from "../core/AddinSettingsDialogCore";

import type { AddinChatHostProps } from "../core/AddinChatCore";

/** The neutral host, with a composer that offers the open presentation. */
export function PowerPointAddinChatHost({ controller }: AddinChatHostProps) {
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();
  const [slidePictureBusy, setSlidePictureBusy] = useState(false);
  // Regenerate and edit send no model: the server reruns on the model of the earlier answer,
  // which the pane does not know, so the slide picture is not offered for such a turn.
  const rerunRef = useRef(false);
  controller.hostCallbacksRef.current = {
    beforeEdit: () => {
      rerunRef.current = true;
    },
    beforeRegenerate: () => {
      rerunRef.current = true;
    },
  };
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
          rerunRef={rerunRef}
        />
      )}
      renderSettings={(props) => (
        <AddinSettingsDialogCore {...props} supportsDisclaimers />
      )}
    />
  );
}
