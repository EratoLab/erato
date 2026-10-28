import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { useToastStore } from "@/components/ui/Toast/toastStore";

import { SharingDialog } from "./SharingDialog";

import type { ShareGrant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { OrganizationMember } from "@/types/sharing";

const createGrant = vi.fn<(input: { subject_id: string }) => Promise<void>>();
const deleteGrant = vi.fn<(grantId: string) => Promise<void>>();
let grants: ShareGrant[] = [];

const members: OrganizationMember[] = [
  { id: "ada", display_name: "Ada", type: "user", subject_type_id: "id" },
  { id: "bob", display_name: "Bob", type: "user", subject_type_id: "id" },
];

vi.mock("@/hooks/sharing", () => ({
  useShareGrants: () => ({
    grants,
    isLoading: false,
    error: null,
    createGrant,
    deleteGrant,
  }),
  useOrganizationMembersSearch: () => ({
    members,
    isLoading: false,
    error: null,
    isSearching: false,
  }),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useAssistantsFeature: () => ({ enableEditSharing: false }),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const toastTitles = (variant: string) =>
  useToastStore
    .getState()
    .toasts.filter((toast) => toast.variant === variant)
    .map((toast) => toast.title);

function renderDialog() {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider
        initialThemeMode="light"
        persistThemeMode={false}
        enableCustomTheme={false}
      >
        <SharingDialog
          isOpen={true}
          onClose={vi.fn()}
          resourceType="assistant"
          resourceId="assistant-1"
          resourceName="Helper"
        />
      </ThemeProvider>
    </I18nProvider>,
  );
}

const checkbox = (name: "Ada" | "Bob") =>
  screen.getAllByRole("checkbox")[name === "Ada" ? 0 : 1];
const addButton = () => screen.getByRole("button", { name: "Add" });

describe("SharingDialog", () => {
  beforeEach(() => {
    createGrant.mockReset();
    deleteGrant.mockReset();
    grants = [];
    useToastStore.setState({ toasts: [] });
  });

  it("sends each grant once when Add is clicked again while it is pending", async () => {
    const pending = deferred();
    createGrant.mockReturnValue(pending.promise);
    renderDialog();

    fireEvent.click(checkbox("Ada"));
    fireEvent.click(checkbox("Bob"));
    fireEvent.click(addButton());
    fireEvent.click(addButton());

    expect(createGrant).toHaveBeenCalledTimes(2);
    expect(addButton()).toBeDisabled();
    expect(addButton()).toHaveAttribute("aria-busy", "true");

    pending.resolve();
    await settle();

    expect(toastTitles("success")).toEqual(["Access granted successfully"]);
    expect(checkbox("Ada")).not.toBeChecked();
    expect(checkbox("Bob")).not.toBeChecked();
  });

  it("keeps only the failed subjects selected, so a retry resends just those", async () => {
    createGrant.mockImplementation(async ({ subject_id }) => {
      if (subject_id === "bob") throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderDialog();

    fireEvent.click(checkbox("Ada"));
    fireEvent.click(checkbox("Bob"));
    fireEvent.click(addButton());
    await settle();

    expect(toastTitles("error")).toEqual(["Failed to grant access"]);
    expect(checkbox("Ada")).not.toBeChecked();
    expect(checkbox("Bob")).toBeChecked();

    createGrant.mockClear();
    createGrant.mockResolvedValue();
    fireEvent.click(addButton());
    await settle();

    expect(createGrant).toHaveBeenCalledTimes(1);
    expect(createGrant).toHaveBeenCalledWith(
      expect.objectContaining({ subject_id: "bob" }),
    );
    expect(toastTitles("error")).toEqual([]);
    expect(toastTitles("success")).toEqual(["Access granted successfully"]);
  });

  it("removes a grant once when its removal is confirmed again while pending", async () => {
    grants = [
      {
        id: "grant-1",
        resource_type: "assistant",
        resource_id: "assistant-1",
        subject_type: "user",
        subject_id_type: "id",
        subject_id: "carol",
        role: "viewer",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const pending = deferred();
    deleteGrant.mockReturnValue(pending.promise);
    renderDialog();

    const confirmRemoval = () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    };
    confirmRemoval();
    confirmRemoval();

    expect(deleteGrant).toHaveBeenCalledTimes(1);

    pending.resolve();
    await settle();

    expect(toastTitles("success")).toEqual(["Access removed successfully"]);
  });
});
