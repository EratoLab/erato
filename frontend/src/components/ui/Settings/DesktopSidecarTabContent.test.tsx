import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import { DesktopSidecarRow } from "./DesktopSidecarTabContent";

import type { ReactNode } from "react";

vi.mock("./ClientToolFileApprovalSetting", () => ({
  ClientToolFileApprovalSetting: () => null,
}));

const providerMounted = vi.fn();
const sidecar = vi.hoisted(() => ({
  state: "unavailable",
  strict: false,
  invoke: vi.fn().mockResolvedValue({ opened: true }),
}));
beforeEach(() => {
  providerMounted.mockClear();
  sidecar.state = "unavailable";
  sidecar.strict = false;
  sidecar.invoke.mockClear();
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
            supports: (method: string) =>
              method === "sidecar.open_data_directory.v1",
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
  fireEvent.click(screen.getByRole("button", { name: "Open data directory" }));
  expect(sidecar.invoke).toHaveBeenCalledWith(
    "sidecar.open_data_directory.v1",
    {},
  );
});

it("does not offer the legacy directory command in strict consent mode", () => {
  sidecar.state = "ready";
  sidecar.strict = true;
  render(<DesktopSidecarRow />);
  fireEvent.click(
    screen.getByRole("button", { name: /Desktop Sidecar.*this device/ }),
  );
  expect(
    screen.queryByRole("button", { name: "Open data directory" }),
  ).not.toBeInTheDocument();
  expect(sidecar.invoke).not.toHaveBeenCalled();
});
