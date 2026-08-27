import {
  FileAttachmentsPreview,
  GroupedFileAttachmentsPreview,
  ModalBase,
  TeamsConversationView,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTeamsTranscriptIndex } from "../hooks/useTeamsTranscriptIndex";
import { useTeamsChatPicker } from "../providers/TeamsChatPickerProvider";
import { buildTeamsAttachmentGroups } from "../utils/teamsAttachmentGroups";

import type {
  ChatInputAttachmentPreviewProps,
  FileResource,
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
export function TeamsAttachmentsPreview(
  props: ChatInputAttachmentPreviewProps,
) {
  const { attachedTranscript } = useTeamsChatPicker();
  const { index, isReading } = useTeamsTranscriptIndex(attachedTranscript);
  const { attachedFiles, onFilePreview } = props;
  const [openSection, setOpenSection] = useState<number | null>(null);

  // Section positions only mean anything against the index they came from, so a
  // different transcript closes whatever was open rather than reopening it at a
  // position that now points somewhere else, or nowhere.
  useEffect(() => setOpenSection(null), [attachedTranscript]);
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

  // `resolveAsset` only ever hands back an upload out of this same list, so
  // matching on identity narrows it to the composer's own file type.
  const previewAsset = useMemo(
    () =>
      onFilePreview
        ? (file: FileResource) => {
            const upload = attachedFiles.find(
              (candidate) => candidate === file,
            );
            if (upload) onFilePreview(upload);
          }
        : undefined,
    [attachedFiles, onFilePreview],
  );

  const openInTeams = useCallback((message: TeamsTranscriptIndexMessage) => {
    window.open(message.deepLink, "_blank", "noopener,noreferrer");
  }, []);

  // Stable, so the modal's focus-on-open effect does not re-run and pull focus
  // off whatever the reader had it on every time the composer re-renders.
  const closeConversation = useCallback(() => setOpenSection(null), []);

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
  // The modal names the conversation, so the view inside it does not — see
  // `showTitle` below.
  const openSectionData =
    openSection === null ? undefined : index?.sections[openSection];
  const openTitle = openSectionData
    ? [openSectionData.title, openSectionData.teamName]
        .filter((part) => part)
        .join(" · ")
    : t({
        id: "officeAddin.teams.preview.conversationTitle",
        message: "Teams conversation",
      });

  return (
    <>
      <div
        className="max-h-[40vh] overflow-y-auto overscroll-none pr-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
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
          defaultVisibleItems={10}
          stickyGroupHeaders={true}
        />
      </div>
      <FileAttachmentsPreview {...props} attachedFiles={rest} />
      {index && openSection !== null && (
        <ModalBase isOpen={true} onClose={closeConversation} title={openTitle}>
          <TeamsConversationView
            index={index}
            sectionIndex={openSection}
            showTitle={false}
            onOpenInTeams={openInTeams}
            onFilePreview={previewAsset}
            resolveAsset={resolveAsset}
          />
        </ModalBase>
      )}
    </>
  );
}
