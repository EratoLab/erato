import { clsx } from "clsx";
import React, { memo } from "react";

import { Avatar } from "./Avatar";
import { DropdownMenu } from "./DropdownMenu";
import { LogOutIcon, SunIcon, MoonIcon } from "./icons";
import { useTheme } from "../providers/ThemeProvider";

import type { UserProfile } from "@/types/chat";

interface UserProfileDropdownProps {
  userProfile?: UserProfile;
  onSignOut: () => void;
  className?: string;
  /** Enable theme toggle feature */
  showThemeToggle?: boolean;
}

export const UserProfileDropdown = memo<UserProfileDropdownProps>(
  ({ userProfile, onSignOut, className, showThemeToggle = false }) => {
    const { themeMode, setThemeMode } = useTheme();

    // Create dropdown items array
    const dropdownItems = [
      ...(showThemeToggle
        ? [
            {
              label: themeMode === "light" ? "Dark mode" : "Light mode",
              icon:
                themeMode === "light" ? (
                  <MoonIcon className="w-4 h-4" />
                ) : (
                  <SunIcon className="w-4 h-4" />
                ),
              onClick: () => {
                setThemeMode(themeMode === "light" ? "dark" : "light");
              },
            },
          ]
        : []),
      {
        label: "Sign out",
        icon: <LogOutIcon className="w-4 h-4" />,
        onClick: onSignOut,
      },
    ];

    return (
      <div className={clsx("min-h-[40px] flex items-center", className)}>
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
              className="cursor-pointer hover:opacity-80 theme-transition"
            />
          }
        />
      </div>
    );
  },
);

UserProfileDropdown.displayName = "UserProfileDropdown";
