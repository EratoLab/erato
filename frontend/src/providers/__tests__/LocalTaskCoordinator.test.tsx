import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DelegatedRunOpenProvider } from "../DelegatedRunOpenProvider";
import { LocalTaskCoordinator } from "../LocalTaskCoordinator";

const fixture = vi.hoisted(() => ({
  profile: { id: "account-a" },
  error: null as null | { status: number },
  enabled: true,
  refreshProfile: vi.fn(),
  instances: [] as {
    accountId: string;
    enabled: boolean;
    reconcile: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("@/hooks/profile/useProfileApi", () => ({
  useProfileApi: () => fixture,
}));
vi.mock("../DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({ client: null }),
}));
vi.mock("@/lib/desktopSidecar/localTaskCoordinator", () => ({
  localTaskApi: {},
  LocalTaskCoordinator: class {
    enabled = true;
    dispose = vi.fn();
    reconcile = vi.fn(async () => {
      this.enabled = fixture.enabled;
      this.changed(
        this.enabled
          ? [
              {
                id: "job",
                chatId: "child",
                messageId: "message",
                state: "continuing",
              },
            ]
          : [],
      );
    });
    constructor(
      readonly accountId: string,
      _native: unknown,
      _api: unknown,
      readonly changed: (
        views: {
          id: string;
          chatId: string;
          messageId: string;
          state: string;
        }[],
      ) => void,
    ) {
      fixture.instances.push(this);
    }
  },
}));

describe("authenticated local task shell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fixture.instances = [];
    fixture.profile = { id: "account-a" };
    fixture.error = null;
    fixture.enabled = true;
  });
  afterEach(() => vi.useRealTimers());

  function mount() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const open = vi.fn();
    const element = () => (
      <QueryClientProvider client={queryClient}>
        <DelegatedRunOpenProvider onOpen={open}>
          <LocalTaskCoordinator />
        </DelegatedRunOpenProvider>
      </QueryClientProvider>
    );
    const result = render(element());
    return { ...result, open, rerenderShell: () => result.rerender(element()) };
  }
  const flush = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

  it("keeps accepted-job recovery active without a sidecar and opens runs inside the host", async () => {
    const view = mount();
    await flush();
    expect(fixture.instances[0].reconcile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Open original task" }));
    expect(view.open).toHaveBeenCalledWith("child");
    expect(
      screen.queryByRole("link", { name: "Open original task" }),
    ).toBeNull();
  });

  it("stops interval polling when the backend disables delegation", async () => {
    fixture.enabled = false;
    mount();
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fixture.instances[0].reconcile).toHaveBeenCalledTimes(1);
  });

  it("keeps the coordinator during transient profile errors and replaces it on an account change", async () => {
    const view = mount();
    await flush();
    const initial = fixture.instances[0];
    fixture.error = { status: 503 };
    view.rerenderShell();
    await flush();
    expect(initial.dispose).not.toHaveBeenCalled();
    expect(fixture.instances).toHaveLength(1);
    fixture.profile = { id: "account-b" };
    fixture.error = null;
    view.rerenderShell();
    await flush();
    expect(initial.dispose).toHaveBeenCalledOnce();
    expect(fixture.instances[1].accountId).toBe("account-b");
  });

  it("disposes in-flight work when authentication is withdrawn", async () => {
    const view = mount();
    await flush();
    fixture.error = { status: 401 };
    view.rerenderShell();
    await flush();
    expect(fixture.instances[0].dispose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
