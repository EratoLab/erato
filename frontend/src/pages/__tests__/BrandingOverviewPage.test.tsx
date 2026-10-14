import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages } from "@/locales/en/messages.json";

import BrandingOverviewPage, {
  manifestAssetUrl,
} from "../BrandingOverviewPage";

import type { Messages } from "@lingui/core";

vi.mock("@/config/themeConfig", () => ({
  defaultThemeConfig: {},
  loadResolvedThemeConfig: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/components/providers/ThemeProvider", () => ({
  resolveLogoPath: vi.fn((_config, _path, dark) =>
    Promise.resolve(dark ? "/brand-dark.svg" : "/brand.svg"),
  ),
  resolveThemeAssetPath: vi.fn(() => Promise.resolve(null)),
}));

function renderPage() {
  return render(
    <I18nProvider i18n={i18n}>
      <BrandingOverviewPage />
    </I18nProvider>,
  );
}

describe("branding overview", () => {
  beforeEach(() => {
    i18n.load("en", messages as unknown as Messages);
    i18n.activate("en");
    window.FRONTEND_PLATFORM = "common";
  });
  afterEach(() => {
    delete window.FRONTEND_PLATFORM;
    delete window.BRANDING_OVERVIEW;
  });

  it("shows both modes and makes broken images visible", async () => {
    renderPage();
    const logo = await screen.findByRole("img", {
      name: "Application logo · Light",
    });
    expect(logo).toHaveAttribute("src", "/brand.svg");
    expect(
      screen.getByRole("img", { name: "Application logo · Dark" }),
    ).toHaveAttribute("src", "/brand-dark.svg");
    expect(screen.getAllByText("No custom image configured")).toHaveLength(4);
    fireEvent.error(logo);
    expect(screen.getByText("Image could not be loaded")).toBeInTheDocument();
  });

  it("uses configured Office and Teams icons without nesting another frame", async () => {
    window.FRONTEND_PLATFORM = "platform-office-addin";
    window.BRANDING_OVERVIEW = {
      officeEnabled: true,
      teamsEnabled: true,
      office: {
        icon16: "assets/custom-16.png",
        icon: "https://example.com/icon.png",
      },
      teams: { outline: "/public/common/outline.png" },
    };
    const { container } = renderPage();
    await screen.findByRole("img", { name: "Application logo · Light" });
    expect(screen.getByRole("img", { name: "icon16" })).toHaveAttribute(
      "src",
      "/public/platform-office-addin/assets/custom-16.png",
    );
    expect(screen.getByRole("img", { name: "icon" })).toHaveAttribute(
      "src",
      "https://example.com/icon.png",
    );
    expect(screen.getByRole("img", { name: "outline" })).toHaveAttribute(
      "src",
      "/public/common/outline.png",
    );
    expect(container.querySelector("iframe")).toBeNull();
  });

  it.each([
    [" assets/icon.png ", "/public/platform-office-addin/assets/icon.png"],
    ["/custom/icon.png", "/custom/icon.png"],
    ["https://example.com/icon.png", "https://example.com/icon.png"],
  ])("resolves manifest asset %s", (input, expected) => {
    expect(manifestAssetUrl(input)).toBe(expected);
  });
});
