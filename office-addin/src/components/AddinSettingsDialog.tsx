import {
  ComputerIcon,
  ModalBase,
  MoonIcon,
  SunIcon,
  useTheme,
  type ThemeMode,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import type { ReactNode } from "react";

interface AppearanceOption {
  value: ThemeMode;
  label: string;
  description: string;
  icon: ReactNode;
}

interface AddinSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddinSettingsDialog({
  isOpen,
  onClose,
}: AddinSettingsDialogProps) {
  const { effectiveTheme, setThemeMode, themeMode } = useTheme();

  const appearanceOptions: AppearanceOption[] = [
    {
      value: "light",
      label: t({
        id: "officeAddin.settings.appearance.light.label",
        message: "Light mode",
      }),
      description: t({
        id: "officeAddin.settings.appearance.light.description",
        message: "Always use the light theme.",
      }),
      icon: <SunIcon className="size-5" />,
    },
    {
      value: "dark",
      label: t({
        id: "officeAddin.settings.appearance.dark.label",
        message: "Dark mode",
      }),
      description: t({
        id: "officeAddin.settings.appearance.dark.description",
        message: "Always use the dark theme.",
      }),
      icon: <MoonIcon className="size-5" />,
    },
    {
      value: "system",
      label: t({
        id: "officeAddin.settings.appearance.system.label",
        message: "System theme",
      }),
      description: t({
        id: "officeAddin.settings.appearance.system.description",
        message: "Match your Office host appearance.",
      }),
      icon: <ComputerIcon className="size-5" />,
    },
  ];

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t({
        id: "officeAddin.settings.title",
        message: "Settings",
      })}
      contentClassName="max-w-md"
    >
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-theme-fg-primary">
            {t({
              id: "officeAddin.settings.appearance.heading",
              message: "Color mode",
            })}
          </h2>
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "officeAddin.settings.appearance.description",
              message: "Choose how Erato should look in this add-in.",
            })}
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label={t({
            id: "officeAddin.settings.appearance.heading",
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
                className={`flex items-start gap-3 rounded-lg border p-4 text-left theme-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus ${
                  isSelected
                    ? "border-theme-border-focus bg-theme-bg-hover text-theme-fg-primary"
                    : "border-theme-border bg-theme-bg-primary text-theme-fg-secondary hover:bg-theme-bg-hover"
                }`}
                onClick={() => setThemeMode(option.value)}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border ${
                    isSelected
                      ? "border-theme-border-focus bg-theme-bg-secondary text-theme-fg-primary"
                      : "border-theme-border bg-theme-bg-secondary text-theme-fg-secondary"
                  }`}
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
                              id: "officeAddin.settings.appearance.current.dark",
                              message: "Currently dark",
                            })
                          : t({
                              id: "officeAddin.settings.appearance.current.light",
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
      </section>
    </ModalBase>
  );
}
