import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocalTaskViewsStore } from "@/lib/desktopSidecar/localTaskViewsStore";

import { DelegatedRunOpenProvider } from "../DelegatedRunOpenProvider";
import {
  LocalTaskCoordinator,
  sweepIntervalFor,
} from "../LocalTaskCoordinator";

import type { LocalTaskViewState } from "@/lib/desktopSidecar/localTaskCoordinator";

const fixture = vi.hoisted(() => ({
  profile: { id: "account-a" },
  error: null as null | { status: number },
  enabled: true,
  state: "continuing",
  refreshProfile: vi.fn(),
  instances: [] as {
    accountId: string;
    enabled: boolean;
    reconcile: ReturnType<typeof vi.fn>;
    review: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("@/hooks/profile/useProfileApi", () => ({
  useProfileApi: () => fixture,
}));
vi.mock("../DesktopSidecarProvider", () => ({
  useDesktopSidecar: () => ({ client: null, snapshot: { state: "idle" } }),
}));
vi.mock("@/lib/desktopSidecar/localTaskCoordinator", () => ({
  localTaskApi: {},
  LocalTaskCoordinator: class {
    enabled = true;
    dispose = vi.fn();
    review = vi.fn(async () => {});
    reconcile = vi.fn(async () => {
      this.enabled = fixture.enabled;
      this.changed(
        this.enabled
          ? [
              {
                id: "job",
                chatId: "child",
                messageId: "message",
                state: fixture.state,
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
    fixture.state = "continuing";
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

  it("tells the parent's task card what this device knows of each job", async () => {
    fixture.state = "ready_for_review";
    const view = mount();
    await flush();
    expect(useLocalTaskViewsStore.getState().byChatId).toEqual(
      new Map([["child", "ready_for_review"]]),
    );
    view.unmount();
    expect(useLocalTaskViewsStore.getState().byChatId.size).toBe(0);
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

  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("sweeps fast while the device collects and idles once the job awaits the user", async () => {
    fixture.state = "running";
    mount();
    await flush();
    const { reconcile } = fixture.instances[0];
    expect(reconcile).toHaveBeenCalledTimes(1);
    await advance(3_100);
    expect(reconcile).toHaveBeenCalledTimes(3);
    fixture.state = "ready_for_review";
    await advance(1_500);
    const observed = reconcile.mock.calls.length;
    expect(
      screen.getByRole("button", { name: "Review in desktop app" }),
    ).toBeTruthy();
    await advance(9_000);
    expect(reconcile).toHaveBeenCalledTimes(observed);
  });

  it("sweeps fast after opening the native review until the job moves on", async () => {
    fixture.state = "ready_for_review";
    mount();
    await flush();
    const { reconcile, review } = fixture.instances[0];
    await advance(3_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Review in desktop app" }),
    );
    expect(review).toHaveBeenCalledWith("job");
    await advance(3_100);
    expect(reconcile).toHaveBeenCalledTimes(3);
    fixture.state = "continuing";
    await advance(1_500);
    const observed = reconcile.mock.calls.length;
    await advance(9_000);
    expect(reconcile).toHaveBeenCalledTimes(observed);
  });
});

describe("sweepIntervalFor", () => {
  const view = (state: LocalTaskViewState, id = "job") => ({
    id,
    chatId: "child",
    messageId: "message",
    state,
  });
  const idle = 10_000;
  const active = 1_500;

  it("idles without jobs and for states only the user or the server move", () => {
    expect(sweepIntervalFor([], new Map(), 0)).toBe(idle);
    for (const state of [
      "ready_for_review",
      "awaiting_authenticated_resume",
      "continuing",
      "acknowledged",
      "declined",
      "cancelled",
      "expired",
      "failed",
      "another_device",
      "unavailable",
    ] as const)
      expect(sweepIntervalFor([view(state)], new Map(), 0)).toBe(idle);
  });

  it("polls fast while any job is queued or running on the device", () => {
    expect(sweepIntervalFor([view("queued")], new Map(), 0)).toBe(active);
    expect(
      sweepIntervalFor(
        [view("continuing", "a"), view("running", "b")],
        new Map(),
        0,
      ),
    ).toBe(active);
  });

  it("polls fast for a bounded time after this shell opened a job's review", () => {
    const opened = new Map([["job", 1_000]]);
    const ready = [view("ready_for_review")];
    expect(sweepIntervalFor(ready, opened, 1_000)).toBe(active);
    expect(sweepIntervalFor(ready, opened, 1_000 + 5 * 60_000 - 1)).toBe(
      active,
    );
    expect(sweepIntervalFor(ready, opened, 1_000 + 5 * 60_000)).toBe(idle);
    expect(
      sweepIntervalFor([view("ready_for_review", "other")], opened, 1_000),
    ).toBe(idle);
    expect(sweepIntervalFor([view("declined")], opened, 1_000)).toBe(idle);
  });
});
