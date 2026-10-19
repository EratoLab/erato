import { TeamsAttachmentsPreview as SharedTeamsAttachmentsPreview } from "@erato/frontend/library";

import { useTeamsChatPicker } from "../providers/TeamsChatPickerProvider";

import type { ChatInputAttachmentPreviewProps } from "@erato/frontend/library";

/** The composer's attachment region in the Teams tab, fed the picker's transcript. */
export function TeamsAttachmentsPreview(
  props: ChatInputAttachmentPreviewProps,
) {
  const { attachedTranscript } = useTeamsChatPicker();
  return (
    <SharedTeamsAttachmentsPreview {...props} transcript={attachedTranscript} />
  );
}
