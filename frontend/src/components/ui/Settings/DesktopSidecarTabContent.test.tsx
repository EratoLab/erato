import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import { DesktopSidecarRow } from "./DesktopSidecarTabContent";

import type { ReactNode } from "react";

vi.mock("./ClientToolFileApprovalSetting", () => ({
  ClientToolFileApprovalSetting: () => (
    <div data-testid="client-tool-file-approval" />
  ),
}));
vi.mock("./SidecarToolDecisions", () => ({
  SidecarToolDecisions: () => <div data-testid="sidecar-tool-decisions" />,
}));
vi.mock("../DesktopSidecar/SidecarIndexingCard", () => ({
  SidecarIndexingControls: () => <div data-testid="sidecar-indexing" />,
}));

const SETTINGS_METHODS = [
  "sidecar.configure.v1",
  "indexing.status.v1",
  "indexing.reset.v1",
  "sources.list.v1",
  "outlook.list_mailboxes.v1",
  "sidecar.status.v1",
  "sidecar.request_permission.v1",
  "sidecar.open_data_directory.v1",
];

const providerMounted = vi.fn();
const sidecar = vi.hoisted(() => ({
  state: "unavailable",
  strict: false,
  supported: ["sidecar.open_data_directory.v1"],
  invoke: vi.fn(),
}));
beforeEach(() => {
  providerMounted.mockClear();
  sidecar.state = "unavailable";
  sidecar.strict = false;
  sidecar.supported = ["sidecar.open_data_directory.v1"];
  sidecar.invoke.mockReset();
  sidecar.invoke.mockImplementation(async (method: string) =>
    method === "sidecar.status.v1"
      ? { permissions: { macos_full_disk_access: "granted" } }
      : { opened: true },
  );
});
vi.mock("@/providers/DesktopSidecarProvider", () => ({
  DEFAULT_DESKTOP_SIDECAR_ENDPOINT: "https://localhost:1234",
  resolveDesktopSidecarEndpoint: () => undefined,
  DesktopSidecarProvider: ({ children }: { children: ReactNode }) => {
    useEffect(() => {
      providerMounted();
    }, []);
    return children;
  },
  DesktopSidecarConfigurationSync: () => null,
  useDesktopSidecar: () => ({
    client:
      sidecar.state === "ready"
        ? {
            supports: (method: string) => sidecar.supported.includes(method),
            invoke: sidecar.invoke,
          }
        : null,
    snapshot: { state: sidecar.state, localDelegation: sidecar.strict },
  }),
}));

it("keeps the details expanded across connection retries and still allows collapsing", () => {
  render(<DesktopSidecarRow />);
  const toggle = () =>
    screen.getByRole("button", { name: /Desktop Sidecar.*this device/ });
  expect(toggle()).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle());
  for (let attempt = 1; attempt <= 2; attempt++) {
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(providerMounted).toHaveBeenCalledTimes(attempt + 1);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Retry connection" }),
    ).toBeVisible();
  }
  fireEvent.click(toggle());
  expect(toggle()).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByRole("button", { name: "Retry connection" }),
  ).not.toBeInTheDocument();
});

it("retains the directory command for a legacy sidecar", () => {
  sidecar.state = "ready";
  render(<DesktopSidecarRow />);
  fireEvent.click(
    screen.getByRole("button", { name: /Desktop Sidecar.*this device/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Connection" }));
  fireEvent.click(screen.getByRole("button", { name: "Open data directory" }));
  expect(sidecar.invoke).toHaveBeenCalledWith(
    "sidecar.open_data_directory.v1",
    {},
  );
});

function openStrictRow(supported: string[]) {
  sidecar.state = "ready";
  sidecar.strict = true;
  sidecar.supported = supported;
  render(<DesktopSidecarRow />);
  fireEvent.click(
    screen.getByRole("button", { name: /Desktop Sidecar.*this device/ }),
  );
}

it("shows the indexing settings of a strict sidecar that allows the settings methods", () => {
  openStrictRow(SETTINGS_METHODS);
  expect(screen.getByTestId("sidecar-indexing")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Evidence sharing requires review in the desktop app for each package.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByTestId("client-tool-file-approval"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("sidecar-tool-decisions"),
  ).not.toBeInTheDocument();
});

it("shows permissions and maintenance of a strict sidecar without the indexing settings", async () => {
  openStrictRow([
    "sidecar.configure.v1",
    "indexing.status.v1",
    "sidecar.status.v1",
  ]);
  expect(screen.queryByTestId("sidecar-indexing")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Maintenance" }));
  expect(
    await screen.findByRole("heading", { name: "System permissions" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Open data directory" }),
  ).not.toBeInTheDocument();
});

it("keeps only the connection actions for a strict sidecar that refuses the settings methods", () => {
  openStrictRow([]);
  expect(screen.queryByTestId("sidecar-indexing")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Connection" }));
  expect(
    screen.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Open data directory" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "System permissions" }),
  ).not.toBeInTheDocument();
  expect(sidecar.invoke).not.toHaveBeenCalled();
});

it("offers the directory command of a strict sidecar that allows it", () => {
  openStrictRow(["sidecar.open_data_directory.v1"]);
  fireEvent.click(screen.getByRole("button", { name: "Connection" }));
  fireEvent.click(screen.getByRole("button", { name: "Open data directory" }));
  expect(sidecar.invoke).toHaveBeenCalledWith(
    "sidecar.open_data_directory.v1",
    {},
  );
});

it.each([
  ["a connected legacy sidecar", "ready", false, true],
  ["strict consent mode", "ready", true, false],
  ["a disconnected sidecar", "unavailable", false, false],
] as const)(
  "lists per-tool decisions only for %s",
  (_, state, strict, shown) => {
    sidecar.state = state;
    sidecar.strict = strict;
    render(<DesktopSidecarRow />);
    fireEvent.click(
      screen.getByRole("button", { name: /Desktop Sidecar.*this device/ }),
    );
    if (shown) {
      expect(screen.getByTestId("sidecar-tool-decisions")).toBeInTheDocument();
    } else {
      expect(
        screen.queryByTestId("sidecar-tool-decisions"),
      ).not.toBeInTheDocument();
    }
  },
);

it("introduces the sidecar and distinguishes permission settings from connection actions", () => {
  sidecar.state = "ready";
  render(<DesktopSidecarRow />);
  const toggle = screen.getByRole("button", {
    name: /Desktop Sidecar.*Connected · this device/,
  });
  fireEvent.click(toggle);
  expect(
    screen.getByText(
      "Connect the assistant to emails, files and Teams messages available on this device.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Tool permissions" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Permission changes are saved automatically/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Retry connection" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Connection" }));
  expect(
    screen.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
});
