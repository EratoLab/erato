import { ThemeProvider } from "@erato/frontend/library";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SmokeWindow } from "./SmokeWindow";
import packageJson from "../../../package.json";
import { activateLocale, i18n } from "../../i18n";

const renderWindow = (locale: string) => {
  activateLocale(locale);
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider
        enableCustomTheme={false}
        initialThemeMode="light"
        persistThemeMode={false}
        persistTextSize={false}
      >
        <SmokeWindow locale={locale} />
      </ThemeProvider>
    </I18nProvider>,
  );
};

describe("SmokeWindow", () => {
  afterEach(() => {
    cleanup();
    delete window.ipc;
  });

  it("renders the kit Alert with the translated sentence and the version", () => {
    renderWindow("en");

    expect(
      screen.getByText(
        "The desktop UI bundle loaded inside the sidecar window.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("smoke-version").textContent).toContain(
      `Bundle ${packageJson.version}`,
    );
    expect(screen.getByTestId("smoke-version").textContent).toContain(
      "locale en",
    );
  });

  it("renders the German catalog when asked for a German locale", () => {
    renderWindow("de");

    expect(screen.getByRole("button", { name: "Klick zählen" })).toBeTruthy();
  });

  it("posts the ready message with the bundle version when the host bridge exists", () => {
    const postMessage = vi.fn<(message: string) => void>();
    window.ipc = { postMessage };

    renderWindow("en");

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      action: "ready",
      version: packageJson.version,
    });
  });

  it("counts clicks locally and never posts anything else", () => {
    const postMessage = vi.fn<(message: string) => void>();
    window.ipc = { postMessage };

    renderWindow("en");
    const button = screen.getByRole("button", { name: "Count a click" });
    act(() => {
      button.click();
      button.click();
    });

    expect(screen.getByTestId("smoke-clicks").textContent).toBe("Clicks: 2");
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});
