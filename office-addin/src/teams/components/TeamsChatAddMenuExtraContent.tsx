import { PopoverSectionHeader, Row } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { useTeamsComposer } from "./TeamsComposerContext";
import { useTeamsPickerAvailability } from "../hooks/useTeamsPickerAvailability";
import { useTeamsChatPicker } from "../providers/TeamsChatPickerProvider";

import type { ChatAddMenuExtraContentProps } from "@erato/frontend/library";

/**
 * Teams contribution to the unified chat "+" menu: one row that opens the chat
 * picker. The dialog itself is owned by `TeamsChatPickerProvider` — this row
 * only hands over the composer and closes the menu. With a transcript staged,
 * the row edits it instead of attaching a second one.
 */
export function TeamsChatAddMenuExtraContent({
  onSelectFiles,
  onClose,
  disabled = false,
  uploadDisabled = false,
  isProcessing = false,
}: ChatAddMenuExtraContentProps) {
  const { available, capabilitiesReady, supportsMarkdown } =
    useTeamsPickerAvailability();
  const { open } = useTeamsChatPicker();
  const composer = useTeamsComposer();

  // No Graph on this session means no chats to offer; a row that can only
  // apologise is worse than no row.
  if (!available) {
    return null;
  }

  const edit = composer?.stagedTranscript ?? null;
  // An edit replaces its own files, so a full composer does not stop it.
  const isDisabled =
    disabled ||
    (uploadDisabled && !edit) ||
    isProcessing ||
    !onSelectFiles ||
    !composer ||
    !capabilitiesReady ||
    !supportsMarkdown;

  return (
    <>
      <PopoverSectionHeader>
        {t({
          id: "officeAddin.teams.fileSource.heading",
          message: "Teams content",
        })}
      </PopoverSectionHeader>
      <Row
        variant="menu"
        align="start"
        role="menuitem"
        tabIndex={-1}
        data-testid="teams-add-menu-chats"
        disabled={isDisabled}
        onClick={() => {
          if (!composer) return;
          open(composer.bridge, edit ? { edit } : undefined);
          onClose();
        }}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {t({
              id: "officeAddin.teams.fileSource.chats",
              message: "Teams chats…",
            })}
          </div>
          <div className="truncate text-xs text-theme-fg-muted">
            {capabilitiesReady && !supportsMarkdown
              ? t({
                  id: "officeAddin.teams.fileSource.textUnsupported",
                  message: "This workspace can't accept text files",
                })
              : edit
                ? t({
                    id: "officeAddin.teams.fileSource.chatsEditHint",
                    message: "Edit the conversations in your transcript",
                  })
                : t({
                    id: "officeAddin.teams.fileSource.chatsHint",
                    message: "Pick conversations or messages to attach",
                  })}
          </div>
        </div>
      </Row>
    </>
  );
}
