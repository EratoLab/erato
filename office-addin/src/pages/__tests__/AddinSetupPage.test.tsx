import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinSetupRoute } from "../AddinSetupPage";

describe("AddinSetupRoute host boundary", () => {
  const originalOffice = Object.getOwnPropertyDescriptor(globalThis, "Office");

  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "Office");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "<OfficeApp />",
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalOffice) {
      Object.defineProperty(globalThis, "Office", originalOffice);
    }
  });

  it("loads without Office.js or appending its CDN script", async () => {
    const appendChild = vi.spyOn(document.head, "appendChild");
    render(<AddinSetupRoute />);

    expect(
      await screen.findByRole("heading", {
        name: "Upload the generated manifest",
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(
      appendChild.mock.calls.some(([node]) =>
        node instanceof HTMLScriptElement
          ? node.src.includes("appsforoffice.microsoft.com")
          : false,
      ),
    ).toBe(false);
  });
});
