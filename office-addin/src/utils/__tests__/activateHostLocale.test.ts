import { beforeEach, describe, expect, it, vi } from "vitest";

import { activateHostLocale } from "../activateHostLocale";

const dynamicActivate = vi.fn<(locale: string) => Promise<void>>();

vi.mock("@erato/frontend/library", () => ({
  dynamicActivate: (locale: string) => dynamicActivate(locale),
  getSupportedLocale: (locale: string | null | undefined) =>
    locale && ["en", "de"].includes(locale.slice(0, 2))
      ? locale.slice(0, 2)
      : null,
}));

describe("activateHostLocale", () => {
  beforeEach(() => {
    dynamicActivate.mockReset();
    dynamicActivate.mockResolvedValue(undefined);
  });

  it("activates the host's display language", async () => {
    await activateHostLocale("de-DE");

    expect(dynamicActivate).toHaveBeenCalledWith("de");
  });

  it.each([null, undefined, "", "it-IT"])(
    "keeps the browser-detected locale for %j",
    async (hostLocale) => {
      await activateHostLocale(hostLocale);

      expect(dynamicActivate).not.toHaveBeenCalled();
    },
  );

  it("never rejects when the catalog fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dynamicActivate.mockRejectedValue(new Error("offline"));

    await expect(activateHostLocale("de-DE")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
