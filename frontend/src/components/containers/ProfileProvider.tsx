"use client";

import React, { createContext } from "react";
import { useProfile } from "../../lib/generated/v1betaApi/v1betaApiComponents";
import type { UserProfile } from "@/types/chat";
import { createTransformedQueryHook } from "@/hooks/useTransformedQuery";

// Create a utility hook that transforms void to string
// TODO: remove this once #53 is resolved
const useTransformedProfile = createTransformedQueryHook(useProfile);

// Add this context definition
export const ProfileContext = createContext<{
  profile?: UserProfile;
  isLoading: boolean;
  error: unknown;
} | null>(null);

export const ProfileProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const { data: profile, isLoading, error } = useTransformedProfile({});

  return (
    <ProfileContext.Provider
      value={{ profile, isLoading, error }}
    >
      {children}
    </ProfileContext.Provider>
  );
};
