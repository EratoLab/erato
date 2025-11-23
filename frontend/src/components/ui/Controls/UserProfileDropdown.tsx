import { t } from "@lingui/core/macro";
import { clsx } from "clsx";
import { memo } from "react";

import { useAuthFeature } from "@/providers/FeatureConfigProvider";

import { DropdownMenu } from "./DropdownMenu";
import { Avatar } from "../Feedback/Avatar";
import { LogOutIcon, SunIcon, MoonIcon, ComputerIcon } from "../icons";

import type { ThemeMode } from "@/components/providers/ThemeProvider";
import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UserProfileDropdownProps {
  userProfile?: UserProfile;
  onSignOut: () => void;
  className?: string;
  /** Enable theme toggle feature */
  showThemeToggle?: boolean;
  /** Current theme mode (if theme toggle is enabled) */
  themeMode?: ThemeMode;
  /** Function to set the theme mode (if theme toggle is enabled) */
  setThemeMode?: (mode: ThemeMode) => void;
}

export const UserProfileDropdown = memo<UserProfileDropdownProps>(
  ({
    userProfile,
    onSignOut,
    className,
    showThemeToggle = false,
    themeMode = "light",
    setThemeMode,
  }) => {
    // Check if logout should be shown
    const { showLogout } = useAuthFeature();

    // Create dropdown items array
    const dropdownItems = [
      ...(showThemeToggle && setThemeMode
        ? [
            {
              label: t`Light mode`,
              icon: <SunIcon className="size-4" />,
              onClick: () => setThemeMode("light"),
              checked: themeMode === "light",
            },
            {
              label: t`Dark mode`,
              icon: <MoonIcon className="size-4" />,
              onClick: () => setThemeMode("dark"),
              checked: themeMode === "dark",
            },
            {
              label: t`System theme`,
              icon: <ComputerIcon className="size-4" />,
              onClick: () => setThemeMode("system"),
              checked: themeMode === "system",
            },
          ]
        : []),
      ...(showLogout
        ? [
            {
              label: t`Sign out`,
              icon: <LogOutIcon className="size-4" />,
              onClick: onSignOut,
            },
          ]
        : []),
    ];

    return (
      <div className={clsx("flex min-h-[40px] items-center", className)}>
        <DropdownMenu
          items={dropdownItems}
          align="left"
          // preferredOrientation={{
          //   vertical: 'top',
          //   horizontal: 'left'
          // }}
          data-testid="user-profile-dropdown"
          triggerIcon={
            <Avatar
              userProfile={userProfile}
              userOrAssistant={true}
              size="sm"
              className="theme-transition cursor-pointer hover:opacity-80"
            />
          }
        />
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
UserProfileDropdown.displayName = "UserProfileDropdown";
