import { Trans } from "@lingui/react/macro";

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
  <div
    role="note"
    data-testid="model-switch-marker"
    className="mb-4 flex w-full items-center justify-center gap-2 text-xs text-theme-fg-muted"
  >
    <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
    <span>
      <Trans id="chat.message.modelChanged">
        Model changed from {fromModel} to {toModel}
      </Trans>
    </span>
  </div>
);
