import { describe, expect, it } from "vitest";

import { mapApiUserProfileToUiProfile } from "./userProfileAdapter";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const createProfile = (profile: Partial<UserProfile>): UserProfile => ({
  id: "user-1",
  preferred_language: "en",
  groups: [],
  organization_group_ids: [],
  ...profile,
});

describe("mapApiUserProfileToUiProfile", () => {
  it("maps the ID token picture claim to the UI avatar URL", () => {
    const uiProfile = mapApiUserProfileToUiProfile(
      createProfile({
        name: "Ada Lovelace",
        picture: "https://example.com/avatar.png",
      }),
    );

    expect(uiProfile).toEqual(
      expect.objectContaining({
        name: "Ada Lovelace",
        avatarUrl: "https://example.com/avatar.png",
      }),
    );
  });

  it("prefers the API picture field over legacy avatar URL aliases", () => {
    const uiProfile = mapApiUserProfileToUiProfile({
      ...createProfile({ picture: "https://example.com/picture.png" }),
      avatar_url: "https://example.com/avatar-url.png",
      avatarUrl: "https://example.com/avatarUrl.png",
    } as unknown as UserProfile);

    expect(uiProfile?.avatarUrl).toBe("https://example.com/picture.png");
  });
});
