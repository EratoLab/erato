import { t } from "@lingui/core/macro";
import { clsx } from "clsx";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  useAuthFeature,
  useUserPreferencesFeature,
} from "@/providers/FeatureConfigProvider";

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
    const [searchParams, setSearchParams] = useSearchParams();
    const [isPreferencesDialogOpen, setIsPreferencesDialogOpen] =
      useState(false);
    /* eslint-disable lingui/no-unlocalized-strings -- URL query parameter keys */
    const requestedPreferencesTab = searchParams.get("preferencesTab");
    const pendingMcpOauthCallback = useMemo(() => {
      const serverId = searchParams.get("mcpOauthServerId");
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      if (!serverId || !code || !state) {
        return null;
      }
      return { code, serverId, state };
    }, [searchParams]);

    useEffect(() => {
      if (searchParams.get("preferencesDialog") === "open") {
        setIsPreferencesDialogOpen(true);
      }
    }, [searchParams]);

    const clearPreferencesDialogSearchParams = useCallback(() => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("preferencesDialog");
      nextParams.delete("preferencesTab");
      nextParams.delete("mcpOauthServerId");
      nextParams.delete("code");
      nextParams.delete("state");
      setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

    const closePreferencesDialog = useCallback(() => {
      setIsPreferencesDialogOpen(false);
      if (searchParams.get("preferencesDialog") === "open") {
        clearPreferencesDialogSearchParams();
      }
    }, [clearPreferencesDialogSearchParams, searchParams]);
    /* eslint-enable lingui/no-unlocalized-strings */

    // Check if logout should be shown
    const { showLogout } = useAuthFeature();
    const { mcpServersTabEnabled } = useUserPreferencesFeature();

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
          onClose={closePreferencesDialog}
          initialTab={
            requestedPreferencesTab === "mcpServers" && mcpServersTabEnabled
              ? // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal tab id
                "mcpServers"
              : undefined
          }
          pendingMcpOauthCallback={
            mcpServersTabEnabled ? pendingMcpOauthCallback : null
          }
          onMcpOauthCallbackHandled={clearPreferencesDialogSearchParams}
          userProfile={userProfile}
        />
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
UserProfileDropdown.displayName = "UserProfileDropdown";
