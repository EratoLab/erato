import { clsx } from "clsx";
import React, { memo } from "react";

import { DropdownMenu } from "./DropdownMenu";
import { Avatar } from "../Feedback/Avatar";
import { LogOutIcon, SunIcon, MoonIcon } from "../icons";

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
    // Create dropdown items array
    const dropdownItems = [
      ...(showThemeToggle && setThemeMode
        ? [
            {
              label: themeMode === "light" ? "Dark mode" : "Light mode",
              icon:
                themeMode === "light" ? (
                  <MoonIcon className="size-4" />
                ) : (
                  <SunIcon className="size-4" />
                ),
              onClick: () => {
                setThemeMode(themeMode === "light" ? "dark" : "light");
              },
            },
          ]
        : []),
      {
        label: "Sign out",
        icon: <LogOutIcon className="size-4" />,
        onClick: onSignOut,
      },
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
          triggerIcon={
            <Avatar
              userProfile={userProfile}
              size="sm"
              className="theme-transition cursor-pointer hover:opacity-80"
            />
          }
        />
      </div>
    );
  },
);

UserProfileDropdown.displayName = "UserProfileDropdown";
