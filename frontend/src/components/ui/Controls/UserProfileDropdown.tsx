import { clsx } from "clsx";
import { memo, useCallback, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import {
  isDisclaimersSettingsLink,
  settingsClosedLocation,
} from "@/lib/disclaimersSettingsLink";
import {
  ACCOUNT_MENU_ID,
  describeAccountMenu,
} from "@/lib/shell/menus/describeAccountMenu";
import { menuEntryDropdownItems } from "@/lib/shell/menus/web/dropdownItems";
import {
  useAuthFeature,
  useUserPreferencesFeature,
} from "@/providers/FeatureConfigProvider";

import { DropdownMenu } from "./DropdownMenu";
import { Avatar } from "../Feedback/Avatar";
import { UserPreferencesDialog } from "../Settings/UserPreferencesDialog";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UserProfileDropdownProps {
  userProfile?: UserProfile;
  onSignOut: () => void;
  className?: string;
}

export const UserProfileDropdown = memo<UserProfileDropdownProps>(
  ({ userProfile, onSignOut, className }) => {
    const [searchParams] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();
    const [openFromMenu, setOpenFromMenu] = useState(false);
    /* eslint-disable lingui/no-unlocalized-strings -- URL query parameter keys */
    const openFromUrl = searchParams.get("preferencesDialog") === "open";
    const requestedPreferencesTab = searchParams.get("preferencesTab");
    const selectedMcpServerId = searchParams.get("mcpServerId") ?? undefined;
    const closePreferencesDialog = useCallback(() => {
      setOpenFromMenu(false);
      if (openFromUrl) {
        navigate(settingsClosedLocation(location), { replace: true });
      }
    }, [location, navigate, openFromUrl]);
    /* eslint-enable lingui/no-unlocalized-strings */

    // Check if logout should be shown
    const { showLogout } = useAuthFeature();
    const { mcpServersTabEnabled } = useUserPreferencesFeature();
    // Keep supporting legacy OAuth return URLs.
    const openMcpTab =
      mcpServersTabEnabled &&
      (requestedPreferencesTab === "mcpServers" ||
        requestedPreferencesTab === "serversTools");
    const initialTab = isDisclaimersSettingsLink(searchParams)
      ? "disclaimers"
      : openMcpTab
        ? // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal tab id
          "serversTools"
        : undefined;

    const dropdownItems = menuEntryDropdownItems(
      describeAccountMenu({ showLogout }),
      {
        onSelect: {
          [ACCOUNT_MENU_ID.settings]: () => setOpenFromMenu(true),
          [ACCOUNT_MENU_ID.signOut]: onSignOut,
        },
      },
    );

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
          isOpen={openFromMenu || openFromUrl}
          onClose={closePreferencesDialog}
          initialTab={initialTab}
          selectedMcpServerId={selectedMcpServerId}
          userProfile={userProfile}
        />
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
UserProfileDropdown.displayName = "UserProfileDropdown";
