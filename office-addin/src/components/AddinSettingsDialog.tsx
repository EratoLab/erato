import {
  ComputerIcon,
  ModalBase,
  MoonIcon,
  SunIcon,
  useTheme,
  type ThemeMode,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

type SettingsTab = "appearance" | "user" | "addin";

const TAB_ORDER: readonly SettingsTab[] = [
  "appearance",
  "user",
  "addin",
] as const;

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
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  useEffect(() => {
    if (isOpen) {
      setActiveTab("appearance");
    }
  }, [isOpen]);

  const tabLabels: Record<SettingsTab, string> = {
    appearance: t({
      id: "officeAddin.settings.tabs.appearance",
      message: "Appearance",
    }),
    user: t({
      id: "officeAddin.settings.tabs.user",
      message: "User settings",
    }),
    addin: t({
      id: "officeAddin.settings.tabs.addin",
      message: "Add-in",
    }),
  };

  /* eslint-disable lingui/no-unlocalized-strings -- Internal DOM ids, not user-facing copy */
  const tabIds: Record<SettingsTab, string> = {
    appearance: "addin-settings-tab-appearance",
    user: "addin-settings-tab-user",
    addin: "addin-settings-tab-addin",
  };

  const panelIds: Record<SettingsTab, string> = {
    appearance: "addin-settings-panel-appearance",
    user: "addin-settings-panel-user",
    addin: "addin-settings-panel-addin",
  };
  /* eslint-enable lingui/no-unlocalized-strings */

  const focusTab = (tab: SettingsTab) => {
    const element = document.getElementById(tabIds[tab]);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: SettingsTab,
  ) => {
    const currentIndex = TAB_ORDER.indexOf(currentTab);
    let nextTab: SettingsTab | undefined;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextTab =
          TAB_ORDER[
            (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
          ];
        break;
      case "Home":
        nextTab = TAB_ORDER[0];
        break;
      case "End":
        nextTab = TAB_ORDER[TAB_ORDER.length - 1];
        break;
      default:
        return;
    }

    if (!nextTab) return;
    event.preventDefault();
    setActiveTab(nextTab);
    focusTab(nextTab);
  };

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

  const dialogTitle = t({
    id: "officeAddin.settings.title",
    message: "Settings",
  });

  const emptyStateText = t({
    id: "officeAddin.settings.placeholder.empty",
    message: "No settings available yet.",
  });

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={dialogTitle}
      contentClassName="h-[80vh] max-h-[600px] max-w-xl"
    >
      <div className="flex h-full flex-col gap-4">
        <div className="shrink-0 border-b border-theme-border pb-2">
          <div
            role="tablist"
            aria-label={dialogTitle}
            aria-orientation="horizontal"
            className="flex gap-1 overflow-x-auto"
          >
            {TAB_ORDER.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  id={tabIds[tab]}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={panelIds[tab]}
                  tabIndex={isActive ? 0 : -1}
                  className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm theme-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus ${
                    isActive
                      ? "bg-theme-bg-hover font-medium text-theme-fg-primary"
                      : "text-theme-fg-secondary hover:bg-theme-bg-hover"
                  }`}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab)}
                >
                  {tabLabels[tab]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <section
            id={panelIds.appearance}
            role="tabpanel"
            aria-labelledby={tabIds.appearance}
            hidden={activeTab !== "appearance"}
            className="space-y-4"
          >
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

          <section
            id={panelIds.user}
            role="tabpanel"
            aria-labelledby={tabIds.user}
            hidden={activeTab !== "user"}
            className="space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-theme-fg-primary">
                {t({
                  id: "officeAddin.settings.user.heading",
                  message: "User preferences",
                })}
              </h2>
              <p className="text-sm text-theme-fg-secondary">
                {t({
                  id: "officeAddin.settings.user.description",
                  message:
                    "Personal preferences applied to your assistant conversations.",
                })}
              </p>
            </div>
            <p className="text-sm italic text-theme-fg-muted">
              {emptyStateText}
            </p>
          </section>

          <section
            id={panelIds.addin}
            role="tabpanel"
            aria-labelledby={tabIds.addin}
            hidden={activeTab !== "addin"}
            className="space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-theme-fg-primary">
                {t({
                  id: "officeAddin.settings.addin.heading",
                  message: "Add-in behavior",
                })}
              </h2>
              <p className="text-sm text-theme-fg-secondary">
                {t({
                  id: "officeAddin.settings.addin.description",
                  message:
                    "Configure how the add-in behaves inside Office, such as how switching between emails maps to chats.",
                })}
              </p>
            </div>
            <p className="text-sm italic text-theme-fg-muted">
              {emptyStateText}
            </p>
          </section>
        </div>
      </div>
    </ModalBase>
  );
}
