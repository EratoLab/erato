import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidecarIndexing } from "@/hooks/useSidecarIndexing";

import { SidecarIndexingControls } from "./SidecarIndexingCard";

vi.mock("@/hooks/useSidecarIndexing", () => ({ useSidecarIndexing: vi.fn() }));

const save = vi.fn();
const data = {
  mailboxes: [
    {
      id: "a",
      emailAddress: "shared@example.com",
      displayName: "Shared",
      source: "pst",
    },
    {
      id: "b",
      emailAddress: "personal@example.com",
      displayName: "Personal",
      source: "pst",
    },
  ],
  status: {
    effectiveConfiguration: { parallelism: 2, documentsPerMinute: 40 },
    configuration: {
      user_configuration: {
        indexing_mailboxes: [
          { mailbox_id: "a", enabled: true, priority: 10 },
          { mailbox_id: "b", enabled: false, priority: 0 },
        ],
      },
      organization_configuration: {},
    },
    generations: [
      {
        role: "active",
        segments: [
          {
            mailboxId: "b",
            kind: "email",
            fileType: null,
            coverage: { indexedCurrent: 4, knownEligible: 10 },
          },
          {
            mailboxId: "b",
            kind: "file",
            fileType: null,
            coverage: { indexedCurrent: 2, knownEligible: 3 },
          },
        ],
      },
    ],
  },
};

beforeEach(() => {
  save.mockReset();
  vi.mocked(useSidecarIndexing).mockReturnValue({
    data,
    isPending: false,
    error: null,
    save,
    saving: false,
    supported: true,
    saveError: null,
  } as unknown as ReturnType<typeof useSidecarIndexing>);
});

describe("mailbox indexing controls", () => {
  it("shows ordered mailboxes and all three progress counts", () => {
    render(<SidecarIndexingControls />);
    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("personal@example.com");
    expect(entries[0]).toHaveTextContent("4 / 10 emails indexed");
    expect(entries[0]).toHaveTextContent("2 / 3 attachments indexed");
    expect(entries[0]).toHaveTextContent("6 / 13 documents indexed");
    expect(
      screen.getByRole("button", {
        name: "Increase priority for personal@example.com",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: "Enable indexing for personal@example.com",
      }),
    ).not.toBeChecked();
  });
  it("writes explicit priorities when moving mailboxes and preserves enablement", () => {
    render(<SidecarIndexingControls />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase priority for shared@example.com",
      }),
    );
    expect(save).toHaveBeenCalledWith({
      indexing_mailboxes: [
        { mailbox_id: "a", enabled: true, priority: 0 },
        { mailbox_id: "b", enabled: false, priority: 1 },
      ],
    });
  });
  it("toggles one mailbox without dropping other overrides", () => {
    render(<SidecarIndexingControls />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable indexing for personal@example.com",
      }),
    );
    expect(save).toHaveBeenCalledWith({
      indexing_mailboxes: [
        { mailbox_id: "a", enabled: true, priority: 10 },
        { mailbox_id: "b", enabled: true, priority: 0 },
      ],
    });
  });
  it("validates and saves global limits", () => {
    render(<SidecarIndexingControls />);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Indexing parallelism" }),
      { target: { value: "0" } },
    );
    expect(
      screen.getByRole("button", { name: "Save indexing settings" }),
    ).toBeDisabled();
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Indexing parallelism" }),
      { target: { value: "3" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Documents per minute" }),
      { target: { value: "120" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    expect(save).toHaveBeenCalledWith({
      indexing_parallelism: 3,
      indexing_documents_per_minute: 120,
    });
  });
});
