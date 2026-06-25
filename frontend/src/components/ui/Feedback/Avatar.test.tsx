import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "./Avatar";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const createProfile = (profile: Partial<UserProfile>): UserProfile => ({
  id: "user-1",
  preferred_language: "en",
  groups: [],
  organization_group_ids: [],
  ...profile,
});

describe("Avatar", () => {
  it("renders the profile picture from the API picture field for users", () => {
    render(
      <Avatar
        userOrAssistant={true}
        userProfile={createProfile({
          name: "Ada Lovelace",
          picture: "https://example.com/avatar.png",
        })}
      />,
    );

    const image = screen.getByRole("img", { name: "User avatar" });
    expect(image).toHaveAttribute("src", "https://example.com/avatar.png");
  });

  it("falls back to initials when the user profile picture fails to load", () => {
    render(
      <Avatar
        userOrAssistant={true}
        userProfile={createProfile({
          name: "Ada Lovelace",
          picture: "https://example.com/broken-avatar.png",
        })}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "User avatar" }));

    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});
