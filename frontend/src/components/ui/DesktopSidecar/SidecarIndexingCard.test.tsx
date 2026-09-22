import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidecarIndexing } from "@/hooks/useSidecarIndexing";
import { expectSidecarConfigurationAccepted } from "@/lib/desktopSidecar/__tests__/configurationTestUtils";

import { SidecarIndexingControls } from "./SidecarIndexingCard";

import type { SidecarConfiguration } from "@erato/desktop-sidecar-protocol";

vi.mock("@/hooks/useSidecarIndexing", () => ({ useSidecarIndexing: vi.fn() }));

const sharedId = "aabbccdd112244558899001122334455";
const sharedUuid = "aabbccdd-1122-4455-8899-001122334455";
const personalId = "bbccddee2233445599aa112233445566";
const personalUuid = "bbccddee-2233-4455-99aa-112233445566";
const save = vi.fn<(patch: Partial<SidecarConfiguration>) => Promise<void>>();
const data = {
  mailboxes: [
    {
      id: sharedId,
      emailAddress: "shared@example.com",
      displayName: "Shared",
      source: "pst",
    },
    {
      id: personalId,
      emailAddress: "personal@example.com",
      displayName: "Personal",
      source: "pst",
    },
  ],
  status: {
    state: "running",
    discovery: [],
    effectiveConfiguration: { parallelism: 2, documentsPerMinute: 40 },
    configuration: {
      user_configuration: {
        indexing_mailboxes: [
          { mailbox_id: sharedUuid, enabled: true, priority: 10 },
          {
            mailbox_id: personalUuid.toUpperCase(),
            enabled: false,
            priority: 0,
          },
        ],
      },
      organization_configuration: {},
    },
    generations: [
      {
        role: "active",
        segments: [
          {
            mailboxId: personalUuid,
            kind: "email",
            fileType: null,
            backlog: { discoveryComplete: false, remaining: 7, inProgress: 0 },
            coverage: { indexedCurrent: 4, knownEligible: 10 },
          },
          {
            mailboxId: personalUuid,
            kind: "file",
            fileType: null,
            backlog: { discoveryComplete: false, remaining: 7, inProgress: 0 },
            coverage: { indexedCurrent: 2, knownEligible: 3 },
          },
        ],
      },
    ],
  },
};
let currentData: typeof data;

async function expectValidSavedConfiguration() {
  expect(save).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
  );
  await expectSidecarConfigurationAccepted({
    ...currentData.status.configuration,
    user_configuration: {
      ...currentData.status.configuration.user_configuration,
      ...save.mock.calls[0][0],
    },
  });
}

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue();
  currentData = globalThis.structuredClone(data);
  vi.mocked(useSidecarIndexing).mockReturnValue({
    data: currentData,
    isPending: false,
    error: null,
    save,
    saving: false,
    supported: true,
    saveError: null,
  } as unknown as ReturnType<typeof useSidecarIndexing>);
});

describe("mailbox indexing controls", () => {
  it("shows ordered mailboxes with combined progress", () => {
    render(<SidecarIndexingControls />);
    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("personal@example.com");
    expect(entries[0]).toHaveTextContent("46% of 13 documents indexed");
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
  it("writes explicit priorities when moving mailboxes and preserves enablement", async () => {
    render(<SidecarIndexingControls />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase priority for shared@example.com",
      }),
    );
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    expect(save).toHaveBeenCalledWith({
      indexing_parallelism: 2,
      indexing_documents_per_minute: 40,
      indexing_mailboxes: [
        { mailbox_id: sharedUuid, enabled: true, priority: 0 },
        { mailbox_id: personalUuid, enabled: false, priority: 1 },
      ],
    });
    await expectValidSavedConfiguration();
  });
  it("toggles one mailbox without dropping other overrides", async () => {
    render(<SidecarIndexingControls />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable indexing for personal@example.com",
      }),
    );
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    expect(save).toHaveBeenCalledWith({
      indexing_parallelism: 2,
      indexing_documents_per_minute: 40,
      indexing_mailboxes: [
        { mailbox_id: sharedUuid, enabled: true, priority: 10 },
        { mailbox_id: personalUuid, enabled: true, priority: 0 },
      ],
    });
    await expectValidSavedConfiguration();
  });
  it("writes a valid UUID when toggling a mailbox without an override", async () => {
    currentData.status.configuration.user_configuration.indexing_mailboxes = [];
    render(<SidecarIndexingControls />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable indexing for personal@example.com",
      }),
    );
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    expect(save).toHaveBeenCalledWith({
      indexing_parallelism: 2,
      indexing_documents_per_minute: 40,
      indexing_mailboxes: [
        {
          mailbox_id: personalUuid,
          enabled: false,
          priority: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    await expectValidSavedConfiguration();
  });
  it("preserves disconnected overrides and extra fields when moving mailboxes", async () => {
    const disconnected = {
      mailbox_id: "ccddee00-3344-4455-aabb-223344556677",
      enabled: false,
      priority: 7,
      future_setting: true,
    };
    const entries =
      currentData.status.configuration.user_configuration.indexing_mailboxes;
    Object.assign(entries[0], { future_setting: "preserved" });
    entries.push(disconnected);
    render(<SidecarIndexingControls />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase priority for shared@example.com",
      }),
    );
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    expect(save).toHaveBeenCalledWith({
      indexing_parallelism: 2,
      indexing_documents_per_minute: 40,
      indexing_mailboxes: [
        disconnected,
        {
          mailbox_id: sharedUuid,
          enabled: true,
          priority: 0,
          future_setting: "preserved",
        },
        { mailbox_id: personalUuid, enabled: false, priority: 1 },
      ],
    });
    await expectValidSavedConfiguration();
  });
  it("validates and saves global limits", async () => {
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
    await expectValidSavedConfiguration();
  });
});

it("retains drafts across polls and failed saves, then clears them after success", async () => {
  const { rerender } = render(<SidecarIndexingControls />);
  const checkbox = () =>
    screen.getByRole("checkbox", {
      name: "Enable indexing for personal@example.com",
    });
  fireEvent.click(checkbox());
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Indexing parallelism" }),
    { target: { value: "5" } },
  );
  currentData.status.effectiveConfiguration.parallelism = 7;
  rerender(<SidecarIndexingControls />);
  expect(checkbox()).toBeChecked();
  expect(
    screen.getByRole("spinbutton", { name: "Indexing parallelism" }),
  ).toHaveValue(5);
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Disabled");
  expect(save).not.toHaveBeenCalled();
  save.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save indexing settings" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(checkbox()).toBeChecked();
  save.mockImplementationOnce(async () => {
    currentData.status.configuration.user_configuration.indexing_mailboxes[1].enabled =
      true;
    currentData.status.effectiveConfiguration.parallelism = 5;
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save indexing settings" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument(),
  );
  expect(checkbox()).toBeChecked();
  expect(
    screen.getByRole("spinbutton", { name: "Indexing parallelism" }),
  ).toHaveValue(5);
});

it("resets only after confirmation and hides reset on older sidecars", () => {
  const reset = vi.fn();
  vi.mocked(useSidecarIndexing).mockReturnValue({
    ...vi.mocked(useSidecarIndexing)(),
    reset,
    resetSupported: true,
  });
  const { rerender } = render(<SidecarIndexingControls />);
  fireEvent.click(
    screen.getByRole("button", { name: "Reset sidecar indices" }),
  );
  expect(reset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
  expect(reset).toHaveBeenCalledOnce();
  vi.mocked(useSidecarIndexing).mockReturnValue({
    ...vi.mocked(useSidecarIndexing)(),
    resetSupported: false,
  });
  rerender(<SidecarIndexingControls />);
  expect(
    screen.queryByRole("button", { name: "Reset sidecar indices" }),
  ).not.toBeInTheDocument();
});
