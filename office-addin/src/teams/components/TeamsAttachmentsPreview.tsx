import {
  FileAttachmentsPreview,
  GroupedFileAttachmentsPreview,
} from "@erato/frontend/library";
import { useMemo } from "react";

import { useTeamsChatPicker } from "../providers/TeamsChatPickerProvider";
import { buildTeamsAttachmentGroups } from "../utils/teamsAttachmentGroups";

import type { FileAttachmentsPreviewProps } from "@erato/frontend/library";

/**
 * The composer's attachment region in the Teams tab: an attached transcript is
 * shown as the conversation it came from, with its images and shared files
 * sitting under the messages they arrived with.
 *
 * Anything the picker did not produce — a file added by another route, or a
 * transcript whose sections this session no longer holds — keeps the ordinary
 * flat chips underneath.
 */
export function TeamsAttachmentsPreview(props: FileAttachmentsPreviewProps) {
  const { attachedTranscript } = useTeamsChatPicker();
  const { attachedFiles } = props;
  const preview = useMemo(
    () => buildTeamsAttachmentGroups(attachedTranscript, attachedFiles),
    [attachedTranscript, attachedFiles],
  );

  if (!preview) {
    return <FileAttachmentsPreview {...props} />;
  }

  const rest = attachedFiles.filter(
    (file) => !preview.claimedFileIds.has(file.id),
  );

  return (
    <>
      <GroupedFileAttachmentsPreview
        groups={preview.groups}
        onRemoveFile={props.onRemoveFile}
        disabled={props.disabled}
        showFileTypes={props.showFileTypes}
        showFileSizes={props.showFileSizes}
        defaultVisibleItems={10}
      />
      <FileAttachmentsPreview {...props} attachedFiles={rest} />
    </>
  );
}
