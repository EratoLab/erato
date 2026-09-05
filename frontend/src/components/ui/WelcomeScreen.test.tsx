import { i18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import {
  WelcomeScreen,
  WelcomeScreenLower,
  WelcomeScreenUpper,
} from "./WelcomeScreen";

i18n.load("en", enMessages as unknown as Messages);
i18n.activate("en");

const themeState = vi.hoisted(() => ({ isCustomTheme: false }));
const mockLoadThemeFromPath = vi.hoisted(() => vi.fn());

vi.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: () => ({ isCustomTheme: themeState.isCustomTheme }),
}));

vi.mock("@/app/env", () => ({
  env: () => ({ themeCustomerName: "acme", commonPublicBasePath: "" }),
}));

vi.mock("@/utils/themeUtils", () => ({
  loadThemeFromPath: (...args: unknown[]) => mockLoadThemeFromPath(...args),
}));

vi.mock("@/components/ui/Logo", () => ({
  Logo: ({ width, height }: { width: number; height: number }) => (
    <img data-testid="welcome-logo" alt="" width={width} height={height} />
  ),
}));

vi.mock("@/hooks/ui/usePageAlignment", () => ({
  usePageAlignment: () => ({
    containerClasses: "max-w-2xl mx-auto",
    textAlignment: "text-center",
    flexAlignment: "items-center",
    justifyAlignment: "justify-center",
  }),
}));

vi.mock("@/components/ui/Chat/StarterPromptsSection", () => ({
  StarterPromptsSection: ({ className }: { className?: string }) => (
    <div data-testid="starter-prompts-section" className={className} />
  ),
}));

const renderWithI18n = (ui: React.ReactElement) =>
  render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

describe("WelcomeScreen", () => {
  beforeEach(() => {
    themeState.isCustomTheme = false;
    mockLoadThemeFromPath.mockReset();
  });

  it("stacks the upper part before the lower part", () => {
    renderWithI18n(<WelcomeScreen />);

    const upper = screen.getByTestId("welcome-screen-default");
    const lower = screen.getByTestId("welcome-screen-lower");
    expect(
      upper.compareDocumentPosition(lower) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the heading in the upper part and leaves the rest out", () => {
    renderWithI18n(<WelcomeScreenUpper />);

    const root = screen.getByTestId("welcome-screen-default");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Welcome to AI Assistant",
      }),
    ).toHaveClass("text-2xl");
    expect(root).toHaveClass("max-w-2xl", "px-4");
    expect(root.className).not.toContain("p-12");
    expect(
      screen.queryByText("Get expert help with your questions"),
    ).toBeNull();
    expect(screen.queryByTestId("starter-prompts-section")).toBeNull();
    expect(screen.queryByTestId("welcome-logo")).toBeNull();
  });

  it("shows the customer logo above the heading once branding loads", async () => {
    themeState.isCustomTheme = true;
    mockLoadThemeFromPath.mockResolvedValue({
      branding: { welcomeScreen: { enabled: true, logoSize: "small" } },
    });

    renderWithI18n(<WelcomeScreenUpper />);

    const logo = await screen.findByTestId("welcome-logo");
    expect(logo).toHaveAttribute("width", "150");
    expect(logo).toHaveAttribute("height", "50");
    expect(logo.parentElement).toHaveClass("mb-4");
    expect(
      logo.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mockLoadThemeFromPath).toHaveBeenCalledWith(
      "/custom-theme/acme/theme.json",
    );
  });

  it("leaves the logo out when branding is disabled", async () => {
    themeState.isCustomTheme = true;
    mockLoadThemeFromPath.mockResolvedValue({
      branding: { welcomeScreen: { enabled: false, logoSize: "large" } },
    });

    renderWithI18n(<WelcomeScreenUpper />);

    await vi.waitFor(() => expect(mockLoadThemeFromPath).toHaveBeenCalled());
    expect(screen.queryByTestId("welcome-logo")).toBeNull();
  });

  it("holds subtitle, description and starter prompts in the lower part at the composer width", () => {
    renderWithI18n(<WelcomeScreenLower />);

    const root = screen.getByTestId("welcome-screen-lower");
    expect(root).toHaveClass(
      "max-w-[var(--theme-layout-chat-input-max-width)]",
      "mx-auto",
      "px-4",
    );
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Get expert help with your questions",
      }),
    ).toHaveClass("text-lg", "font-medium", "text-theme-fg-secondary");
    const description = screen.getByText(
      "Ask questions and get helpful responses from our AI assistant.",
    );
    expect(description.parentElement).toHaveClass(
      "text-base",
      "text-theme-fg-muted",
    );
    expect(screen.getByTestId("starter-prompts-section")).toHaveClass("mt-4");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
