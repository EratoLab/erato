import { t } from "@lingui/core/macro";
import { clsx } from "clsx";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  clearMcpOauthCallback,
  getMcpOauthServerId,
} from "@/lib/mcpOauthCallback";
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
    const [isMcpOauthDialog, setIsMcpOauthDialog] = useState(false);
    /* eslint-disable lingui/no-unlocalized-strings -- URL query parameter keys */
    const requestedPreferencesTab = searchParams.get("preferencesTab");
    const pendingMcpOauthCallback = useMemo(() => {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const serverId =
        (state ? getMcpOauthServerId(state) : null) ??
        searchParams.get("mcpOauthServerId");
      if (!serverId || !code || !state) {
        return null;
      }
      return {
        code,
        serverId,
        state,
        iss: searchParams.get("iss") ?? undefined,
      };
    }, [searchParams]);

    useEffect(() => {
      if (pendingMcpOauthCallback) {
        setIsMcpOauthDialog(true);
      }
      if (
        pendingMcpOauthCallback ||
        searchParams.get("preferencesDialog") === "open"
      ) {
        setIsPreferencesDialogOpen(true);
      }
    }, [pendingMcpOauthCallback, searchParams]);

    const clearPreferencesDialogSearchParams = useCallback(() => {
      const state = searchParams.get("state");
      if (state) clearMcpOauthCallback(state);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("preferencesDialog");
      nextParams.delete("preferencesTab");
      nextParams.delete("mcpOauthServerId");
      nextParams.delete("code");
      nextParams.delete("state");
      nextParams.delete("iss");
      setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

    const closePreferencesDialog = useCallback(() => {
      setIsPreferencesDialogOpen(false);
      setIsMcpOauthDialog(false);
      if (
        pendingMcpOauthCallback ||
        searchParams.get("preferencesDialog") === "open"
      ) {
        clearPreferencesDialogSearchParams();
      }
    }, [
      clearPreferencesDialogSearchParams,
      pendingMcpOauthCallback,
      searchParams,
    ]);
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
      <div className={clsx("flex items-center", className)}>
        <DropdownMenu
          items={dropdownItems}
          align="left"
          data-testid="user-profile-dropdown"
          triggerButtonGeometry="icon"
          triggerButtonClassName="sidebar-icon-col-geometry sidebar-icon-col-geometry-avatar"
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
            // Keep supporting legacy OAuth return URLs.
            (isMcpOauthDialog ||
              pendingMcpOauthCallback ||
              requestedPreferencesTab === "mcpServers" ||
              requestedPreferencesTab === "serversTools") &&
            mcpServersTabEnabled
              ? // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal tab id
                "serversTools"
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
