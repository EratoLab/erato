import { describe, expect, it } from "vitest";

import { toIana, toIanaStrict, windowsToIana } from "../windowsZones";

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("windowsToIana", () => {
  it("maps representative Windows zones to their territory=001 IANA id", () => {
    expect(windowsToIana("W. Europe Standard Time")).toBe("Europe/Berlin");
    expect(windowsToIana("Eastern Standard Time")).toBe("America/New_York");
    expect(windowsToIana("Tokyo Standard Time")).toBe("Asia/Tokyo");
    expect(windowsToIana("Not A Windows Zone")).toBeUndefined();
  });
});

describe("toIana resolution ladder", () => {
  it("returns a valid IANA id unchanged", () => {
    expect(toIana("Europe/Berlin")).toBe("Europe/Berlin");
    expect(toIana("America/New_York")).toBe("America/New_York");
    // Intl accepts "UTC" directly, so it is returned as-is (not remapped).
    expect(toIana("UTC")).toBe("UTC");
  });

  it("maps a Windows display name to IANA", () => {
    expect(toIana("W. Europe Standard Time")).toBe("Europe/Berlin");
    expect(toIana("Eastern Standard Time")).toBe("America/New_York");
  });

  it("recovers a bare Windows name missing the ' Standard Time' suffix", () => {
    expect(toIana("W. Europe")).toBe("Europe/Berlin");
  });

  it("falls back to the host zone for null/empty/unknown input, never throwing", () => {
    expect(toIana(null)).toBe(LOCAL_ZONE);
    expect(toIana(undefined)).toBe(LOCAL_ZONE);
    expect(toIana("   ")).toBe(LOCAL_ZONE);
    expect(toIana("Definitely Not A Zone")).toBe(LOCAL_ZONE);
  });
});

describe("toIanaStrict", () => {
  it("resolves like toIana when the zone is genuinely resolvable", () => {
    expect(toIanaStrict("Europe/Berlin")).toBe("Europe/Berlin");
    expect(toIanaStrict("W. Europe Standard Time")).toBe("Europe/Berlin");
    expect(toIanaStrict("W. Europe")).toBe("Europe/Berlin");
  });

  it("returns null (NOT the host zone) for null/empty/unmappable input", () => {
    expect(toIanaStrict(null)).toBeNull();
    expect(toIanaStrict(undefined)).toBeNull();
    expect(toIanaStrict("   ")).toBeNull();
    // The classic unmappable EWS StartTimeZone id.
    expect(toIanaStrict("Customized Time Zone")).toBeNull();
    expect(toIanaStrict("Definitely Not A Zone")).toBeNull();
  });
});
