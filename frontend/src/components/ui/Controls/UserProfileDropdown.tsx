import { t } from "@lingui/core/macro";
import { clsx } from "clsx";
import { memo, useState } from "react";

import { useAuthFeature } from "@/providers/FeatureConfigProvider";

import { DropdownMenu } from "./DropdownMenu";
import { Avatar } from "../Feedback/Avatar";
import { UserPreferencesDialog } from "../Settings/UserPreferencesDialog";
import { LogOutIcon, SettingsIcon } from "../icons";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UserProfileDropdownProps {
  userProfile?: UserProfile;
  onSignOut: () => void;
  className?: string;
}

export const UserProfileDropdown = memo<UserProfileDropdownProps>(
  ({ userProfile, onSignOut, className }) => {
    const [isPreferencesDialogOpen, setIsPreferencesDialogOpen] =
      useState(false);

    // Check if logout should be shown
    const { showLogout } = useAuthFeature();

    // Create dropdown items array
    const dropdownItems = [
      {
        label: t({
          id: "profile.menu.preferences",
          message: "Settings",
        }),
        icon: <SettingsIcon className="size-4" />,
        onClick: () => setIsPreferencesDialogOpen(true),
      },
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
        <UserPreferencesDialog
          isOpen={isPreferencesDialogOpen}
          onClose={() => setIsPreferencesDialogOpen(false)}
          userProfile={userProfile}
        />
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
UserProfileDropdown.displayName = "UserProfileDropdown";
