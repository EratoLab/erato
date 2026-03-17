import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserPreferencesDialog } from "./UserPreferencesDialog";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

vi.mock("../Feedback/Alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

const userProfile: UserProfile = {
  id: "user-1",
  groups: ["engineering"],
  organization_group_ids: ["org-group-1"],
  preferred_language: "en",
  name: "Max Mustermann",
  email: "max.mustermann@example.com",
  preference_nickname: "Max",
  preference_job_title: "Product Manager",
  preference_assistant_custom_instructions:
    "Prefer concise bullet points and highlight risks first.",
  preference_assistant_additional_information:
    "I work with enterprise customers in regulated industries.",
};

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <UserPreferencesDialog
        isOpen={true}
        onClose={vi.fn()}
        userProfile={userProfile}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("UserPreferencesDialog", () => {
  it("renders accessible vertical tabs and linked tabpanels", () => {
    renderDialog();

    const tablist = screen.getByRole("tablist", { name: "Preferences" });
    const personalizationTab = screen.getByRole("tab", {
      name: "Personalization",
    });
    const dataTab = screen.getByRole("tab", { name: "Data" });
    const personalizationPanel = screen.getByRole("tabpanel", {
      name: "Personalization",
    });
    const dataPanelId = dataTab.getAttribute("aria-controls");
    const dataPanel =
      dataPanelId !== null ? document.getElementById(dataPanelId) : null;

    expect(tablist).toHaveAttribute("aria-orientation", "vertical");
    expect(personalizationTab).toHaveAttribute("aria-selected", "true");
    expect(dataTab).toHaveAttribute("aria-selected", "false");
    expect(personalizationTab).toHaveAttribute(
      "aria-controls",
      personalizationPanel.id,
    );
    expect(dataPanel).not.toBeNull();
    expect(dataTab).toHaveAttribute("aria-controls", dataPanel?.id);
    expect(personalizationPanel).not.toHaveAttribute("hidden");
    expect(dataPanel).toHaveAttribute("hidden");
    expect(personalizationPanel).toHaveAttribute(
      "aria-labelledby",
      personalizationTab.id,
    );
    expect(dataPanel).toHaveAttribute("aria-labelledby", dataTab.id);
  });

  it("switches panels and only shows footer actions on the personalization tab", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("tab", { name: "Data" }));

    expect(screen.getByRole("tabpanel", { name: "Data" })).toBeInTheDocument();
    expect(
      screen.getByText("Archive all chats in your account."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Personalization" }));

    expect(
      screen.getByRole("tabpanel", { name: "Personalization" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("supports keyboard navigation between tabs", () => {
    renderDialog();

    const personalizationTab = screen.getByRole("tab", {
      name: "Personalization",
    });
    const dataTab = screen.getByRole("tab", { name: "Data" });

    personalizationTab.focus();
    fireEvent.keyDown(personalizationTab, { key: "ArrowDown" });

    expect(dataTab).toHaveFocus();
    expect(dataTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Data" })).toBeInTheDocument();
  });
});
