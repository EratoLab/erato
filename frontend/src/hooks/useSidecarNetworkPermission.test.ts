import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useSidecarNetworkPermission } from "./useSidecarNetworkPermission";

const endpoint = "http://127.0.0.1:23123/erato/sidecar/rpc";

afterEach(() => vi.unstubAllGlobals());

function mockPermission(state: PermissionState) {
  const status = Object.assign(new EventTarget(), { state });
  const query = vi.fn().mockResolvedValue(status);
  vi.stubGlobal("navigator", { permissions: { query } });
  return { status, query };
}

it("observes denial and subsequent grants and removes its listener", async () => {
  const { status, query } = mockPermission("denied");
  const remove = vi.spyOn(status, "removeEventListener");
  const { result, unmount } = renderHook(() =>
    useSidecarNetworkPermission(endpoint),
  );
  await waitFor(() => expect(result.current).toBe("denied"));
  expect(query).toHaveBeenCalledExactlyOnceWith({ name: "loopback-network" });
  act(() => {
    status.state = "granted";
    status.dispatchEvent(new Event("change"));
  });
  expect(result.current).toBe("granted");
  unmount();
  expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
});

it("falls back to the legacy permission when the split permission is unsupported", async () => {
  const { query } = mockPermission("denied");
  query.mockRejectedValueOnce(new TypeError("Unsupported permission"));
  const { result } = renderHook(() => useSidecarNetworkPermission(endpoint));
  await waitFor(() => expect(result.current).toBe("denied"));
  expect(query).toHaveBeenLastCalledWith({ name: "local-network-access" });
});

it.each([
  "http://localhost:1234",
  "http://app.localhost:1234",
  "http://[::1]:1234",
])("queries loopback access for %s", async (url) => {
  const { query } = mockPermission("prompt");
  const { result } = renderHook(() => useSidecarNetworkPermission(url));
  await waitFor(() => expect(result.current).toBe("prompt"));
  expect(query).toHaveBeenCalledWith({ name: "loopback-network" });
});

it("queries LAN access for a configured network endpoint", async () => {
  const { query } = mockPermission("granted");
  const { result } = renderHook(() =>
    useSidecarNetworkPermission("http://192.168.1.2:1234"),
  );
  await waitFor(() => expect(result.current).toBe("granted"));
  expect(query).toHaveBeenCalledExactlyOnceWith({ name: "local-network" });
});

it("leaves unsupported permission queries unknown", async () => {
  const { query } = mockPermission("denied");
  query.mockRejectedValue(new TypeError("Unsupported permission"));
  const { result } = renderHook(() => useSidecarNetworkPermission(endpoint));
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  expect(result.current).toBeNull();
});

it("tolerates browsers without the Permissions API", () => {
  vi.stubGlobal("navigator", {});
  const { result } = renderHook(() => useSidecarNetworkPermission(endpoint));
  expect(result.current).toBeNull();
});

it("does not attach listeners if unmounted while querying", async () => {
  let resolve!: (status: EventTarget & { state: string }) => void;
  const query = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("navigator", { permissions: { query } });
  const status = Object.assign(new EventTarget(), {
    state: "denied",
  });
  const add = vi.spyOn(status, "addEventListener");
  const { unmount } = renderHook(() => useSidecarNetworkPermission(endpoint));
  unmount();
  await act(async () => resolve(status));
  expect(add).not.toHaveBeenCalled();
});
