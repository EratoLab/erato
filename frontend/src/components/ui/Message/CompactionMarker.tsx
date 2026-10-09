import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { MessageContent } from "./MessageContent";
import { TranscriptNotice } from "./TranscriptNotice";
import { Button } from "../Controls/Button";
import { Collapse } from "../Controls/Collapse";

import type {
  ContentPart,
  ContentPartCompactionMarker,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export function CompactionMarker({
  marker,
  content,
  messageId,
  filesById,
  onFilePreview,
}: {
  marker: ContentPartCompactionMarker;
  content: ContentPart[];
  messageId: string;
  filesById: Record<string, FileUploadItem>;
  onFilePreview?: (file: FileUploadItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const before = marker.before_tokens.toLocaleString();
  const after = marker.after_tokens.toLocaleString();
  const percent =
    marker.before_tokens === 0
      ? 0
      : Math.round((marker.after_tokens / marker.before_tokens) * 100);
  const retainedFiles = marker.after_files;
  const totalFiles = marker.before_files;
  return (
    <div data-testid="compaction-marker" className="my-3 space-y-2">
      <TranscriptNotice role="note">
        {t({
          id: "chat.compaction.marker",
          message: `Chat history compacted. Retained ${after} of ${before} estimated tokens (${percent}%) and ${retainedFiles} of ${totalFiles} files.`,
        })}
      </TranscriptNotice>
      <div className="text-center">
        <Button
          type="button"
          variant="secondary"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open
            ? t({ id: "chat.compaction.hideSummary", message: "Hide summary" })
            : t({ id: "chat.compaction.showSummary", message: "Show summary" })}
        </Button>
      </div>
      <Collapse isOpen={open}>
        <div id={id} inert={!open} aria-hidden={!open}>
          {open && (
            <MessageContent
              content={content.filter((part) => part.content_type === "text")}
              messageId={messageId}
              filesById={filesById}
              onFileLinkPreview={onFilePreview}
            />
          )}
        </div>
      </Collapse>
    </div>
  );
}
