import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DesktopSidecarRow } from "./DesktopSidecarTabContent";

import type { ReactNode } from "react";

vi.mock("./ClientToolFileApprovalSetting", () => ({
  ClientToolFileApprovalSetting: () => null,
}));

const providerMounted = vi.fn();
beforeEach(() => providerMounted.mockClear());
afterEach(() => vi.unstubAllGlobals());
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

it("shows blocked access in the collapsed row, explains recovery and retries", async () => {
  const status = Object.assign(new EventTarget(), { state: "denied" });
  vi.stubGlobal("navigator", {
    permissions: { query: vi.fn().mockResolvedValue(status) },
  });
  render(<DesktopSidecarRow />);
  await waitFor(() =>
    expect(screen.getByText(/Local application access blocked/)).toBeVisible(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Desktop Sidecar.*this device/ }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("allow or reset");
  fireEvent.click(
    screen.getByRole("button", { name: "Retry local application access" }),
  );
  expect(providerMounted).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
  act(() => {
    status.state = "granted";
    status.dispatchEvent(new Event("change"));
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
});

it("offers a permission retry for a pending prompt without claiming access is blocked", async () => {
  vi.stubGlobal("navigator", {
    permissions: {
      query: vi
        .fn()
        .mockResolvedValue(
          Object.assign(new EventTarget(), { state: "prompt" }),
        ),
    },
  });
  render(<DesktopSidecarRow />);
  fireEvent.click(
    screen.getByRole("button", { name: /Desktop Sidecar.*this device/ }),
  );
  expect(
    await screen.findByRole("button", {
      name: "Retry local application access",
    }),
  ).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
