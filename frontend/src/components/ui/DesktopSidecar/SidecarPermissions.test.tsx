import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { SidecarPermissions } from "./SidecarPermissions";

const sidecar = vi.hoisted(() => ({
  state: "ready",
  supported: true,
  permissions: {},
  client: { supports: vi.fn(), invoke: vi.fn() },
}));
vi.mock("@/providers/DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({
    client: sidecar.client,
    snapshot: { state: sidecar.state, instanceId: "test-instance" },
  }),
}));
beforeEach(() => {
  sidecar.state = "ready";
  sidecar.supported = true;
  sidecar.permissions = { macos_full_disk_access: "not_granted" };
  sidecar.client.supports.mockImplementation(() => sidecar.supported);
  sidecar.client.invoke.mockReset();
  sidecar.client.invoke.mockImplementation(async (method: string) =>
    method === "sidecar.status.v1"
      ? { permissions: sidecar.permissions }
      : { opened: true },
  );
});
it("offers System Settings and does not mistake opening it for a grant", async () => {
  render(<SidecarPermissions />);
  const button = await screen.findByRole("button", {
    name: "Open System Settings",
  });
  expect(screen.getByText(/Full Disk Access: Not granted/)).toBeVisible();
  expect(screen.getByText(/then restart the sidecar/)).toBeVisible();
  fireEvent.click(button);
  await waitFor(() =>
    expect(sidecar.client.invoke).toHaveBeenCalledWith(
      "sidecar.request_permission.v1",
      { permission: "macos_full_disk_access" },
    ),
  );
  expect(screen.getByText(/Full Disk Access: Not granted/)).toBeVisible();
});
it("filters other platforms and displays unknown future permission keys", async () => {
  sidecar.permissions = {
    macos_full_disk_access: "not_appliccable_different_platform",
    future_permission: "unknown",
  };
  render(<SidecarPermissions />);
  expect(await screen.findByText("future_permission: Unknown")).toBeVisible();
  expect(screen.queryByText(/Full Disk Access/)).not.toBeInTheDocument();
});
it("hides the list when every permission is inapplicable", async () => {
  sidecar.permissions = {
    macos_full_disk_access: "not_appliccable_different_platform",
  };
  const { container } = render(<SidecarPermissions />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
it("refreshes on return from settings and stops polling after unmount", async () => {
  const { unmount } = render(<SidecarPermissions />);
  await screen.findByText(/Full Disk Access: Not granted/);
  sidecar.permissions = { macos_full_disk_access: "granted" };
  fireEvent.focus(window);
  await screen.findByText("Full Disk Access: Granted");
  expect(
    screen.queryByRole("button", { name: "Open System Settings" }),
  ).not.toBeInTheDocument();
  unmount();
  sidecar.client.invoke.mockClear();
  fireEvent.focus(window);
  expect(sidecar.client.invoke).not.toHaveBeenCalled();
});
it("shows load and request failures with recovery", async () => {
  sidecar.client.invoke.mockRejectedValueOnce(new Error("offline"));
  render(<SidecarPermissions />);
  await screen.findByText("Could not check system permissions.");
  fireEvent.click(
    screen.getByRole("button", { name: "Check permissions again" }),
  );
  const button = await screen.findByRole("button", {
    name: "Open System Settings",
  });
  sidecar.client.invoke.mockRejectedValueOnce(new Error("open failed"));
  fireEvent.click(button);
  await screen.findByText(/Could not open the permission settings/);
});
it.each(["unavailable", "old sidecar"])(
  "does not call unsupported sidecars: %s",
  (state) => {
    if (state === "old sidecar") sidecar.supported = false;
    else sidecar.state = state;
    const { container } = render(<SidecarPermissions />);
    expect(container).toBeEmptyDOMElement();
    expect(sidecar.client.invoke).not.toHaveBeenCalled();
  },
);
