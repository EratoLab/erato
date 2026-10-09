import {
  Button,
  OpenNewWindowIcon,
  wordShowInWordLabel,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useState } from "react";

import type { WordSelectionShowResult } from "../utils/wordSelectionTarget";

export const wordLocationChangedText = () =>
  t({
    id: "officeAddin.word.review.locationChanged",
    message:
      "This passage changed or moved. Its exact location can no longer be verified.",
  });

/**
 * Selects a proven passage in Word. Selecting moves the user's selection, which a later action may
 * act on, so the result is said. A passage that can no longer be proven stays unavailable.
 */
export function WordShowInWordButton({
  onShow,
  disabled,
  unavailableReason,
}: {
  onShow: () => Promise<WordSelectionShowResult>;
  disabled: boolean;
  /** Why no passage can be selected; the button is then disabled and the reason shown. */
  unavailableReason?: string;
}) {
  const [showing, setShowing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [lost, setLost] = useState(false);
  const reason =
    unavailableReason ?? (lost ? wordLocationChangedText() : undefined);
  return (
    <>
      <Button
        type="button"
        variant="link"
        className="word-review__locate"
        icon={
          reason ? undefined : <OpenNewWindowIcon className="size-4 shrink-0" />
        }
        disabled={disabled || showing || !!reason}
        onClick={() => {
          setShowing(true);
          void onShow()
            .then((result) => {
              if (result === "selected") {
                setMessage(
                  t({
                    id: "officeAddin.word.review.selected",
                    message:
                      "Passage selected in Word. This may change the insertion location for a later action.",
                  }),
                );
                return;
              }
              setMessage(undefined);
              if (result === "changed") setLost(true);
              else
                setMessage(
                  t({
                    id: "officeAddin.word.selection.showUnavailable",
                    message:
                      "Word did not select the passage. Try again in a moment.",
                  }),
                );
            })
            .finally(() => setShowing(false));
        }}
      >
        {reason
          ? t({
              id: "officeAddin.word.review.locationUnavailable",
              message: "Location unavailable",
            })
          : wordShowInWordLabel()}
      </Button>
      {(reason ?? message) && (
        <p className="word-review__hint" role="status">
          {reason ?? message}
        </p>
      )}
    </>
  );
}
