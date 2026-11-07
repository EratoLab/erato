import { describe, expect, it } from "vitest";

import { isConsentClaim, isConsentMember, isYesOrNo } from "./consent";

describe("consent flags", () => {
  it.each([
    "hasUserApproved",
    "user_confirmed",
    "userAgreed",
    "consent",
    "explicitConsentGiven",
  ])("reads %s as a consent member", (name) => {
    expect(isConsentMember(name)).toBe(true);
  });

  it.each(["approved", "user", "confirmation_email", "username"])(
    "reads %s as an ordinary member",
    (name) => {
      expect(isConsentMember(name)).toBe(false);
    },
  );

  it("counts only a yes or no as a claim", () => {
    for (const value of [true, false, "yes", " NO ", "true"]) {
      expect(isYesOrNo(value)).toBe(true);
    }
    for (const value of ["maybe", 1, null, {}, "yes".padEnd(100, " ")]) {
      expect(isYesOrNo(value)).toBe(false);
    }
  });

  it("finds a consent member at or above the value", () => {
    expect(isConsentClaim(true, "/hasUserApproved")).toBe(true);
    expect(isConsentClaim("yes", "/meta/userConsent/given")).toBe(true);
    expect(isConsentClaim(true, "/approved")).toBe(false);
    expect(isConsentClaim("Alice", "/hasUserApproved")).toBe(false);
    expect(isConsentClaim(true, 7, undefined, "/user~1approved")).toBe(true);
  });
});
