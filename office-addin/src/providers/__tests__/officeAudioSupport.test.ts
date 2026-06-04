import { describe, expect, it } from "vitest";

import { isAudioCaptureSupportedPlatform } from "../OfficeProvider";

describe("isAudioCaptureSupportedPlatform", () => {
  it("supports Chromium hosts and classic desktop", () => {
    // OfficeOnline = Outlook on the web AND new Outlook on Windows (both Chromium).
    expect(isAudioCaptureSupportedPlatform("OfficeOnline")).toBe(true);
    // PC = classic Outlook desktop on Windows (host auto-prompts on getUserMedia).
    expect(isAudioCaptureSupportedPlatform("PC")).toBe(true);
    expect(isAudioCaptureSupportedPlatform("Universal")).toBe(true);
  });

  it("blocks the WebKit-based Mac desktop client and mobile", () => {
    expect(isAudioCaptureSupportedPlatform("Mac")).toBe(false);
    expect(isAudioCaptureSupportedPlatform("iOS")).toBe(false);
    expect(isAudioCaptureSupportedPlatform("Android")).toBe(false);
  });

  it("treats unknown or missing platform as unsupported", () => {
    expect(isAudioCaptureSupportedPlatform(null)).toBe(false);
    expect(isAudioCaptureSupportedPlatform("")).toBe(false);
  });
});
