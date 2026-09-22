import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useSidecarIndexing } from "./useSidecarIndexing";

import type { ReactNode } from "react";

const invoke = vi.fn();
vi.mock("@/providers/DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({
    client: { supports: () => true, invoke },
    snapshot: { state: "ready", instanceId: "test-sidecar" },
  }),
}));
const configuration = {
  user_configuration: { show_tray_icon: false, future_setting: "preserved" },
  organization_configuration: { indexing_parallelism: 2 },
};
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (method: string) => {
    if (method === "outlook.list_mailboxes.v1") return { mailboxes: [] };
    if (method === "indexing.status.v1") return { configuration };
    return {};
  });
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(() => useSidecarIndexing(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
it("saves one combined configuration update while preserving both layers", async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const patch = {
    indexing_parallelism: 3,
    indexing_documents_per_minute: 80,
    indexing_mailboxes: [
      {
        mailbox_id: "aabbccdd-1122-4455-8899-001122334455",
        enabled: false,
        priority: 0,
      },
    ],
  };
  await act(async () => {
    await result.current.save(patch);
  });
  expect(
    invoke.mock.calls.filter(([method]) => method === "sidecar.configure.v1"),
  ).toEqual([
    [
      "sidecar.configure.v1",
      {
        ...configuration,
        user_configuration: { ...configuration.user_configuration, ...patch },
      },
    ],
  ]);
});
it("propagates a save failure so the caller can retain its draft", async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  invoke.mockImplementation(async (method: string) => {
    if (method === "indexing.status.v1") return { configuration };
    throw new Error("offline");
  });
  await act(async () => {
    await expect(
      result.current.save({ indexing_parallelism: 3 }),
    ).rejects.toThrow("offline");
  });
  await waitFor(() =>
    expect(result.current.saveError?.message).toBe("offline"),
  );
});
it("invokes a full reset and refreshes status without configuring or resuming", async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  invoke.mockClear();
  act(() => result.current.reset());
  await waitFor(() => expect(result.current.resetSucceeded).toBe(true));
  expect(invoke).toHaveBeenCalledWith("indexing.reset.v1", {});
  expect(
    invoke.mock.calls.some(([method]) => method === "indexing.status.v1"),
  ).toBe(true);
  expect(
    invoke.mock.calls.some(
      ([method]) =>
        method === "sidecar.configure.v1" || method === "indexing.start.v1",
    ),
  ).toBe(false);
});
