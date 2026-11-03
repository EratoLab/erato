import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientOperationPoller } from "../ClientOperationPoller";

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
vi.mock("@/lib/clientOperations/coordinator", () => ({
  clientOperationApi: {},
  ClientOperationCoordinator: class {
    enabled = true;
    dispose = vi.fn();
    reconcile = vi.fn(async () => {
      this.enabled = fixture.enabled;
    });
    constructor(readonly accountId: string) {
      fixture.instances.push(this);
    }
  },
}));

describe("ClientOperationPoller", () => {
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
    const element = () => (
      <QueryClientProvider client={queryClient}>
        <ClientOperationPoller />
      </QueryClientProvider>
    );
    const result = render(element());
    return { ...result, rerenderShell: () => result.rerender(element()) };
  }
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("sweeps the account's operations on a steady cadence and renders nothing", async () => {
    const view = mount();
    await advance(100);
    const { reconcile } = fixture.instances[0];
    expect(reconcile).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("stops interval polling when the backend disables client operations", async () => {
    fixture.enabled = false;
    mount();
    await advance(100);
    await advance(30_000);
    expect(fixture.instances[0].reconcile).toHaveBeenCalledTimes(1);
  });

  it("keeps the coordinator during transient profile errors and replaces it on an account change", async () => {
    const view = mount();
    await advance(100);
    const initial = fixture.instances[0];
    fixture.error = { status: 503 };
    view.rerenderShell();
    await advance(100);
    expect(initial.dispose).not.toHaveBeenCalled();
    expect(fixture.instances).toHaveLength(1);
    fixture.profile = { id: "account-b" };
    fixture.error = null;
    view.rerenderShell();
    await advance(100);
    expect(initial.dispose).toHaveBeenCalledOnce();
    expect(fixture.instances[1].accountId).toBe("account-b");
  });

  it("disposes in-flight work when authentication is withdrawn", async () => {
    const view = mount();
    await advance(100);
    fixture.error = { status: 401 };
    view.rerenderShell();
    await advance(100);
    expect(fixture.instances[0].dispose).toHaveBeenCalledOnce();
  });
});
