import { UserProfileDropdown } from "./UserProfileDropdown";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

// This is a container component that connects the UserProfileDropdown
// to the ThemeProvider context
interface UserProfileThemeDropdownProps {
  userProfile?: UserProfile;
  onSignOut: () => void;
  className?: string;
}

export const UserProfileThemeDropdown: React.FC<
  UserProfileThemeDropdownProps
> = ({ userProfile, onSignOut, className }) => (
  <UserProfileDropdown
    userProfile={userProfile}
    onSignOut={onSignOut}
    className={className}
  />
);
