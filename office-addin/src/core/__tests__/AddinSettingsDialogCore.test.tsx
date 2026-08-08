import { i18n } from "@lingui/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AddinSettingsDialogCore } from "../AddinSettingsDialogCore";

import type { ReactNode } from "react";

vi.mock("@erato/frontend/library", () => ({
  AppearanceTabContent: () => <div data-testid="appearance-settings" />,
  AudioInputTabContent: () => null,
  DesktopSidecarTabContent: () => null,
  ModalBase: ({
    children,
    isOpen,
  }: {
    children: ReactNode;
    isOpen: boolean;
  }) => (isOpen ? children : null),
  useFeatureConfig: () => ({
    audioTranscription: { enabled: false },
    audioDictation: { enabled: false },
    audioConversational: { enabled: false },
    userPreferences: { desktopSidecarTabEnabled: false },
  }),
}));
vi.mock("../../components/UserSettingsTabContent", () => ({
  UserSettingsTabContent: () => <div data-testid="user-settings" />,
}));

describe("AddinSettingsDialogCore", () => {
  beforeEach(() => i18n.activate("en"));

  it("shows generic settings without an empty Outlook behavior tab", () => {
    render(<AddinSettingsDialogCore isOpen={true} onClose={() => {}} />);

    expect(screen.getByRole("tab", { name: "Appearance" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "User settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Outlook" })).toBeNull();
    expect(screen.queryByText("Outlook behavior")).toBeNull();
  });
});
