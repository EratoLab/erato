import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import { useClientToolFileApprovalStore } from "@/hooks/chat/store/clientToolFileApprovalStore";

import { ActionConfirmationCard } from "./ActionConfirmationCard";
import { TaskChatLink } from "./TaskChatLink";
import { Card } from "../Container/Card";
import { FilePreviewContent } from "../FilePreview/FilePreviewContent";
import { OutlookSourceAction } from "../FilePreview/OutlookSourceAction";
import { AttachmentTile } from "../FileUpload/AttachmentTile";
import { ModalBase } from "../Modal/ModalBase";

import type { ClientToolFileApprovalRequest } from "@/hooks/chat/store/clientToolFileApprovalStore";

/** The same inline consent component as MCP, attached to the originating
 * message: for a delegated task's call, the message whose turn started it. */
export function ClientToolFileApprovals({
  messageId,
  taskBriefsByChatId,
}: {
  messageId: string;
  /** The brief of each task this message started, by the task's chat. */
  taskBriefsByChatId?: ReadonlyMap<string, string | undefined>;
}) {
  const requests = useClientToolFileApprovalStore((state) => state.requests);
  return requests
    .filter(
      (request) =>
        (request.context.hostGrant?.ownerMessageId ??
          request.context.messageId) === messageId,
    )
    .map((request) => (
      <ClientToolFileApprovalCard
        key={request.id}
        request={request}
        taskBrief={
          request.context.hostGrant
            ? taskBriefsByChatId?.get(
                request.context.hostGrant.requestingChatId,
              )
            : undefined
        }
      />
    ));
}

function ClientToolFileApprovalCard({
  request,
  taskBrief,
}: {
  request: ClientToolFileApprovalRequest;
  taskBrief?: string;
}) {
  const task = request.context.hostGrant?.requestingChatId;
  const brief =
    taskBrief ??
    t({
      id: "delegatedTaskApproval.unnamedTask",
      message: "A task this response started",
    });
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
          {task !== undefined && (
            <p
              className="text-sm text-theme-fg-secondary"
              data-testid="client-tool-file-approval-task"
            >
              {t({
                id: "chat.fileApproval.requestedByTask",
                message: `Requested by a task: ${brief}`,
              })}{" "}
              <TaskChatLink
                childChatId={task}
                testId="client-tool-file-approval-open-task"
              >
                {t({
                  id: "chat.fileApproval.openTask",
                  message: "Open the task",
                })}
              </TaskChatLink>
            </p>
          )}
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "chat.fileApproval.description",
              message:
                "Selected files will be uploaded to Erato and their contents shared with the AI provider. Preview files before deciding.",
            })}
          </p>
          <div className="flex flex-col gap-2">
            {request.files.map((file, index) => (
              <Card
                key={index}
                variant="selectable"
                control="checkbox"
                tone="muted"
                nested
                selected={selected.has(file)}
                bodyClassName="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center"
              >
                <AttachmentTile
                  file={file}
                  variant="bare"
                  className="min-w-0 flex-1"
                  onActivate={() => setPreview(file)}
                  selection={{
                    selected: selected.has(file),
                    onToggle: () => toggleFile(file),
                  }}
                />
                {request.outlookProvenance?.has(file) && (
                  <div className="shrink-0">
                    <OutlookSourceAction
                      provenance={request.outlookProvenance.get(file)}
                    />
                  </div>
                )}
              </Card>
            ))}
          </div>
          {preview && previewUrl && (
            <ModalBase
              isOpen
              onClose={() => setPreview(null)}
              title={`${t`Preview:`} ${preview.name}`}
              contentClassName="max-w-4xl"
            >
              <FilePreviewContent
                filename={preview.name}
                mimeType={preview.type}
                url={previewUrl}
              />
              <div className="mt-4 flex justify-center">
                <OutlookSourceAction
                  key={request.files.indexOf(preview)}
                  provenance={request.outlookProvenance?.get(preview)}
                />
              </div>
            </ModalBase>
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
