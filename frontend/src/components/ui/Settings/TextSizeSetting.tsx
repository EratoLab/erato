import { t } from "@lingui/core/macro";

import {
  TEXT_SIZE_OPTIONS,
  useTheme,
  type TextSize,
} from "@/components/providers/ThemeProvider";

import { SegmentedControl } from "../Controls/SegmentedControl";

export function TextSizeSetting() {
  const { textSize, setTextSize } = useTheme();

  const labels: Record<TextSize, string> = {
    small: t({
      id: "preferences.dialog.appearance.textSize.option.small",
      message: "Small",
    }),
    default: t({
      id: "preferences.dialog.appearance.textSize.option.default",
      message: "Default",
    }),
    large: t({
      id: "preferences.dialog.appearance.textSize.option.large",
      message: "Large",
    }),
    "x-large": t({
      id: "preferences.dialog.appearance.textSize.option.xLarge",
      message: "Extra large",
    }),
  };
  const heading = t({
    id: "preferences.dialog.appearance.textSize.heading",
    message: "Text size",
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-theme-fg-primary">{heading}</h2>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.appearance.textSize.description",
            message: "Scales the whole interface on this device.",
          })}
        </p>
      </div>
      <SegmentedControl
        aria-label={heading}
        size="md"
        className="flex-wrap"
        options={TEXT_SIZE_OPTIONS.map((value) => ({
          value,
          label: labels[value],
        }))}
        value={textSize}
        onChange={setTextSize}
      />
    </div>
  );
}
