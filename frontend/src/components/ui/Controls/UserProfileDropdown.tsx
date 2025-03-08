import { clsx } from "clsx";
import React, { memo } from "react";

import { DropdownMenu } from "./DropdownMenu";
import { useTheme } from "../../providers/ThemeProvider";
import { Avatar } from "../Feedback/Avatar";
import { LogOutIcon, SunIcon, MoonIcon } from "../icons";

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
