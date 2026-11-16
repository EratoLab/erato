import { setOfficeHostInfo } from "@erato/frontend/library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requirementsUpTo } from "../../../test/mocks/powerpoint/fakePowerPoint";
import {
  currentPowerPointReadSupport,
  powerpointReadSupport,
  reportPowerPointReadSupport,
} from "../powerpointReadSupport";

vi.mock("@erato/frontend/library", () => ({ setOfficeHostInfo: vi.fn() }));

afterEach(() => {
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
      slidePicture: false,
    };
    expect(at("1.4")).toMatchObject({ slides: true, selection: false });
    expect(at("1.5")).toMatchObject({ selection: true, ...fullOnly });
    // Microsoft 365 builds before Version 2601 stop here; they read like LTSC.
    expect(at("1.9")).toMatchObject({ tier: "basic", ...fullOnly });
    expect(at("1.10")).toMatchObject(
      Object.fromEntries(Object.keys(fullOnly).map((key) => [key, true])),
    );
  });

  it("offers the slide export with the full tier and the whole file wherever the host hands it over", () => {
    const at = (set: string, fileApi: boolean) =>
      powerpointReadSupport(requirementsUpTo(set), { fileApi });
    expect(at("1.10", true)).toMatchObject({
      slideExport: true,
      presentationFile: true,
    });
    expect(at("1.5", true)).toMatchObject({
      slideExport: false,
      presentationFile: true,
    });
    expect(at("1.5", false)).toMatchObject({ presentationFile: false });
    // Below 1.4 nothing is read, so there is no slide to fill from the file.
    expect(at("1.3", true)).toMatchObject({ presentationFile: false });
  });

  it.each([
    ["PC", true, true],
    ["Mac", true, true],
    ["iOS", true, false],
    ["PC", false, false],
  ])(
    "reads the whole file on %s only where the compressed file set is reported (%s)",
    (platform, compressedFile, expected) => {
      const office = (
        globalThis as unknown as {
          Office: { context: Record<string, unknown> };
        }
      ).Office;
      const saved = { ...office.context };
      office.context.requirements = {
        isSetSupported: (name: string, version?: string) =>
          name === "CompressedFile"
            ? compressedFile
            : requirementsUpTo("1.10")(name, version),
      };
      office.context.document = { getFileAsync: () => {} };
      office.context.diagnostics = { platform };
      try {
        expect(currentPowerPointReadSupport().presentationFile).toBe(expected);
      } finally {
        for (const key of Object.keys(office.context))
          delete office.context[key];
        Object.assign(office.context, saved);
      }
    },
  );

  it("is full exactly when every 1.10 switch is on", () => {
    for (const set of ["1.3", "1.4", "1.5", "1.8", "1.9", "1.10"]) {
      const support = powerpointReadSupport(requirementsUpTo(set));
      expect(support.tier === "full").toBe(
        support.placeholderRole &&
          support.tables &&
          support.bulletLevels &&
          support.slidePicture,
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

  it("reports the API set and tier for the backend's metrics", () => {
    reportPowerPointReadSupport(powerpointReadSupport(requirementsUpTo("1.5")));
    expect(setOfficeHostInfo).toHaveBeenLastCalledWith({
      api: "1.5",
      tier: "basic",
    });
    reportPowerPointReadSupport(powerpointReadSupport(() => false));
    expect(setOfficeHostInfo).toHaveBeenLastCalledWith({
      api: "none",
      tier: "none",
    });
  });
});
