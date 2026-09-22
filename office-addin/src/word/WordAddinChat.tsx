import {
  useConversationDropzone,
  useUploadFeature,
} from "@erato/frontend/library";
import { useMemo, useState } from "react";

import { WordChatInput } from "./components/WordChatInput";
import { WordSettingsDialog } from "./components/WordSettingsDialog";
import { useWordDocumentCaptures } from "./hooks/useWordDocumentCaptures";
import { WordWriteProvider } from "./providers/WordWriteProvider";
import { buildWordArtifact } from "./utils/buildWordArtifact";
import { resolveWordDocumentIdentity } from "./utils/wordDocumentIdentity";
import { AddinChatCore, AddinChatCoreView } from "../core/AddinChatCore";
import { useActionFacetClientActions } from "../core/clientActions/useAvailableActionFacets";

import type { AddinChatHostProps } from "../core/AddinChatCore";

export function WordAddinChat({ assistantId }: { assistantId?: string } = {}) {
  return <AddinChatCore assistantId={assistantId} Host={WordAddinChatHost} />;
}

function WordAddinChatHost({ controller }: AddinChatHostProps) {
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

  const [documentIdentity] = useState(resolveWordDocumentIdentity);

  const captures = useWordDocumentCaptures(controller);
  controller.hostCallbacksRef.current = captures.hostCallbacks;

  const clientActionsByFacetId = useActionFacetClientActions();
  const { messages, messageOrder } = controller;
  const { capturesByAssistantMessageId } = captures;
  const messagesWithArtifact = useMemo(() => {
    let next = messages;
    for (const id of messageOrder) {
      const message = messages[id];
      if (
        !message ||
        message.role !== "assistant" ||
        !message.previous_message_id
      ) {
        continue;
      }
      const facetId = messages[message.previous_message_id]?.action_facet_id;
      const hostArtifact = buildWordArtifact({
        facetId,
        clientActionInfo: facetId
          ? clientActionsByFacetId.get(facetId)
          : undefined,
        content: message.content,
        messageId: id,
        capture: capturesByAssistantMessageId.get(id),
      });
      if (!hostArtifact) continue;
      if (next === messages) next = { ...messages };
      next[id] = { ...message, hostArtifact };
    }
    return next;
  }, [
    capturesByAssistantMessageId,
    clientActionsByFacetId,
    messageOrder,
    messages,
  ]);

  return (
    <WordWriteProvider
      documentIdentity={documentIdentity}
      capturesByAssistantMessageId={capturesByAssistantMessageId}
    >
      <AddinChatCoreView
        controller={controller}
        dropzone={dropzone}
        showDropOverlay={dropzone.isDragActive && dropzone.isDragAccept}
        messages={messagesWithArtifact}
        renderInput={(props) => (
          <WordChatInput
            chatInputProps={props}
            documentIdentity={documentIdentity}
            stagePendingCapture={captures.stagePendingCapture}
          />
        )}
        renderSettings={(props) => <WordSettingsDialog {...props} />}
      />
    </WordWriteProvider>
  );
}
