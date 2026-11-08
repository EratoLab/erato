import { createContext, useMemo, type ReactNode } from "react";

import { useClientLocaleReport } from "@/hooks/profile/useClientLocaleReport";
import { useProfileApi } from "@/hooks/profile/useProfileApi";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ProfileContextType {
  profile?: UserProfile;
  isLoading: boolean;
  error: unknown;
}

export const ProfileContext = createContext<ProfileContextType | undefined>(
  undefined,
);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { profile, isLoading, error } = useProfileApi();
  useClientLocaleReport(profile);

  // Memoize context value to prevent unnecessary rerenders of consumers
  const value = useMemo(
    () => ({ profile, isLoading, error }),
    [profile, isLoading, error],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}
