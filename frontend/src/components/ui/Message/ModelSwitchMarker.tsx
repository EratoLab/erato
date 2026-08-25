import { Trans } from "@lingui/react/macro";

import { TranscriptNotice } from "./TranscriptNotice";
import { InfoIcon } from "../icons";

/**
 * Marks a historical model transition in the conversation transcript.
 */
export const ModelSwitchMarker = ({
  fromModel,
  toModel,
}: {
  fromModel: string;
  toModel: string;
}) => (
  <TranscriptNotice
    role="note"
    data-testid="model-switch-marker"
    className="text-theme-fg-muted"
    // Separates the marker from the turn it introduces, on the same scale as
    // the message padding so a theme that loosens messages loosens this too.
    style={{ marginBottom: "var(--theme-spacing-message-padding-y)" }}
    icon={<InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />}
  >
    <Trans id="chat.message.modelChanged">
      Model changed from {fromModel} to {toModel}
    </Trans>
  </TranscriptNotice>
);
