import {
  FileAttachmentsPreview,
  GroupedFileAttachmentsPreview,
  ModalBase,
  TeamsConversationView,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useMemo, useState } from "react";

import { useTeamsTranscriptIndex } from "../hooks/useTeamsTranscriptIndex";
import { useTeamsChatPicker } from "../providers/TeamsChatPickerProvider";
import { buildTeamsAttachmentGroups } from "../utils/teamsAttachmentGroups";

import type {
  FileAttachmentsPreviewProps,
  TeamsTranscriptIndexAsset,
  TeamsTranscriptIndexMessage,
} from "@erato/frontend/library";

/**
 * The composer's attachment region in the Teams tab: an attached transcript is
 * shown as the conversation it came from, with its images and shared files
 * sitting under the messages they arrived with.
 *
 * The conversation is read out of the transcript file itself, which is the one
 * description of it that outlives this session.
 *
 * Anything the picker did not produce — a file added by another route, or a
 * transcript whose index block cannot be read — keeps the ordinary flat chips
 * underneath.
 */
export function TeamsAttachmentsPreview(props: FileAttachmentsPreviewProps) {
  const { attachedTranscript } = useTeamsChatPicker();
  const { index, isReading } = useTeamsTranscriptIndex(attachedTranscript);
  const { attachedFiles } = props;
  const [openSection, setOpenSection] = useState<number | null>(null);
  const preview = useMemo(
    () =>
      buildTeamsAttachmentGroups(
        attachedTranscript && index
          ? { fileName: attachedTranscript.name, index }
          : null,
        attachedFiles,
        setOpenSection,
      ),
    [attachedTranscript, index, attachedFiles],
  );

  // The composer already holds every upload the transcript names, so the view
  // never fetches: it is handed the file that is sitting in the same state.
  const resolveAsset = useCallback(
    (asset: TeamsTranscriptIndexAsset) =>
      attachedFiles.find((file) => file.filename === asset.name) ?? null,
    [attachedFiles],
  );

  const openInTeams = useCallback((message: TeamsTranscriptIndexMessage) => {
    window.open(message.deepLink, "_blank", "noopener,noreferrer");
  }, []);

  if (!preview) {
    // Reading an in-memory file settles within a frame or two. Leaving the
    // region empty for that long beats mounting the flat chips and pulling them
    // straight back out from under the user the moment the block parses.
    if (isReading) return null;
    return <FileAttachmentsPreview {...props} />;
  }

  const rest = attachedFiles.filter(
    (file) => !preview.claimedFileIds.has(file.id),
  );
  const openTitle =
    openSection === null
      ? ""
      : (index?.sections[openSection]?.title ??
        t({
          id: "officeAddin.teams.preview.conversationTitle",
          message: "Teams conversation",
        }));

  return (
    <>
      <div
        className="max-h-[40vh] overflow-y-auto overscroll-none pr-1 focus:outline-none focus:ring-2 focus:ring-theme-focus"
        role="region"
        // A bounded scroll area needs a focus target before a keyboard user can
        // arrow or page through it.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        aria-label={t({
          id: "officeAddin.teams.preview.conversationRegion",
          message: "Teams conversation preview",
        })}
      >
        <GroupedFileAttachmentsPreview
          groups={preview.groups}
          onRemoveFile={props.onRemoveFile}
          disabled={props.disabled}
          showFileTypes={props.showFileTypes}
          showFileSizes={props.showFileSizes}
          defaultVisibleItems={10}
          stickyGroupHeaders={true}
        />
      </div>
      <FileAttachmentsPreview {...props} attachedFiles={rest} />
      {index && openSection !== null && (
        <ModalBase
          isOpen={true}
          onClose={() => setOpenSection(null)}
          title={openTitle}
        >
          <TeamsConversationView
            index={index}
            sectionIndex={openSection}
            onOpenInTeams={openInTeams}
            resolveAsset={resolveAsset}
          />
        </ModalBase>
      )}
    </>
  );
}
