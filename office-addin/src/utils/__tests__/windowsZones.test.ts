import { describe, expect, it } from "vitest";

import { ianaToWindows, toIana, windowsToIana } from "../windowsZones";

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("windowsToIana / ianaToWindows", () => {
  it("maps representative Windows zones to their territory=001 IANA id", () => {
    expect(windowsToIana("W. Europe Standard Time")).toBe("Europe/Berlin");
    expect(windowsToIana("Eastern Standard Time")).toBe("America/New_York");
    expect(windowsToIana("Tokyo Standard Time")).toBe("Asia/Tokyo");
    expect(windowsToIana("Not A Windows Zone")).toBeUndefined();
  });

  it("reverse-maps an IANA id back to a representative Windows name", () => {
    expect(ianaToWindows("Europe/Berlin")).toBe("W. Europe Standard Time");
    expect(ianaToWindows("Asia/Tokyo")).toBe("Tokyo Standard Time");
    expect(ianaToWindows("Nowhere/Nozone")).toBeUndefined();
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
