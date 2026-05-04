import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { useTheme, type ThemeMode } from "@/components/providers/ThemeProvider";

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

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={clsx(
              "flex items-start gap-3 rounded-lg border p-4 text-left",
              "theme-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
              isSelected
                ? "border-theme-border-focus bg-theme-bg-hover text-theme-fg-primary"
                : "border-theme-border bg-theme-bg-primary text-theme-fg-secondary hover:bg-theme-bg-hover",
            )}
            onClick={() => setThemeMode(option.value)}
          >
            <span
              aria-hidden="true"
              className={clsx(
                "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border",
                isSelected
                  ? "border-theme-border-focus bg-theme-bg-secondary text-theme-fg-primary"
                  : "border-theme-border bg-theme-bg-secondary text-theme-fg-secondary",
              )}
            >
              {option.icon}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="font-medium">{option.label}</span>
                {option.value === "system" && isSelected ? (
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
                ) : null}
              </span>
              <span className="mt-1 block text-sm text-theme-fg-muted">
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
