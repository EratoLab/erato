import {
  PopoverSectionHeader,
  Row,
  getSupportedFileTypes,
  useFileCapabilitiesContext,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { useTeamsChatFetcher } from "../hooks/useTeamsChatFetcher";
import { useTeamsChatPicker } from "../providers/TeamsChatPickerProvider";

import type { ChatAddMenuExtraContentProps } from "@erato/frontend/library";

/**
 * Teams contribution to the unified chat "+" menu: one row that opens the chat
 * picker. The dialog itself is owned by `TeamsChatPickerProvider` — this row
 * only hands over the composer's upload callback and closes the menu.
 */
export function TeamsChatAddMenuExtraContent({
  onSelectFiles,
  onClose,
  disabled = false,
  uploadDisabled = false,
  isProcessing = false,
}: ChatAddMenuExtraContentProps) {
  const { unavailableReason } = useTeamsChatFetcher();
  const { capabilities } = useFileCapabilitiesContext();
  const { open } = useTeamsChatPicker();

  // No Graph on this session means no chats to offer; a row that can only
  // apologise is worse than no row.
  if (unavailableReason !== null) {
    return null;
  }

  const supportsMarkdown = getSupportedFileTypes(capabilities).includes("text");
  const isDisabled =
    disabled ||
    uploadDisabled ||
    isProcessing ||
    !onSelectFiles ||
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
          if (!onSelectFiles) return;
          open(onSelectFiles);
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
            {supportsMarkdown
              ? t({
                  id: "officeAddin.teams.fileSource.chatsHint",
                  message: "Pick conversations or messages to attach",
                })
              : t({
                  id: "officeAddin.teams.fileSource.textUnsupported",
                  message: "This workspace can't accept text files",
                })}
          </div>
        </div>
      </Row>
    </>
  );
}
