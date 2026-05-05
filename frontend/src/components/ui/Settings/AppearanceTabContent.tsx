import { t } from "@lingui/core/macro";

import { useTheme, type ThemeMode } from "@/components/providers/ThemeProvider";

import { RadioCard } from "../Controls/RadioCard";
import { ComputerIcon, MoonIcon, SunIcon } from "../icons";

import type { ReactNode } from "react";

interface AppearanceOption {
  description: string;
  icon: ReactNode;
  label: string;
  value: ThemeMode;
}

interface AppearanceTabContentProps {
  /**
   * Override for the "system" option's description. Hosts where the
   * surrounding environment is not the OS (e.g. Office add-in) can supply
   * context-appropriate copy here.
   */
  systemDescription?: string;
}

export function AppearanceTabContent({
  systemDescription,
}: AppearanceTabContentProps = {}) {
  const { effectiveTheme, setThemeMode, themeMode } = useTheme();

  const appearanceOptions: AppearanceOption[] = [
    {
      value: "light",
      label: t({
        id: "preferences.dialog.appearance.theme.light.label",
        message: "Light mode",
      }),
      description: t({
        id: "preferences.dialog.appearance.theme.light.description",
        message: "Always use the light theme.",
      }),
      icon: <SunIcon className="size-5" />,
    },
    {
      value: "dark",
      label: t({
        id: "preferences.dialog.appearance.theme.dark.label",
        message: "Dark mode",
      }),
      description: t({
        id: "preferences.dialog.appearance.theme.dark.description",
        message: "Always use the dark theme.",
      }),
      icon: <MoonIcon className="size-5" />,
    },
    {
      value: "system",
      label: t({
        id: "preferences.dialog.appearance.theme.system.label",
        message: "System theme",
      }),
      description:
        systemDescription ??
        t({
          id: "preferences.dialog.appearance.theme.system.description",
          message: "Match your device appearance settings.",
        }),
      icon: <ComputerIcon className="size-5" />,
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t({
        id: "preferences.dialog.appearance.theme.heading",
        message: "Color mode",
      })}
      className="grid gap-3"
    >
      {appearanceOptions.map((option) => {
        const isSelected = themeMode === option.value;
        const trailing =
          option.value === "system" && isSelected ? (
            <span className="text-xs text-theme-fg-muted">
              {effectiveTheme === "dark"
                ? t({
                    id: "preferences.dialog.appearance.theme.current.dark",
                    message: "Currently dark",
                  })
                : t({
                    id: "preferences.dialog.appearance.theme.current.light",
                    message: "Currently light",
                  })}
            </span>
          ) : null;

        return (
          <RadioCard
            key={option.value}
            name="appearance-theme"
            value={option.value}
            checked={isSelected}
            onChange={() => setThemeMode(option.value)}
            label={option.label}
            helper={option.description}
            icon={option.icon}
            trailing={trailing}
            size="md"
          />
        );
      })}
    </div>
  );
}
