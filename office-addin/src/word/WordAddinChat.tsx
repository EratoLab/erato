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

/** Word composition of the generic chat surface. */
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

  // Minted once per pane load and held in memory — nothing is written into the
  // file. Owned here rather than inside the read hook so the chip's
  // reset-on-document-change is driven by a value the host can change.
  const [documentIdentity] = useState(resolveWordDocumentIdentity);

  // `capturesByAssistantMessageId` is the write path's input: the card
  // resolves the model's ordinals against the capture stamped on the replying
  // message, and fails closed when this pane no longer has it.
  const captures = useWordDocumentCaptures(controller);
  controller.hostCallbacksRef.current = captures.hostCallbacks;

  // The artifact envelope: what makes the registered Word fences render as cards at
  // all, and what carries the consent policy and the send-time identity onto
  // each assistant message. Built here, where both the facet the send used and
  // the capture it produced are known.
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
