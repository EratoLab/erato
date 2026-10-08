import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSidecarIndexing } from "@/hooks/useSidecarIndexing";
import { expectSidecarConfigurationAccepted } from "@/lib/desktopSidecar/__tests__/configurationTestUtils";
import {
  indexedRangeFixture,
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
const counts = /\d+ of \d+|%|\d+ documents?\b/;

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T12:05:00Z"));
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

afterEach(() => {
  vi.useRealTimers();
});

describe("mailbox indexing controls", () => {
  it("shows ordered mailboxes without document counts", () => {
    renderControls();
    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("personal@example.com");
    for (const entry of entries) expect(entry).not.toHaveTextContent(counts);
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
    expect(row).not.toHaveTextContent(counts);
    return within(row);
  }
  function withRange(
    range: Partial<ReturnType<typeof indexedRangeFixture>>,
    status = indexingStatusFixture(),
  ) {
    status.discovery[0].indexedRange = { ...indexedRangeFixture(), ...range };
    return status;
  }

  it("shows the period up to today, when it was checked, and missing-cache content without counts", () => {
    const row = renderStatus();
    expect(row.getByText("Up-to-date")).toBeInTheDocument();
    expect(row.getByText("Indexed Mar 14, 2025 to today")).toBeInTheDocument();
    expect(row.getByText("Checked 5 min. ago")).toBeInTheDocument();
    expect(
      row.getByText("Some items aren't stored on this device"),
    ).toBeInTheDocument();
    expect(
      row.queryByText("Some items couldn't be read"),
    ).not.toBeInTheDocument();
    expect(row.queryByText(/still being indexed/)).not.toBeInTheDocument();
    expect(row.queryByText(/Teams keeps only/)).not.toBeInTheDocument();
    expect(row.queryByText("Status unavailable")).not.toBeInTheDocument();
  });

  it("ends the period on the day the store was last checked", () => {
    vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
    const row = renderStatus();
    expect(
      row.getByText("Indexed Mar 14, 2025 to Sep 15, 2026"),
    ).toBeInTheDocument();
    expect(row.getByText("Checked 5 days ago")).toBeInTheDocument();
  });

  it("starts the period on the next day after an exclusive start", () => {
    const row = renderStatus(
      withRange({
        from: { at: "2025-03-14T12:00:00Z", inclusive: false },
        olderPending: 5,
      }),
    );
    expect(row.getByText("Indexed Mar 15, 2025 to today")).toBeInTheDocument();
  });

  it("explains cache-only inventories without Teams wording outside Teams", () => {
    const row = renderStatus(withRange({ inventory: "futureInventory" }));
    expect(
      row.getByText("Only items cached on this device can be indexed"),
    ).toBeInTheDocument();
    expect(row.queryByText(/Teams keeps only/)).not.toBeInTheDocument();
  });

  it("shows newer and older items that are still being indexed", () => {
    const row = renderStatus(
      withRange({
        through: { at: "2026-09-10T12:00:00Z", inclusive: true },
        pendingNewer: 3,
        olderPending: 100,
      }),
    );
    expect(
      row.getByText(
        "Indexed Mar 14, 2025 to Sep 10, 2026 · newest items still being indexed",
      ),
    ).toBeInTheDocument();
    expect(
      row.getByText("Older items are still being indexed"),
    ).toBeInTheDocument();
  });

  it.each([
    ["not_enumerated", "Not scanned yet"],
    ["no_searchable_documents", "Nothing searchable yet"],
    ["index_not_initialized", "Nothing searchable yet"],
  ])("explains a missing range for %s", (unavailableReason, text) => {
    const status = withRange({
      from: null,
      observedAt: null,
      unavailableReason,
    });
    if (unavailableReason === "not_enumerated") {
      status.discovery[0].state = "failed";
      status.discovery[0].discoveryComplete = false;
    }
    const row = renderStatus(status);
    expect(row.getByText(text)).toBeInTheDocument();
    expect(row.queryByText(/^Indexed /)).not.toBeInTheDocument();
    expect(row.queryByText(/^Checked /)).not.toBeInTheDocument();
  });

  it("leaves a disabled source to its status pill", () => {
    const status = withRange({
      from: null,
      unavailableReason: "source_disabled",
    });
    status.discovery[0].state = "disabled";
    const row = renderStatus(status);
    expect(row.getByText("Disabled")).toBeInTheDocument();
    expect(
      row.queryByText(/^Indexed |Not scanned yet|Nothing searchable yet/),
    ).not.toBeInTheDocument();
  });

  it("shows a source that was never scanned once", () => {
    const status = withRange({
      from: null,
      observedAt: null,
      unavailableReason: "not_enumerated",
    });
    status.discovery[0].state = "notStarted";
    status.discovery[0].discoveryComplete = false;
    const row = renderStatus(status);
    expect(row.getAllByText("Not scanned yet")).toHaveLength(1);
  });

  it("notes unreadable items without a count", () => {
    const status = indexingStatusFixture();
    Object.assign(status.generations[0].segments[0].coverage, {
      indexedCurrent: 553,
      missingFromLocalCacheCurrent: 0,
      unindexableCurrent: 1,
    });
    const row = renderStatus(status);
    expect(row.getByText("Up-to-date")).toBeInTheDocument();
    expect(row.getByText("Some items couldn't be read")).toBeInTheDocument();
    expect(
      row.queryByText("Some items aren't stored on this device"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the oldest indexed date for sidecars without a range, once settled", () => {
    const status = indexingStatusFixture();
    delete status.discovery[0].indexedRange;
    status.generations[0].segments[0].depth.oldestIndexedDocumentAt =
      "2020-01-01T12:00:00Z";
    const row = renderStatus(status);
    expect(row.getByText("Indexed Jan 1, 2020 to today")).toBeInTheDocument();
    expect(row.getByText("Checked 5 min. ago")).toBeInTheDocument();
    expect(row.queryByText(/Teams keeps only/)).not.toBeInTheDocument();
  });

  it("shows only the status pill for older sidecars until indexing settles", () => {
    const status = indexingStatusFixture();
    delete status.discovery[0].indexedRange;
    status.generations[0].segments[0].backlog.remaining = 1;
    const row = renderStatus(status);
    expect(row.getByText("Waiting")).toBeInTheDocument();
    expect(row.queryByText(/^Indexed /)).not.toBeInTheDocument();
  });

  it("keeps a real scan failure visible alongside the known range", () => {
    const status = indexingStatusFixture();
    status.discovery[0].state = "failed";
    status.discovery[0].discoveryComplete = false;
    status.discovery[0].lastErrorCode = "source_scan_incomplete";
    const row = renderStatus(status);
    expect(row.getByText("Scan failed")).toBeInTheDocument();
    expect(row.getByText("Indexed Mar 14, 2025 to today")).toBeInTheDocument();
  });

  it("does not present explicitly unavailable counters as complete", () => {
    const status = indexingStatusFixture();
    status.generations[0].segments[0].coverage.knownEligible = null;
    const row = renderStatus(status);
    expect(row.getByText("Status unavailable")).toBeInTheDocument();
    expect(row.queryByText("Up-to-date")).not.toBeInTheDocument();
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
    expect(rows[0]).not.toHaveTextContent(/Indexed |Teams keeps only/);
    expect(rows[1]).toHaveTextContent("Microsoft Teams local cache (1)");
    expect(rows[1]).toHaveTextContent("Scan failed");
    expect(rows[1]).toHaveTextContent("Indexed Jun 1, 2026 to today");
    expect(rows[2]).toHaveTextContent("Microsoft Teams local cache (2)");
    expect(rows[2]).toHaveTextContent("Up-to-date");
    expect(rows[2]).toHaveTextContent("Indexed Jun 2, 2026 to today");
    for (const row of rows.slice(1)) {
      expect(row).toHaveTextContent(
        "Teams keeps only recently opened chats on this device",
      );
      expect(row).not.toHaveTextContent(counts);
    }
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

  it("names the work account the sidecar matched, or says that none matched", () => {
    const { status, rerender } = renderSources();
    const current = vi.mocked(useSidecarIndexing)();
    const render = (reasons: string[]) => {
      status.configuration!.signed_in_user = {
        user_id: "user-home",
        email: "daniel@home.example",
      };
      vi.mocked(useSidecarIndexing).mockReturnValue({
        ...current,
        data: {
          ...current.data!,
          status,
          sources: [
            sourceFixture(sourceId, false),
            ...teamsSourceIds.map((id) => sourceFixture(id)),
          ].map((source, index) => ({
            ...source,
            defaultReason: reasons[index],
          })),
        },
      } as ReturnType<typeof useSidecarIndexing>);
      rerender(<SidecarIndexingControls />);
    };

    render(["workAccount", "workAccount", "guestAccount"]);
    expect(
      screen.getByText(/^Work account: daniel@home.example\./),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Work account");
    expect(rows[1]).toHaveTextContent("Work account");
    expect(rows[2]).not.toHaveTextContent("Work account");

    render(["notOutlookDefault", "otherAccount", "guestAccount"]);
    expect(
      screen.getByText(
        /No account on this computer matches your work account daniel@home.example/,
      ),
    ).toBeInTheDocument();
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
      { source_id: teamsSourceIds[1], enabled: true, priority: 0 },
      { source_id: teamsSourceIds[0], enabled: true, priority: 1 },
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
    expect(row.getByText("Indexed Jun 1, 2026 to today")).toBeInTheDocument();
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
      screen.getByText(/Each source shows the period local search covers/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Totals reflect/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Increase priority for/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Details for personal@example.com" }),
    );
    expect(screen.getAllByRole("listitem")[0]).not.toHaveTextContent(counts);
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
