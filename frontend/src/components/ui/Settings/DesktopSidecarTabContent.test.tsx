import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { expect, it, vi } from "vitest";

import { DesktopSidecarRow } from "./DesktopSidecarTabContent";

import type { ReactNode } from "react";

vi.mock("./ClientToolFileApprovalSetting", () => ({
  ClientToolFileApprovalSetting: () => null,
}));

const providerMounted = vi.fn();
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
    client: null,
    snapshot: { state: "unavailable" },
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
