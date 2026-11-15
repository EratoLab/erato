import { PopoverSectionHeader, Row } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { usePowerPointComposer } from "./PowerPointComposerContext";

import type { ChatAddMenuExtraContentProps } from "@erato/frontend/library";

/**
 * PowerPoint's row in the unified "+" menu: a picture of the selected slide, attached to the
 * message as an ordinary image. Absent wherever the presentation chip would not offer it.
 */
export function PowerPointChatAddMenuExtraContent({
  onClose,
  disabled = false,
  uploadDisabled = false,
  isProcessing = false,
}: ChatAddMenuExtraContentProps) {
  const composer = usePowerPointComposer();
  const offer = composer?.slidePicture;
  if (!offer?.available) return null;

  return (
    <>
      <PopoverSectionHeader>
        {t({
          id: "officeAddin.powerpoint.fileSource.heading",
          message: "Presentation",
        })}
      </PopoverSectionHeader>
      <Row
        variant="menu"
        align="start"
        role="menuitem"
        tabIndex={-1}
        data-testid="powerpoint-add-menu-slide-picture"
        disabled={disabled || uploadDisabled || isProcessing || offer.busy}
        onClick={() => {
          offer.attach();
          onClose();
        }}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {t({
              id: "officeAddin.powerpoint.fileSource.slidePicture",
              message: "Picture of the selected slide",
            })}
          </div>
          <div className="truncate text-xs text-theme-fg-muted">
            {t({
              id: "officeAddin.powerpoint.fileSource.slidePictureHint",
              message: "Lets Erato see the layout, charts and pictures",
            })}
          </div>
        </div>
      </Row>
    </>
  );
}
