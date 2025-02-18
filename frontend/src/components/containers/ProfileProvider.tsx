"use client";

import React, { createContext } from "react";
import { useProfile } from "../../lib/generated/v1betaApi/v1betaApiComponents";
import type { UserProfile } from "../../types/chat";

// Add this context definition
export const ProfileContext = createContext<{
  profile: UserProfile | null;
  isLoading: boolean;
  error: unknown;
} | null>(null);

export const ProfileProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const { data: profile, isLoading, error } = useProfile({});

  const transformedProfile = profile
    ? {
        ...profile,
        createdAt: new Date().toISOString(), // Default value
        updatedAt: new Date().toISOString(), // Default value
      }
    : null;

  return (
    <ProfileContext.Provider
      value={{ profile: transformedProfile, isLoading, error }}
    >
      {children}
    </ProfileContext.Provider>
  );
};
