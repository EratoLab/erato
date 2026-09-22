import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import { useClientToolFileApprovalStore } from "@/hooks/chat/store/clientToolFileApprovalStore";

import { ActionConfirmationCard } from "./ActionConfirmationCard";
import { FilePreviewContent } from "../FilePreview/FilePreviewContent";
import { AttachmentTile } from "../FileUpload/AttachmentTile";

import type { ClientToolFileApprovalRequest } from "@/hooks/chat/store/clientToolFileApprovalStore";

/** The same inline consent component as MCP, attached to the originating message. */
export function ClientToolFileApprovals({ messageId }: { messageId: string }) {
  const requests = useClientToolFileApprovalStore((state) => state.requests);
  return requests
    .filter((request) => request.context.messageId === messageId)
    .map((request) => (
      <ClientToolFileApprovalCard key={request.id} request={request} />
    ));
}

function ClientToolFileApprovalCard({
  request,
}: {
  request: ClientToolFileApprovalRequest;
}) {
  const selected = request.selected;
  const toggleFile = (file: File) => {
    useClientToolFileApprovalStore.setState((state) => ({
      requests: state.requests.map((item) => {
        if (item.id !== request.id) return item;
        const next = new Set(item.selected);
        if (next.has(file)) next.delete(file);
        else next.add(file);
        return { ...item, selected: next };
      }),
    }));
  };
  const [preview, setPreview] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    if (!preview) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  return (
    <ActionConfirmationCard
      title={t({
        id: "chat.fileApproval.title",
        message: "Allow these files to be uploaded?",
      })}
      description={
        <>
          <p className="mb-4 text-sm text-theme-fg-secondary">
            {t({
              id: "chat.fileApproval.description",
              message:
                "Selected files will be uploaded to Erato and their contents shared with the AI provider. Preview files before deciding.",
            })}
          </p>
          <div className="flex flex-col gap-2">
            {request.files.map((file, index) => (
              <AttachmentTile
                key={index}
                file={file}
                variant="row"
                onActivate={() =>
                  setPreview((current) => (current === file ? null : file))
                }
                selection={{
                  selected: selected.has(file),
                  onToggle: () => toggleFile(file),
                }}
              />
            ))}
          </div>
          {preview && previewUrl && (
            <div className="my-4">
              <FilePreviewContent
                filename={preview.name}
                mimeType={preview.type}
                url={previewUrl}
              />
            </div>
          )}
        </>
      }
      onAllowOnce={() => request.finish(selected)}
      allowOnceLabel={t({
        id: "chat.fileApproval.approve",
        message: "Upload selected files",
      })}
      onDeny={() => request.finish(new Set())}
      denyLabel={t({ id: "chat.fileApproval.reject", message: "Reject all" })}
      scrollIntoViewOnMount
      data-testid="client-tool-file-approval"
    />
  );
}
