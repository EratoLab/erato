import { createHash } from "node:crypto";

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOutlookClientTools } from "../useOutlookClientTools";

import type {
  NormalizedCalendar,
  OutlookCalendarFetcher,
} from "../../utils/fetchOutlookCalendar";
import type {
  ClientToolExecutor,
  ExecutorBinding,
} from "@erato/frontend/library";

// The library barrel is mocked wholesale, so the handler class only records
// what the hook hands it; its result mapping is covered by the frontend tests.
const mocks = vi.hoisted(() => {
  class RecordingHandler {
    readonly args: unknown[];
    constructor(...args: unknown[]) {
      this.args = args;
    }
  }
  const unregister = {
    executor: vi.fn(),
    operation: vi.fn(),
    handler: vi.fn(),
  };
  return {
    RecordingHandler,
    unregister,
    registerClientToolExecutor: vi.fn(() => unregister.executor),
    registerOperationExecutor: vi.fn(() => unregister.operation),
    registerClientOperationHandler: vi.fn(() => unregister.handler),
    requestClientOperationSweep: vi.fn(),
    clientOperationDeviceId: vi.fn<() => string | undefined>(
      () => "pane-device-000000000000",
    ),
    mailboxUser: null as { emailAddress: string } | null,
    fetcher: null as OutlookCalendarFetcher | null,
  };
});

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    ClientToolOperationHandler: mocks.RecordingHandler,
    clientOperationDeviceId: mocks.clientOperationDeviceId,
    registerClientOperationHandler: mocks.registerClientOperationHandler,
    registerClientToolExecutor: mocks.registerClientToolExecutor,
    registerOperationExecutor: mocks.registerOperationExecutor,
    requestClientOperationSweep: mocks.requestClientOperationSweep,
  });
});
vi.mock("../../../providers/OfficeProvider", () => ({
  useOffice: () => ({ mailboxUser: mocks.mailboxUser }),
}));
vi.mock("../useOutlookCalendarFetcher", () => ({
  useOutlookCalendarFetcher: () => ({
    fetcher: mocks.fetcher,
    unavailableReason: null,
  }),
}));

const calendar: NormalizedCalendar = {
  workingHours: null,
  busyBlocks: [],
  historyMeetings: [],
  attendees: [],
  displayTimeZone: "Europe/Berlin",
  degradedLegs: [],
};

function registered() {
  const [name, execute] = mocks.registerClientToolExecutor.mock
    .calls[0] as unknown as [string, ClientToolExecutor];
  const [operationName, binding, options] = mocks.registerOperationExecutor.mock
    .calls[0] as unknown as [
    string,
    () => ExecutorBinding | undefined,
    { yields?: boolean },
  ];
  const handler = (
    mocks.registerClientOperationHandler.mock.calls[0] as unknown as [
      InstanceType<typeof mocks.RecordingHandler>,
    ]
  )[0];
  const [toolName, handlerExecute, handlerBinding, ready] = handler.args as [
    string,
    ClientToolExecutor,
    () => ExecutorBinding | undefined,
    () => boolean,
  ];
  return {
    name,
    execute,
    operationName,
    binding,
    options,
    handler,
    toolName,
    handlerExecute,
    handlerBinding,
    ready,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mailboxUser = { emailAddress: "  Max.Token@Example.COM " };
  mocks.fetcher = { fetchCalendar: vi.fn(async () => calendar) };
});

afterEach(cleanup);

describe("useOutlookClientTools", () => {
  it("registers the live executor, the durable binding and the handler, and removes all three on unmount", () => {
    const { unmount } = renderHook(() => useOutlookClientTools());
    const tools = registered();
    expect(tools.name).toBe("fetch_availability");
    expect(tools.operationName).toBe("fetch_availability");
    expect(tools.options).toEqual({ yields: true });
    expect(tools.handler).toBeInstanceOf(mocks.RecordingHandler);
    expect(tools.toolName).toBe("fetch_availability");
    expect(tools.handlerExecute).toBe(tools.execute);
    expect(tools.handlerBinding).toBe(tools.binding);
    unmount();
    expect(mocks.unregister.executor).toHaveBeenCalledTimes(1);
    expect(mocks.unregister.operation).toHaveBeenCalledTimes(1);
    expect(mocks.unregister.handler).toHaveBeenCalledTimes(1);
  });

  it("binds this device to a digest of the normalized mailbox address", async () => {
    renderHook(() => useOutlookClientTools());
    const { binding } = registered();
    const identity = createHash("sha256")
      .update("max.token@example.com")
      .digest("hex");
    await waitFor(() =>
      expect(binding()).toEqual({
        device_id: "pane-device-000000000000",
        realm: "office-addin",
        host_context: { kind: "outlook_mailbox", identity },
      }),
    );
    expect(mocks.requestClientOperationSweep).toHaveBeenCalled();
    expect(JSON.stringify(binding())).not.toContain("example");
  });

  it("has no binding without a mailbox or a stored device id", async () => {
    mocks.mailboxUser = null;
    renderHook(() => useOutlookClientTools());
    expect(registered().binding()).toBeUndefined();
    cleanup();
    vi.clearAllMocks();

    mocks.mailboxUser = { emailAddress: "max.token@example.com" };
    mocks.clientOperationDeviceId.mockReturnValueOnce(undefined);
    renderHook(() => useOutlookClientTools());
    await waitFor(() =>
      expect(mocks.requestClientOperationSweep).toHaveBeenCalled(),
    );
    expect(registered().binding()).toBeUndefined();
  });

  it("keeps routing without a calendar fetcher but is not ready to claim", async () => {
    mocks.fetcher = null;
    renderHook(() => useOutlookClientTools());
    const { binding, ready, execute } = registered();
    await waitFor(() => expect(binding()).toBeDefined());
    expect(ready()).toBe(false);
    await expect(execute({})).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("Calendar access is not available"),
    });
  });

  it("runs a parked call's input through the calendar fetcher and reports its failure", async () => {
    const { rerender } = renderHook(() => useOutlookClientTools());
    const { handlerExecute, ready } = registered();
    expect(ready()).toBe(true);
    const outcome = await handlerExecute({ lookahead_days: 30 });
    expect(mocks.fetcher?.fetchCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ freeBusyWindowDays: 30 }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      result: { timezone: "Europe/Berlin" },
    });
    mocks.fetcher = {
      fetchCalendar: vi.fn().mockRejectedValue(new Error("EWS 9020")),
    };
    rerender();
    await expect(handlerExecute({})).resolves.toEqual({
      ok: false,
      error: "EWS 9020",
    });
  });
});
