import { describe, expect, it } from "vitest";

import { signedInUser } from "./DesktopSidecarProvider";

describe("signedInUser", () => {
  it("reports the Entra object id and address of the erato user", () => {
    expect(
      signedInUser({
        organization_user_id: " 0b1c2d3e-0000-4000-8000-000000000001 ",
        email: "Daniel@Home.example",
      }),
    ).toEqual({
      user_id: "0b1c2d3e-0000-4000-8000-000000000001",
      tenant_id: null,
      email: "daniel@home.example",
      user_principal_name: null,
    });
  });

  it("is null without an Entra ID sign-in", () => {
    expect(signedInUser(undefined)).toBeNull();
    expect(signedInUser({ email: "daniel@home.example" })).toBeNull();
    expect(signedInUser({ organization_user_id: " " })).toBeNull();
  });
});
