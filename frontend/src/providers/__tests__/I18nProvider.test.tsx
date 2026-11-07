import { i18n } from "@lingui/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../I18nProvider";

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n")>()),
  initializeI18n: () => Promise.resolve(),
}));

afterEach(() => {
  act(() => i18n.activate("en"));
});

describe("I18nProvider", () => {
  it("keeps <html lang> on the active locale", async () => {
    document.documentElement.lang = "";
    render(
      <I18nProvider>
        <p>Ready</p>
      </I18nProvider>,
    );
    await screen.findByText("Ready");
    expect(document.documentElement.lang).toBe("en");

    act(() => i18n.loadAndActivate({ locale: "de", messages: {} }));

    expect(document.documentElement.lang).toBe("de");
  });
});
