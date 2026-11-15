import { afterEach, describe, expect, it, vi } from "vitest";

import { requirementsUpTo } from "../../../test/mocks/powerpoint/fakePowerPoint";
import {
  logPowerPointReadSupport,
  powerpointReadSupport,
  resetPowerPointReadSupportLogForTests,
} from "../powerpointReadSupport";

afterEach(() => {
  resetPowerPointReadSupportLogForTests();
  vi.restoreAllMocks();
});

describe("PowerPoint read support", () => {
  it.each([
    ["1.2", "none", null],
    ["1.3", "none", "1.3"],
    ["1.4", "basic", "1.4"],
    ["1.5", "basic", "1.5"],
    ["1.8", "basic", "1.8"],
    ["1.9", "basic", "1.8"],
    ["1.10", "full", "1.10"],
  ])(
    "a host at PowerPointApi %s reads at the %s tier",
    (set, tier, highest) => {
      const support = powerpointReadSupport(requirementsUpTo(set));
      expect(support.tier).toBe(tier);
      expect(support.highestVersion).toBe(highest);
    },
  );

  it("switches selection on at 1.5 and everything else only at 1.10", () => {
    const at = (set: string) => powerpointReadSupport(requirementsUpTo(set));
    const fullOnly = {
      placeholderRole: false,
      tables: false,
      groups: false,
      zOrder: false,
      shapeDetails: false,
      safeTextFrame: false,
      bulletLevels: false,
      slideSize: false,
    };
    expect(at("1.4")).toMatchObject({ slides: true, selection: false });
    expect(at("1.5")).toMatchObject({ selection: true, ...fullOnly });
    // Microsoft 365 builds before Version 2601 stop here; they read like LTSC.
    expect(at("1.9")).toMatchObject({ tier: "basic", ...fullOnly });
    expect(at("1.10")).toMatchObject(
      Object.fromEntries(Object.keys(fullOnly).map((key) => [key, true])),
    );
  });

  it("is full exactly when every 1.10 switch is on", () => {
    for (const set of ["1.3", "1.4", "1.5", "1.8", "1.9", "1.10"]) {
      const support = powerpointReadSupport(requirementsUpTo(set));
      expect(support.tier === "full").toBe(
        support.placeholderRole && support.tables && support.bulletLevels,
      );
    }
  });

  it("treats a check that throws as unsupported", () => {
    const support = powerpointReadSupport(() => {
      throw new Error("no requirements");
    });
    expect(support.tier).toBe("none");
    expect(support.slides).toBe(false);
  });

  it("asks only about PowerPointApi", () => {
    const check = vi.fn((_name: string, _version?: string) => true);
    powerpointReadSupport(check);
    expect(new Set(check.mock.calls.map(([name]) => name))).toEqual(
      new Set(["PowerPointApi"]),
    );
    expect(check.mock.calls.map(([, version]) => version)).toEqual([
      "1.3",
      "1.4",
      "1.5",
      "1.8",
      "1.10",
    ]);
  });

  it("logs the detected set once per session", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const support = powerpointReadSupport(requirementsUpTo("1.5"));
    logPowerPointReadSupport(support);
    logPowerPointReadSupport(support);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "PowerPoint read support",
      expect.objectContaining({ tier: "basic", highestVersion: "1.5" }),
    );
  });
});
