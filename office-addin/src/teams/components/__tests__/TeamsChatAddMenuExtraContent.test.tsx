import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamsChatAddMenuExtraContent } from "../TeamsChatAddMenuExtraContent";

import type { TeamsChatFetcherUnavailableReason } from "../../hooks/useTeamsChatFetcher";
import type { useFileCapabilitiesContext } from "@erato/frontend/library";

type TestCapability = ReturnType<
  typeof useFileCapabilitiesContext
>["capabilities"][number];

const state = vi.hoisted(() => ({
  unavailableReason: null as TeamsChatFetcherUnavailableReason | null,
  capabilities: [] as TestCapability[],
  isLoading: false,
  error: null as Error | null,
  open: vi.fn(),
}));

// Mock the provider lookup, retaining the real capability conversion.
// `Row` and `PopoverSectionHeader` stay real — the row's element, its role and
// its roving marker are what this suite asserts, and a stub would assert the
// stub.
vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useFileCapabilitiesContext: () => ({
    capabilities: state.capabilities,
    isLoading: state.isLoading,
    error: state.error,
  }),
}));
vi.mock("../../hooks/useTeamsChatFetcher", () => ({
  useTeamsChatFetcher: () => ({
    fetcher: state.unavailableReason === null ? {} : null,
    unavailableReason: state.unavailableReason,
  }),
}));
vi.mock("../../providers/TeamsChatPickerProvider", () => ({
  useTeamsChatPicker: () => ({ open: state.open }),
}));

const textCapability: TestCapability = {
  id: "text",
  extensions: ["txt", "md"],
  mime_types: ["text/plain"],
  operations: ["extract_text"],
  upload_allowed: true,
};
const unrestrictedCapability: TestCapability = {
  id: "other",
  extensions: ["*"],
  mime_types: ["*/*"],
  operations: [],
  upload_allowed: true,
};

describe("TeamsChatAddMenuExtraContent", () => {
  beforeEach(() => {
    i18n.activate("en");
    state.unavailableReason = null;
    state.capabilities = [textCapability];
    state.isLoading = false;
    state.error = null;
    state.open.mockReset();
  });
  afterEach(cleanup);

  const onSelectFiles = () => Promise.resolve();

  it("renders one menu item that hands the upload callback to the picker", () => {
    const onClose = vi.fn();
    render(
      <TeamsChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={onClose}
      />,
    );

    const row = screen.getByRole("menuitem", { name: /Teams chats…/ });
    fireEvent.click(row);

    expect(state.open).toHaveBeenCalledWith(onSelectFiles);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the injected row on the menu's roving marker", () => {
    render(
      <TeamsChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
      />,
    );

    // The "+" menu roves over `[data-row-item]`, which Row emits and the row
    // no longer writes by hand. Without it this row is unreachable by arrow
    // keys while every role assertion above stays green.
    const row = screen.getByTestId("teams-add-menu-chats");
    expect(row).toHaveAttribute("data-row-item");
    expect(row).toHaveAttribute("tabindex", "-1");
  });

  it("renders nothing when Graph is unavailable on this session", () => {
    state.unavailableReason = "graph-unavailable";
    const { container } = render(
      <TeamsChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("disables the row while the composer is busy, full, or has no upload path", () => {
    const { rerender } = render(
      <TeamsChatAddMenuExtraContent onClose={() => {}} />,
    );
    expect(screen.getByRole("menuitem")).toBeDisabled();

    rerender(
      <TeamsChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
        isProcessing
      />,
    );
    expect(screen.getByRole("menuitem")).toBeDisabled();

    rerender(
      <TeamsChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("menuitem")).toBeDisabled();

    // At the attachment limit a picked conversation would be silently
    // truncated by the composer merge, so the row must not open the picker.
    rerender(
      <TeamsChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
        uploadDisabled
      />,
    );
    expect(screen.getByRole("menuitem")).toBeDisabled();
  });

  it.each([[unrestrictedCapability], [unrestrictedCapability, textCapability]])(
    "opens the picker for unrestricted uploads (%j)",
    (...capabilities) => {
      state.capabilities = capabilities;
      const onClose = vi.fn();
      render(
        <TeamsChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={onClose}
        />,
      );

      const row = screen.getByRole("menuitem");
      expect(row).toBeEnabled();
      expect(
        screen.queryByText("This workspace can't accept text files"),
      ).not.toBeInTheDocument();
      fireEvent.click(row);
      expect(state.open).toHaveBeenCalledWith(onSelectFiles);
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { capabilities: [], isLoading: false, error: null },
    { capabilities: [], isLoading: true, error: null },
    { capabilities: [], isLoading: false, error: new Error("Failed") },
    { capabilities: [textCapability], isLoading: true, error: null },
    {
      capabilities: [unrestrictedCapability],
      isLoading: false,
      error: new Error("Failed"),
    },
  ])(
    "keeps unavailable capabilities disabled without a false warning (%j)",
    (context) => {
      Object.assign(state, context);
      const onClose = vi.fn();
      render(
        <TeamsChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={onClose}
        />,
      );

      const row = screen.getByRole("menuitem");
      expect(row).toBeDisabled();
      expect(
        screen.queryByText("This workspace can't accept text files"),
      ).not.toBeInTheDocument();
      fireEvent.click(row);
      expect(state.open).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ ...textCapability, id: "pdf" }],
    [
      { ...textCapability, upload_allowed: false },
      { ...unrestrictedCapability, upload_allowed: false },
    ],
  ])(
    "explains itself when text uploads are unsupported (%j)",
    (...capabilities) => {
      state.capabilities = capabilities;
      render(
        <TeamsChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={() => {}}
        />,
      );

      expect(screen.getByRole("menuitem")).toBeDisabled();
      expect(
        screen.getByText("This workspace can't accept text files"),
      ).toBeInTheDocument();
    },
  );
});
