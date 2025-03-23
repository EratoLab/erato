"use client";

import React, { createContext } from "react";

import { createTransformedQueryHook } from "@/hooks/useTransformedQuery";

import { useProfile } from "../../lib/generated/v1betaApi/v1betaApiComponents";

import type { UserProfile } from "@/types/chat";

// Create a utility hook that transforms void to string
// TODO: remove this once #53 is resolved
const useTransformedProfile = createTransformedQueryHook(useProfile);

// Add this context definition
export const ProfileContext = createContext<{
  profile?: UserProfile;
  isPending: boolean;
  error: unknown;
} | null>(null);

export const ProfileProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const { data: profile, isPending, error } = useTransformedProfile({});

  return (
    <ProfileContext.Provider value={{ profile, isPending, error }}>
      {children}
    </ProfileContext.Provider>
  );
};
