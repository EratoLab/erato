import { describe, expect, it } from "vitest";

import { isConsentClaim, isConsentMember } from "./consent";

describe("consent flags", () => {
  it.each([
    "hasUserApproved",
    "has_user_approved",
    "HAS-USER-APPROVED",
    "hasuserapproved",
    "has_User-Approved",
  ])("reads %s as a consent flag", (name) => {
    expect(isConsentMember(name)).toBe(true);
  });

  it.each([
    "marketing_consent",
    "cookieConsent",
    "consent",
    "user_confirmed",
    "userAgreed",
    "explicitConsentGiven",
    "approved",
    "hasUserApprovedAt",
    "has user approved",
    "hasUserApproved​",
    "_".repeat(20) + "hasUserApproved",
  ])("reads %s as data the call writes", (name) => {
    expect(isConsentMember(name)).toBe(false);
  });

  it("finds a consent flag at or above a value, whatever it holds", () => {
    expect(isConsentClaim("/hasUserApproved")).toBe(true);
    expect(isConsentClaim("/options/has_user_approved/by")).toBe(true);
    expect(isConsentClaim("/hasUserApproved/0")).toBe(true);
    expect(isConsentClaim("/meta/userConsent/given")).toBe(false);
    expect(isConsentClaim("/marketing_consent")).toBe(false);
    expect(isConsentClaim(7, undefined, "/x/has~1user~0approved")).toBe(false);
    expect(isConsentClaim(7, undefined, "/x", "/hasUserApproved")).toBe(true);
    expect(isConsentClaim("hasUserApproved")).toBe(false);
  });
});
