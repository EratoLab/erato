import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamsChatAddMenuExtraContent } from "../TeamsChatAddMenuExtraContent";

import type { TeamsChatFetcherUnavailableReason } from "../../hooks/useTeamsChatFetcher";

interface TestCapability {
  id: string;
}

const state = vi.hoisted(() => ({
  unavailableReason: null as TeamsChatFetcherUnavailableReason | null,
  capabilities: [] as { id: string }[],
  open: vi.fn(),
}));

vi.mock("@erato/frontend/library", () => ({
  getSupportedFileTypes: (capabilities: TestCapability[]) =>
    capabilities.map((capability) => capability.id),
  useFileCapabilitiesContext: () => ({ capabilities: state.capabilities }),
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

const textCapability: TestCapability = { id: "text" };

describe("TeamsChatAddMenuExtraContent", () => {
  beforeEach(() => {
    i18n.activate("en");
    state.unavailableReason = null;
    state.capabilities = [textCapability];
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

  it("disables the row while the composer is busy or has no upload path", () => {
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
  });

  it("explains itself instead of failing late when text uploads are unsupported", () => {
    state.capabilities = [{ id: "pdf" }];
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
  });
});
