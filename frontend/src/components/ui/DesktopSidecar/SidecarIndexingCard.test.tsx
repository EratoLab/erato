import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidecarIndexing } from "@/hooks/useSidecarIndexing";
import { expectSidecarConfigurationAccepted } from "@/lib/desktopSidecar/__tests__/configurationTestUtils";
import {
  indexingStatusFixture,
  multiSourceStatusFixture,
  sourceFixture,
  sourceId,
  teamsSourceIds,
} from "@/lib/desktopSidecar/__tests__/indexingStatusFixture";

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

function renderControls() {
  const view = render(<SidecarIndexingControls />);
  fireEvent.click(screen.getByRole("button", { name: /^Sources/ }));
  for (const button of screen.getAllByRole("button", { name: /^Details for / }))
    fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: "Indexing speed" }));
  const maintenance = screen.queryByRole("button", { name: "Maintenance" });
  if (maintenance) fireEvent.click(maintenance);
  return view;
}

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
    renderControls();
    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("personal@example.com");
    expect(entries[0]).toHaveTextContent("6 of 13 documents indexed (46%)");
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
    renderControls();
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
    renderControls();
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
    renderControls();
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
    renderControls();
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
    renderControls();
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
  const { rerender } = renderControls();
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
  const { rerender } = renderControls();
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

describe("mailbox status rendering", () => {
  function renderStatus(status = indexingStatusFixture()) {
    vi.mocked(useSidecarIndexing).mockReturnValue({
      data: {
        ...currentData,
        status: { ...status, configuration: currentData.status.configuration },
      },
      isPending: false,
      error: null,
      save,
      saving: false,
      supported: true,
      saveError: null,
    } as unknown as ReturnType<typeof useSidecarIndexing>);
    renderControls();
    const row = screen
      .getAllByRole("listitem")
      .find((entry) => entry.textContent?.includes("shared@example.com"));
    if (!row) throw new Error("Shared mailbox row missing");
    return within(row);
  }

  it("shows sparse Mac coverage and missing-cache content without a scan error", () => {
    const row = renderStatus();
    expect(row.getByText("Partially indexed")).toBeInTheDocument();
    expect(
      row.getByText("552 of 554 documents indexed (99%)"),
    ).toBeInTheDocument();
    expect(
      row.getByText("2 documents are unavailable in the local cache."),
    ).toBeInTheDocument();
    expect(row.getByText(/Last successful scan/)).toBeInTheDocument();
    expect(row.queryByText("Status unavailable")).not.toBeInTheDocument();
    expect(
      row.queryByText("Indexing progress unavailable"),
    ).not.toBeInTheDocument();
    expect(row.queryByText("Scan failed")).not.toBeInTheDocument();
    expect(
      row.queryByText(/empty or could not be indexed/),
    ).not.toBeInTheDocument();
  });

  it("uses singular wording for one locally unavailable document", () => {
    const status = indexingStatusFixture();
    Object.assign(status.generations[0].segments[0].coverage, {
      indexedCurrent: 553,
      missingFromLocalCacheCurrent: 1,
    });
    expect(
      renderStatus(status).getByText(
        "1 document is unavailable in the local cache.",
      ),
    ).toBeInTheDocument();
  });

  it("shows completion for email-only mailboxes when every message is indexed", () => {
    const status = indexingStatusFixture();
    Object.assign(status.generations[0].segments[0].coverage, {
      indexedCurrent: 554,
      missingFromLocalCacheCurrent: 0,
    });
    const row = renderStatus(status);
    expect(row.getByText("Up-to-date")).toBeInTheDocument();
    expect(
      row.getByText("554 of 554 documents indexed (100%)"),
    ).toBeInTheDocument();
    expect(row.queryByText(/local cache/)).not.toBeInTheDocument();
  });

  it("shows an empty completed scan without an unavailable-status warning", () => {
    const status = indexingStatusFixture();
    status.generations[0].segments = status.generations[0].segments.filter(
      (row) => row.mailboxId === null,
    );
    status.discovery[0].discoveredDocuments = 0;
    const row = renderStatus(status);
    expect(row.getByText("Up-to-date")).toBeInTheDocument();
    expect(row.getByText("No documents discovered yet")).toBeInTheDocument();
  });

  it("keeps a real scan failure visible alongside known coverage", () => {
    const status = indexingStatusFixture();
    status.discovery[0].state = "failed";
    status.discovery[0].discoveryComplete = false;
    status.discovery[0].lastErrorCode = "source_scan_incomplete";
    const row = renderStatus(status);
    expect(row.getByText("Scan failed")).toBeInTheDocument();
    expect(
      row.getByText("552 of 554 documents indexed (99%)"),
    ).toBeInTheDocument();
  });

  it("does not present explicitly unavailable counters as zero or complete", () => {
    const status = indexingStatusFixture();
    status.generations[0].segments[0].coverage.knownEligible = null;
    const row = renderStatus(status);
    expect(row.getByText("Status unavailable")).toBeInTheDocument();
    expect(row.getByText("Indexing progress unavailable")).toBeInTheDocument();
    expect(
      row.queryByText("No documents discovered yet"),
    ).not.toBeInTheDocument();
  });
});

describe("Teams and Outlook source controls", () => {
  function renderSources() {
    const status = multiSourceStatusFixture();
    status.configuration!.user_configuration.indexing_sources = [
      { source_id: sourceId, enabled: false, priority: 0 },
    ];
    vi.mocked(useSidecarIndexing).mockReturnValue({
      ...vi.mocked(useSidecarIndexing)(),
      data: {
        status,
        mailboxes: [data.mailboxes[0]],
        sources: [
          sourceFixture(sourceId, false),
          ...teamsSourceIds.map((id) => sourceFixture(id)),
        ],
      },
    } as ReturnType<typeof useSidecarIndexing>);
    const view = renderControls();
    return { status, ...view };
  }

  it("shows separate status for equally named Teams caches alongside Outlook", () => {
    const { status, rerender } = renderSources();
    status.discovery[1].state = "failed";
    status.discovery[1].discoveryComplete = false;
    rerender(<SidecarIndexingControls />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("shared@example.com");
    expect(rows[0]).toHaveTextContent("Disabled");
    expect(rows[1]).toHaveTextContent("Microsoft Teams local cache (1)");
    expect(rows[1]).toHaveTextContent("Scan failed");
    expect(rows[1]).toHaveTextContent("10 of 10 documents indexed (100%)");
    expect(rows[2]).toHaveTextContent("Microsoft Teams local cache (2)");
    expect(rows[2]).toHaveTextContent("Up-to-date");
    expect(rows[2]).toHaveTextContent("11 of 11 documents indexed (100%)");
    expect(
      screen.getByText(/Accounts sharing a cache are combined/),
    ).toBeInTheDocument();
  });

  it("shows Teams accounts by organisation with their login and guest status", async () => {
    const { rerender } = renderSources();
    const account = {
      tenantId: "tenant-home",
      userId: "user-home",
      email: "daniel@home.example",
      tenantName: "Home Org",
      userType: "Member",
    };
    const current = vi.mocked(useSidecarIndexing)();
    vi.mocked(useSidecarIndexing).mockReturnValue({
      ...current,
      data: {
        ...current.data!,
        sources: [
          sourceFixture(sourceId, false),
          { ...sourceFixture(teamsSourceIds[0]), account },
          {
            ...sourceFixture(teamsSourceIds[1]),
            account: {
              ...account,
              tenantId: "tenant-guest",
              userId: "user-guest",
              tenantName: "Customer Org",
              userType: "Guest",
            },
          },
        ],
      },
    } as ReturnType<typeof useSidecarIndexing>);
    rerender(<SidecarIndexingControls />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[1]).toHaveTextContent("Home Org");
    expect(rows[1]).toHaveTextContent("daniel@home.example");
    expect(rows[1]).not.toHaveTextContent("Guest");
    expect(rows[2]).toHaveTextContent("Customer Org");
    expect(rows[2]).toHaveTextContent("daniel@home.example");
    expect(rows[2]).toHaveTextContent("Guest");
    expect(
      screen.queryByText(/Accounts sharing a cache are combined/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Each Teams entry is one organization/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable indexing for Customer Org",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].indexing_sources).toEqual([
      { source_id: sourceId, enabled: false, priority: 0 },
      {
        source_id: teamsSourceIds[1],
        enabled: false,
        priority: Number.MAX_SAFE_INTEGER,
      },
    ]);
  });

  it("toggles only the selected Teams cache and preserves disabled Outlook after polling and save", async () => {
    const { status, rerender } = renderSources();
    const checkbox = () =>
      screen.getByRole("checkbox", {
        name: "Enable indexing for Microsoft Teams local cache (2)",
      });
    fireEvent.click(checkbox());
    rerender(<SidecarIndexingControls />);
    expect(checkbox()).not.toBeChecked();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({
      indexing_sources: [
        { source_id: sourceId, enabled: false, priority: 0 },
        {
          source_id: teamsSourceIds[1],
          enabled: false,
          priority: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    expect(save.mock.calls[0][0].indexing_mailboxes).toBeUndefined();
    await expectSidecarConfigurationAccepted({
      ...status.configuration!,
      user_configuration: {
        ...status.configuration!.user_configuration,
        ...save.mock.calls[0][0],
      },
    });
  });

  it("keeps sources grouped by application and reorders only within one", async () => {
    renderSources();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("shared@example.com");
    expect(rows[1]).toHaveTextContent("Microsoft Teams local cache (1)");
    expect(
      screen.getByRole("button", {
        name: "Increase priority for Microsoft Teams local cache (1)",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Decrease priority for shared@example.com",
      }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase priority for Microsoft Teams local cache (2)",
      }),
    );
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent(
      "Microsoft Teams local cache (2)",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].indexing_sources).toEqual([
      { source_id: sourceId, enabled: false, priority: 0 },
      { source_id: teamsSourceIds[1], enabled: true, priority: 1 },
      { source_id: teamsSourceIds[0], enabled: true, priority: 2 },
    ]);
  });

  it("shows Teams status without offering ineffective controls on older sidecars", () => {
    const { status, rerender } = renderSources();
    delete status.configuration!.user_configuration.indexing_sources;
    rerender(<SidecarIndexingControls />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Enable indexing for Microsoft Teams local cache (1)",
    });
    expect(checkbox).toBeDisabled();
    const row = within(checkbox.closest("li")!);
    expect(
      row.getByText("10 of 10 documents indexed (100%)"),
    ).toBeInTheDocument();
    expect(
      row.getByText(
        "Update the desktop sidecar to change indexing for this source.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Enable indexing for shared@example.com",
      }),
    ).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("indexing information and actions", () => {
  it("starts with compact source and speed summaries, without hidden tab stops", () => {
    render(<SidecarIndexingControls />);
    expect(screen.getByRole("button", { name: "Sources 2" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("1 enabled")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save indexing settings" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sources 2" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(
      screen.queryByText("Indexing progress unavailable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Increase priority for/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Details for personal@example.com" }),
    );
    expect(
      screen.getByText("6 of 13 documents indexed (46%)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Increase priority for personal@example.com",
      }),
    ).toBeDisabled();
  });

  it("keeps source selection separate from disclosure and retains drafts while sections are closed", async () => {
    render(<SidecarIndexingControls />);
    const sources = () => screen.getByRole("button", { name: "Sources 2" });
    fireEvent.click(sources());
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable indexing for personal@example.com",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Details for personal@example.com" }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(sources());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const speed = () => screen.getByRole("button", { name: "Indexing speed" });
    fireEvent.click(speed());
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Documents per minute" }),
      { target: { value: "80" } },
    );
    fireEvent.click(speed());
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save indexing settings" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toMatchObject({
      indexing_documents_per_minute: 80,
      indexing_mailboxes: expect.arrayContaining([
        { mailbox_id: personalUuid, enabled: true, priority: 0 },
      ]),
    });
  });

  it("keeps connection recovery reachable when statistics fail to load", () => {
    vi.mocked(useSidecarIndexing).mockReturnValue({
      ...vi.mocked(useSidecarIndexing)(),
      data: undefined,
      error: new Error("offline"),
      resetSupported: true,
    } as ReturnType<typeof useSidecarIndexing>);
    render(
      <SidecarIndexingControls
        connectionActions={<button>Retry connection</button>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load indexing statistics",
    );
    fireEvent.click(screen.getByRole("button", { name: "Maintenance" }));
    expect(
      screen.getByRole("button", { name: "Retry connection" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Reset sidecar indices" }),
    ).not.toBeInTheDocument();
  });
});
