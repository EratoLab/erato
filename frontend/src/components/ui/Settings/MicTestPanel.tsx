import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import {
  audioLevelsToBarHeights,
  Waveform,
} from "@/components/ui/Chat/Waveform";
import { useAudioInputLevelPreview } from "@/hooks/audio/useAudioInputLevelPreview";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";

interface MicTestPanelProps {
  /** Currently selected device id; "" means the browser's default microphone. */
  deviceId: string;
  /**
   * False when the panel is not visible (dialog closed or another tab
   * active). The dialog keeps Audio-tab content mounted via `hidden=`, so we
   * use this prop to release the microphone on tab change / dialog close.
   */
  isAvailable: boolean;
}

export function MicTestPanel({ deviceId, isAvailable }: MicTestPanelProps) {
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!isAvailable) {
      setIsTesting(false);
    }
  }, [isAvailable]);

  const preview = useAudioInputLevelPreview({
    enabled: isTesting && isAvailable,
    deviceId,
  });

  const isLive = isTesting && preview.isActive;
  const activeDeviceLabel = preview.activeDeviceLabel;

  return (
    <div className="space-y-3" data-testid="mic-test-panel">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant={isTesting ? "primary" : "secondary"}
          size="sm"
          aria-pressed={isTesting}
          onClick={() => setIsTesting((current) => !current)}
        >
          {isTesting
            ? t({
                id: "preferences.dialog.audio.test.stop",
                message: "Stop test",
              })
            : t({
                id: "preferences.dialog.audio.test.start",
                message: "Test microphone",
              })}
        </Button>
        <span
          className="flex items-center text-theme-fg-secondary"
          aria-hidden="true"
        >
          <Waveform
            heights={audioLevelsToBarHeights(preview.bars)}
            animated
            testId="mic-test-waveform"
          />
        </span>
      </div>

      {isLive && activeDeviceLabel ? (
        <p
          className="text-sm text-theme-fg-muted"
          data-testid="mic-test-active-device"
        >
          {t({
            id: "preferences.dialog.audio.test.listening",
            message: `Listening on ${activeDeviceLabel}`,
          })}
        </p>
      ) : null}

      {preview.error ? (
        <Alert type="error" data-testid="mic-test-error">
          {preview.error}
        </Alert>
      ) : null}

      {preview.deviceIdMismatch ? (
        <Alert type="warning" data-testid="mic-test-mismatch">
          {t({
            id: "preferences.dialog.audio.test.mismatch",
            message:
              "The browser is recording from a different microphone than the one selected.",
          })}
        </Alert>
      ) : null}
    </div>
  );
}
