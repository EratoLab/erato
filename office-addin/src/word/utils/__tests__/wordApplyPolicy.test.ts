import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWordDiagnosticReport } from "../wordApplyDiagnostics";
import { wordApplyPolicy } from "../wordApplyPolicy";
import { supportsWordDocumentPackage } from "../wordDocumentPackage";
import { wordInPlaceAvailability } from "../wordInPlaceSwitch";

const DESKTOP = {
  inPlace: false,
  wholeDocumentImport: "allowed",
  packageRead: true,
} as const;
const WEB = {
  inPlace: true,
  wholeDocumentImport: "off",
  packageRead: true,
} as const;

const word = (platform: string) =>
  vi.stubGlobal("Office", {
    context: {
      diagnostics: { host: "Word", platform, version: "16.0.20326" },
      requirements: { isSetSupported: () => true },
      document: { url: "https://contoso/report.docx", getFileAsync: () => {} },
    },
  });

const clear = () => {
  vi.unstubAllGlobals();
  delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
  delete window.WORD_FORCE_IMPORT_APPLY;
  delete window.WORD_IN_PLACE_APPLY;
};

describe("wordApplyPolicy", () => {
  beforeEach(clear);
  afterEach(() => {
    clear();
    window.WORD_IN_PLACE_APPLY = true;
  });

  it("matches the backend defaults when the deployment sends no settings", () => {
    expect(wordApplyPolicy("PC")).toEqual(DESKTOP);
    expect(wordApplyPolicy("Mac")).toEqual(DESKTOP);
    expect(wordApplyPolicy("unknown")).toEqual(DESKTOP);
    expect(wordApplyPolicy("OfficeOnline")).toEqual(WEB);
  });

  it("reads the running host from Office", () => {
    word("OfficeOnline");
    expect(wordApplyPolicy()).toEqual(WEB);
    word("Mac");
    expect(wordApplyPolicy()).toEqual(DESKTOP);
  });

  it("keeps each host's own defaults for keys a partial table leaves out", () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      word_include_document: true,
      word_apply: {
        web: { package_read: false },
        mac: { in_place: true },
        pc: { whole_document_import: "bogus" as never },
      },
    };
    expect(wordApplyPolicy("OfficeOnline")).toEqual({
      ...WEB,
      packageRead: false,
    });
    expect(wordApplyPolicy("Mac")).toEqual({ ...DESKTOP, inPlace: true });
    expect(wordApplyPolicy("PC")).toEqual(DESKTOP);
    expect(wordApplyPolicy("unknown")).toEqual(DESKTOP);
  });

  it("lets the kill switch beat the in-place override, which beats the deployment", () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      word_apply: { web: { in_place: false, whole_document_import: "off" } },
    };
    window.WORD_IN_PLACE_APPLY = true;
    expect(wordApplyPolicy("PC").inPlace).toBe(true);
    expect(wordApplyPolicy("OfficeOnline")).toEqual({
      inPlace: true,
      wholeDocumentImport: "off",
      packageRead: true,
    });

    window.WORD_FORCE_IMPORT_APPLY = true;
    expect(wordApplyPolicy("PC").inPlace).toBe(false);
    expect(wordApplyPolicy("OfficeOnline").inPlace).toBe(false);
  });

  it("turns in-place writing off where the deployment does", () => {
    word("PC");
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "disabled",
    });
    word("OfficeOnline");
    expect(wordInPlaceAvailability()).toEqual({ enabled: true });
  });

  it("reads the body instead of the package when package reads are off", () => {
    word("OfficeOnline");
    expect(supportsWordDocumentPackage()).toBe(true);
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
      word_apply: { web: { package_read: false } },
    };
    expect(supportsWordDocumentPackage()).toBe(false);
    expect(wordInPlaceAvailability()).toEqual({
      enabled: false,
      reason: "no-package",
    });
  });

  it("names the policy on the copyable report's host line", () => {
    word("OfficeOnline");
    expect(renderWordDiagnosticReport("apply", "blocked", undefined)).toMatch(
      /· Policy web: in-place on, import off, package read on · In-place: on$/,
    );
    word("Mac");
    window.WORD_FORCE_IMPORT_APPLY = true;
    expect(renderWordDiagnosticReport("apply", "blocked", undefined)).toMatch(
      /· Policy mac: in-place off \(override\), import allowed, package read on · In-place: off \(disabled\)$/,
    );
  });
});
