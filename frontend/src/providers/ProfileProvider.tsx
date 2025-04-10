import { createContext, type ReactNode } from "react";

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
  return (
    <ProfileContext.Provider value={{ profile, isLoading, error }}>
      {children}
    </ProfileContext.Provider>
  );
}
