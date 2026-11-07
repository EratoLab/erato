import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { SidecarUiPackageStatus } from "./SidecarUiPackageStatus";

const DIGEST =
  "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab";
const sidecar = vi.hoisted(() => ({
  hostsUi: true,
  supported: true,
  status: {},
  client: { supports: vi.fn(), invoke: vi.fn() },
}));
vi.mock("@/providers/DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({
    client: sidecar.client,
    snapshot: {
      state: "ready",
      instanceId: "test-instance",
      ui: sidecar.hostsUi
        ? { host_apis: [1], seed: null, installed: null }
        : undefined,
    },
  }),
}));
beforeEach(() => {
  sidecar.hostsUi = true;
  sidecar.supported = true;
  sidecar.client.supports.mockImplementation(() => sidecar.supported);
  sidecar.client.invoke.mockReset();
  sidecar.client.invoke.mockImplementation(async () => ({
    permissions: {},
    ...sidecar.status,
  }));
});

function renderStatus(uiPackage?: Record<string, unknown> | null) {
  sidecar.status = uiPackage === undefined ? {} : { ui_package: uiPackage };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SidecarUiPackageStatus />
    </QueryClientProvider>,
  );
}

const report = {
  digest: DIGEST,
  attempted_at: "2026-11-07T10:15:00Z",
  relay: false,
};

it.each([
  [{ ...report, state: "current" }, "Desktop app interface: up to date"],
  [{ ...report, state: "pending" }, "Desktop app interface: updating…"],
  [{ ...report, state: "receiving" }, "Desktop app interface: updating…"],
  [
    { ...report, state: "failed", reason: "proxy", relay: true },
    "Desktop app interface: update failed (the proxy refused the connection)",
  ],
  [
    { ...report, state: "failed", reason: "not_found" },
    "Desktop app interface: update failed (no package on the server)",
  ],
  [
    { ...report, state: "failed", reason: "captive_portal" },
    "Desktop app interface: update failed (unexpected error)",
  ],
])("shows %j as %s", async (uiPackage, text) => {
  renderStatus(uiPackage);
  expect(await screen.findByText(text)).toBeVisible();
});

it.each([
  ["a sidecar from before package 0.1.47", undefined],
  ["no offer yet", null],
])("shows nothing for %s", async (_name, uiPackage) => {
  const { container } = renderStatus(uiPackage);
  await waitFor(() => expect(sidecar.client.invoke).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it.each(["no desktop UI", "no status method"])(
  "does not ask a sidecar with %s",
  (missing) => {
    if (missing === "no desktop UI") sidecar.hostsUi = false;
    else sidecar.supported = false;
    const { container } = renderStatus({ ...report, state: "current" });
    expect(container).toBeEmptyDOMElement();
    expect(sidecar.client.invoke).not.toHaveBeenCalled();
  },
);
