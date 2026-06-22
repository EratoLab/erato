import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo, useState } from "react";

import { useAudioInputDevicePreference } from "@/hooks/audio/useAudioInputDevicePreference";

import { GuidedMicCheck } from "./GuidedMicCheck";
import { MicTestPanel } from "./MicTestPanel";
import { Button } from "../Controls/Button";
import { DropdownMenu, type DropdownMenuItem } from "../Controls/DropdownMenu";
import { Alert } from "../Feedback/Alert";
import { ChevronDownIcon } from "../icons";

interface AudioInputTabContentProps {
  /**
   * Whether the surrounding panel is currently visible. Dialogs keep the tab
   * mounted via `hidden=`, so this is forwarded to {@link MicTestPanel} to
   * release the microphone when the tab is not shown (tab change / dialog
   * close). Pass `isOpen && activeTab === "audio"`.
   */
  isActive: boolean;
}

/**
 * Shared microphone settings body: input-device selection, a refresh control, a
 * diagnostics readout, and an in-place microphone test. Like
 * {@link AppearanceTabContent}, this renders no section heading — the consuming
 * dialog supplies its own — so it can be reused by both the web preferences
 * dialog and the Office add-in settings dialog with host-appropriate copy.
 */
export function AudioInputTabContent({ isActive }: AudioInputTabContentProps) {
  const {
    audioInputDeviceError,
    audioInputDevices,
    isLoadingAudioInputDevices,
    refreshAudioInputDevices,
    selectedAudioInputDeviceId,
    setSelectedAudioInputDeviceId,
  } = useAudioInputDevicePreference();
  const [isAudioInputDropdownOpen, setIsAudioInputDropdownOpen] =
    useState(false);

  const audioInputDefaultLabel = t({
    id: "preferences.dialog.audio.input.default",
    message: "System default microphone",
  });
  const audioInputItems = useMemo<DropdownMenuItem[]>(
    () => [
      {
        id: "audio-input-default",
        label: audioInputDefaultLabel,
        checked: selectedAudioInputDeviceId === "",
        onClick: () => setSelectedAudioInputDeviceId(""),
      },
      ...audioInputDevices.map((device) => ({
        id: `audio-input-${device.deviceId}`,
        label: device.label,
        checked: device.deviceId === selectedAudioInputDeviceId,
        onClick: () => setSelectedAudioInputDeviceId(device.deviceId),
      })),
    ],
    [
      audioInputDefaultLabel,
      audioInputDevices,
      selectedAudioInputDeviceId,
      setSelectedAudioInputDeviceId,
    ],
  );
  const selectedAudioInputLabel = useMemo(() => {
    if (!selectedAudioInputDeviceId) {
      return audioInputDefaultLabel;
    }
    return (
      audioInputDevices.find(
        (device) => device.deviceId === selectedAudioInputDeviceId,
      )?.label ?? audioInputDefaultLabel
    );
  }, [audioInputDefaultLabel, audioInputDevices, selectedAudioInputDeviceId]);

  const inputDeviceCount = audioInputDevices.length;

  return (
    <div className="space-y-4">
      {audioInputDeviceError ? (
        <Alert type="error">{audioInputDeviceError}</Alert>
      ) : null}

      <DropdownMenu
        id="preferences-audio-input-device"
        items={audioInputItems}
        align="left"
        triggerButtonVariant="secondary"
        triggerButtonClassName="w-full justify-between gap-2 rounded-[var(--theme-radius-input)] px-3 py-2 shadow-sm"
        matchContentWidth={false}
        onOpenChange={setIsAudioInputDropdownOpen}
        triggerIcon={
          <div
            className="flex min-w-0 flex-1 items-center gap-2"
            data-testid="audio-input-dropdown-trigger"
          >
            <span
              className="min-w-0 flex-1 truncate text-left text-sm text-theme-fg-primary"
              title={selectedAudioInputLabel}
            >
              {selectedAudioInputLabel}
            </span>
            <ChevronDownIcon
              className={clsx(
                "size-4 shrink-0 text-theme-fg-secondary transition-transform duration-200",
                isAudioInputDropdownOpen && "rotate-180",
              )}
              aria-hidden="true"
            />
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-theme-fg-muted">
          {audioInputDevices.length === 0
            ? t({
                id: "preferences.dialog.audio.input.empty",
                message:
                  "No microphones were found. Browser permission may be required before device names are available.",
              })
            : t({
                id: "preferences.dialog.audio.input.persisted",
                message: "This selection is saved locally in this browser.",
              })}
        </p>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={isLoadingAudioInputDevices}
          onClick={() => {
            void refreshAudioInputDevices();
          }}
        >
          {isLoadingAudioInputDevices
            ? t({
                id: "preferences.dialog.audio.input.refreshing",
                message: "Refreshing...",
              })
            : t({
                id: "preferences.dialog.audio.input.refresh",
                message: "Refresh devices",
              })}
        </Button>
      </div>

      <p
        className="text-xs text-theme-fg-muted"
        data-testid="audio-input-diagnostics"
      >
        {t({
          id: "preferences.dialog.audio.input.diagnostics",
          message: `Input devices detected: ${inputDeviceCount}`,
        })}
      </p>

      <div className="space-y-1">
        <h3 className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "preferences.dialog.audio.test.heading",
            message: "Test microphone",
          })}
        </h3>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.audio.test.description",
            message:
              "Start the test and speak — the bars should move and the active device label should match your selection.",
          })}
        </p>
      </div>
      <MicTestPanel
        deviceId={selectedAudioInputDeviceId}
        isAvailable={isActive}
      />

      <div className="space-y-1 border-t border-[var(--theme-border-subtle)] pt-4">
        <h3 className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "preferences.dialog.audio.miccheck.heading",
            message: "Probe your microphone quality",
          })}
        </h3>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.audio.miccheck.description",
            message:
              "Check whether your microphone and room are good enough for accurate dictation.",
          })}
        </p>
      </div>
      <GuidedMicCheck
        deviceId={selectedAudioInputDeviceId}
        isAvailable={isActive}
      />
    </div>
  );
}
