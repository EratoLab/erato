import React from "react";

import { UserProfileDropdown } from "./UserProfileDropdown";
import { useTheme } from "../../providers/ThemeProvider";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// This is a container component that connects the UserProfileDropdown
// to the ThemeProvider context
interface UserProfileThemeDropdownProps {
  userProfile?: UserProfile;
  onSignOut: () => void;
  className?: string;
  showThemeToggle?: boolean;
}

export const UserProfileThemeDropdown: React.FC<
  UserProfileThemeDropdownProps
> = ({ userProfile, onSignOut, className, showThemeToggle = false }) => {
  // Get theme data from context
  const { themeMode, setThemeMode } = useTheme();

  // Pass it down to the presentational component
  return (
    <UserProfileDropdown
      userProfile={userProfile}
      onSignOut={onSignOut}
      className={className}
      showThemeToggle={showThemeToggle}
      themeMode={themeMode}
      setThemeMode={setThemeMode}
    />
  );
};
