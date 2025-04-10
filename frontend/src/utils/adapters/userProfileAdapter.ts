import type { UserProfile as ApiUserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * UI-specific user profile interface with more user-friendly property names
 */
export interface UiUserProfile {
  id?: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
  username?: string;
}

/**
 * Extended profile interface that captures potential API property variations
 * without extending the problematic API type
 */
interface ExtendedUserProfile {
  id?: string;
  display_name?: string;
  name?: string;
  avatar_url?: string;
  avatarUrl?: string;
  email?: string | null;
  username?: string;
}

/**
 * Transforms API user profile to UI user profile
 */
export function mapApiUserProfileToUiProfile(
  apiProfile?: ApiUserProfile,
): UiUserProfile | undefined {
  if (!apiProfile) return undefined;

  // Cast to extended profile type that includes potential property variations
  const profile = apiProfile as unknown as ExtendedUserProfile;

  return {
    id: profile.id,
    name: profile.display_name ?? profile.name ?? profile.email ?? "",
    avatarUrl: profile.avatar_url ?? profile.avatarUrl ?? "",
    email: profile.email ?? "",
    username: profile.username ?? "",
  };
}
