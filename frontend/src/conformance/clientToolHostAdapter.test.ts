import { afterEach, describe, expect, it } from "vitest";

import {
  registerClientToolExecutor,
  registerLocalOnlyClientTools,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";

import { clientToolHostAdapterConformanceFailures } from "./clientToolHostAdapter";

import type {
  ClientToolHostConformanceHarness,
  ClientToolHostTurn,
} from "./clientToolHostAdapter";
import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolExecutor,
  ClientToolHostGrant,
} from "@/hooks/chat/clientToolExecutors";

type Flaw =
  | "skips the lineage check"
  | "accepts mismatched requesting ids"
  | "accepts an earlier turn's grant"
  | "accepts a context version it does not have"
  | "ignores the context version"
  | "skips the context check without a grant version"
  | "returns a non-terminal loss"
  | "leaks a write token"
  | "leaks write guidance"
  | "changes the coordinator's state"
  | "changes a Map it keeps"
  | "advertises its write"
  | "does not advertise its read"
  | "returns no freshness"
  | "returns a non-ISO time"
  | "reports another turn's context_ref"
  | "reports none in a blind spot"
  | "never asks on the device"
  | "asks under the requesting chat"
  | "asks under a third chat"
  | "never settles after the answer"
  | "declines without the declined code"
  | "asks before checking the grant"
  | "hangs on a read"
  | "keeps its results on the device"
  | "answers local_only"
  | "reports a context_ref without a context version"
  | "trusts the model's document identity";

const READ = "fake_read";
const WRITE = "fake_write";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The smallest host that keeps the contract, with one switch per way to break
 * it. Without `versioned` it has no context version, like a live read. With
 * `late` it registers and deregisters its approvals a tick late, as a React
 * effect does. With `deviceOnly` every read asks on the device.
 */
const fakeHost = ({
  flaw,
  versioned = true,
  late = false,
  deviceOnly = false,
  serverOwner = false,
}: {
  flaw?: Flaw;
  versioned?: boolean;
  late?: boolean;
  deviceOnly?: boolean;
  /** Leaves the owner turn to the server, as a context that outlives the pane. */
  serverOwner?: boolean;
} = {}): ClientToolHostConformanceHarness => {
  const turns: ClientToolHostTurn[] = [];
  const edits: string[] = [];
  const readCounts = new Map<string, number>();
  let blind = false;
  let answer: ((approved: boolean) => void) | undefined;

  const lost: ClientToolExecutionResult = {
    ok: false,
    error: "The context of this call is no longer available.",
    validationErrors: [
      {
        path: "/context",
        code: "context_unavailable",
        message: "Start a new request.",
      },
    ],
    ...(flaw === "returns a non-terminal loss"
      ? {}
      : {
          submissionFeedback: { terminal: true, recovery: "cannot_continue" },
        }),
  };

  const grantedTurn = (
    grant: ClientToolHostGrant,
    context: ClientToolCallContext,
    input: unknown,
  ): ClientToolHostTurn | undefined => {
    if (flaw === "skips the lineage check") {
      return turns.at(-1);
    }
    const requesting =
      grant.requestingChatId === context.chatId &&
      grant.requestingMessageId === context.messageId;
    if (!requesting && flaw !== "accepts mismatched requesting ids") {
      return undefined;
    }
    const contextMatches = (turn: ClientToolHostTurn) =>
      flaw === "ignores the context version" ||
      (flaw === "skips the context check without a grant version" &&
        grant.contextRef === undefined) ||
      ((grant.contextRef === turn.contextRef ||
        (flaw === "accepts a context version it does not have" &&
          turn.contextRef === undefined)) &&
        (!versioned || (isRecord(input) && input.context === turn.contextRef)));
    const candidates =
      flaw === "accepts an earlier turn's grant" ? turns : turns.slice(-1);
    return candidates.find(
      (turn) =>
        (serverOwner ||
          (turn.ownerChatId === grant.ownerChatId &&
            turn.ownerMessageId === grant.ownerMessageId)) &&
        contextMatches(turn),
    );
  };

  const later = (step: () => void) => {
    if (late) {
      setTimeout(step, 0);
    } else {
      step();
    }
  };

  const askOnDevice = async (
    grant: ClientToolHostGrant,
    context: ClientToolCallContext,
  ): Promise<boolean> => {
    if (flaw === "never asks on the device") {
      return true;
    }
    const chatId =
      flaw === "asks under the requesting chat"
        ? grant.requestingChatId
        : flaw === "asks under a third chat"
          ? "third-chat"
          : grant.ownerChatId;
    const registry = useConfirmationRegistryStore.getState();
    const approved = await new Promise<boolean>((resolve) => {
      later(() => {
        registry.registerConfirmation(chatId, context.toolCallId);
        answer = (approved) => {
          answer = undefined;
          resolve(approved);
        };
      });
    });
    later(() => registry.unregisterConfirmation(chatId, context.toolCallId));
    if (flaw === "never settles after the answer") {
      await new Promise<never>(() => {});
    }
    return approved;
  };

  const declined: ClientToolExecutionResult = {
    ok: false,
    error: "The user declined this read.",
    validationErrors: [
      {
        path: "",
        code:
          flaw === "declines without the declined code"
            ? "rejected"
            : "declined",
        message: "Declined on this device.",
      },
    ],
  };

  const read: ClientToolExecutor = async (input, context) => {
    const grant = context?.hostGrant;
    if (!context || !grant) {
      return lost;
    }
    const asks = isRecord(input) && input.ask === true;
    if (
      asks &&
      flaw === "asks before checking the grant" &&
      !(await askOnDevice(grant, context))
    ) {
      return declined;
    }
    const turn = grantedTurn(grant, context, input);
    if (!turn) {
      return lost;
    }
    if (
      flaw === "trusts the model's document identity" &&
      !(isRecord(input) && typeof input.identity === "string")
    ) {
      return { ok: false, error: "No document identity." };
    }
    const part = isRecord(input) ? String(input.part) : "";
    if (flaw === "hangs on a read" && !asks) {
      await new Promise<never>(() => {});
    }
    if (flaw === "answers local_only") {
      return { ok: true, disposition: "local_only" };
    }
    if (asks && flaw !== "asks before checking the grant") {
      if (!(await askOnDevice(grant, context))) {
        return declined;
      }
    }
    if (flaw === "changes the coordinator's state") {
      edits.push(`read ${part}`);
    }
    if (flaw === "changes a Map it keeps") {
      readCounts.set(part, (readCounts.get(part) ?? 0) + 1);
    }
    const changes =
      blind && flaw !== "reports none in a blind spot" ? "unknown" : "none";
    const time =
      flaw === "returns a non-ISO time" ? "yesterday" : "2026-10-20T10:00:00Z";
    const contextRef =
      flaw === "reports another turn's context_ref"
        ? turns[0]?.contextRef
        : turn.contextRef;
    return {
      ok: true,
      result: {
        text:
          flaw === "leaks write guidance"
            ? `Part ${part}. To change it, call fake_write with this part.`
            : `Part ${part}.`,
        ...(flaw === "leaks a write token" ? { writeToken: "write-1" } : {}),
        ...(flaw === "returns no freshness"
          ? {}
          : {
              freshness: {
                ...(turn.contextRef === undefined
                  ? {
                      readAt: time,
                      ...(flaw ===
                      "reports a context_ref without a context version"
                        ? { context_ref: "leftover" }
                        : {}),
                    }
                  : { context_ref: contextRef, capturedAt: time }),
                changes,
                counts: { own: 0, local: 0, remote: 0, unknown: blind ? 1 : 0 },
              },
            }),
      },
    };
  };

  // The dispatcher never hands a grant call to a tool that does not take
  // them, so a write needs no check of its own.
  const write: ClientToolExecutor = async (input) => {
    edits.push(`write ${isRecord(input) ? String(input.part) : ""}`);
    return { ok: true, result: { applied: true } };
  };

  registerClientToolExecutor(READ, read, () => true, {
    acceptsGrantCalls: flaw !== "does not advertise its read",
  });
  registerClientToolExecutor(WRITE, write, () => true, {
    acceptsGrantCalls: flaw === "advertises its write",
  });
  if (flaw === "keeps its results on the device") {
    registerLocalOnlyClientTools([READ], () => true);
  }

  return {
    hostContext: "fake_host",
    lossCode: "context_unavailable",
    startTurn: async () => {
      blind = false;
      const turn: ClientToolHostTurn = {
        ownerChatId: "owner-chat",
        ownerMessageId: `owner-message-${turns.length + 1}`,
        ...(versioned ? { contextRef: `CONTEXT-${turns.length + 1}` } : {}),
      };
      turns.push(turn);
      return turn;
    },
    ...(versioned ? { contextInput: "context" } : {}),
    // The model's guess, which the server drops before the hand-over.
    hostInputs: ["identity"],
    coordinatorState: () => ({ turn: turns.at(-1), edits, readCounts }),
    reads: deviceOnly
      ? []
      : [{ tool: READ, input: { part: "intro", identity: "guessed" } }],
    writes: [{ tool: WRITE, input: { part: "intro", text: "New" } }],
    writeMarkers: { fields: ["writeToken"], phrases: ["call fake_write"] },
    blindSpots: [
      {
        name: "its change events dropping out",
        apply: () => {
          blind = true;
        },
      },
    ],
    deviceApproval: {
      read: { tool: READ, input: { part: "appendix", ask: true } },
      answer: (approved) => answer?.(approved),
    },
  };
};

afterEach(() => {
  resetClientToolRegistryForTests();
  useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
});

describe("clientToolHostAdapterConformanceFailures", () => {
  it("passes a host that keeps the contract", async () => {
    expect(await clientToolHostAdapterConformanceFailures(fakeHost())).toEqual(
      [],
    );
  });

  it("passes a host without a context version", async () => {
    expect(
      await clientToolHostAdapterConformanceFailures(
        fakeHost({ versioned: false }),
      ),
    ).toEqual([]);
  });

  it("passes a host that registers its approvals a tick late", async () => {
    expect(
      await clientToolHostAdapterConformanceFailures(fakeHost({ late: true })),
    ).toEqual([]);
  });

  it("passes a host whose every read asks on the device", async () => {
    expect(
      await clientToolHostAdapterConformanceFailures(
        fakeHost({ deviceOnly: true }),
      ),
    ).toEqual([]);
  });

  it("checks a device-only host's blind spots through its approved read", async () => {
    expect(
      await clientToolHostAdapterConformanceFailures(
        fakeHost({ deviceOnly: true, flaw: "reports none in a blind spot" }),
      ),
    ).toContain(
      'freshness (fake_host): "fake_read" approved after its change events dropping out reports changes "none", expected "unknown"',
    );
  });

  it("passes a host that leaves the owner check to the server, when the harness says so", async () => {
    const host = () => fakeHost({ versioned: false, serverOwner: true });
    expect(
      await clientToolHostAdapterConformanceFailures({
        ...host(),
        ownerCheck: "server",
      }),
    ).toEqual([]);
    resetClientToolRegistryForTests();
    expect(await clientToolHostAdapterConformanceFailures(host())).toContain(
      `lineage (fake_host): "fake_read" under a grant with a foreign owner chat succeeds, expected the "context_unavailable" code`,
    );
  });

  it("still checks the requesting ids and the context version of a host that leaves the owner to the server", async () => {
    expect(
      await clientToolHostAdapterConformanceFailures({
        ...fakeHost({
          versioned: false,
          serverOwner: true,
          flaw: "accepts mismatched requesting ids",
        }),
        ownerCheck: "server",
      }),
    ).toContain(
      `lineage (fake_host): "fake_read" under a grant with a requesting message other than the call's succeeds, expected the "context_unavailable" code`,
    );
  });

  it("reports a harness that lists no read", async () => {
    const harness = fakeHost({ deviceOnly: true });
    expect(
      await clientToolHostAdapterConformanceFailures({
        ...harness,
        deviceApproval: undefined,
        blindSpots: [],
      }),
    ).toEqual(["harness (fake_host): lists no read, so no rule is checked"]);
  });

  const lost = 'expected the "context_unavailable" code';

  it.each<[Flaw, string | readonly string[], boolean]>([
    [
      "skips the lineage check",
      `lineage (fake_host): "fake_read" under a grant with a foreign owner chat succeeds, ${lost}`,
      true,
    ],
    [
      "accepts mismatched requesting ids",
      `lineage (fake_host): "fake_read" under a grant with a requesting message other than the call's succeeds, ${lost}`,
      true,
    ],
    [
      "accepts an earlier turn's grant",
      `lineage (fake_host): "fake_read" under the grant of an earlier turn succeeds, ${lost}`,
      true,
    ],
    [
      "accepts a context version it does not have",
      `lineage (fake_host): "fake_read" under a grant with a context version for a turn that has none succeeds, ${lost}`,
      false,
    ],
    [
      "ignores the context version",
      `lineage (fake_host): "fake_read" under a grant with a forged context version succeeds, ${lost}`,
      true,
    ],
    [
      "skips the context check without a grant version",
      `lineage (fake_host): "fake_read" under a grant with no context version for a turn that has one succeeds, ${lost}`,
      true,
    ],
    [
      "returns a non-terminal loss",
      'lineage (fake_host): "fake_read" under a grant with a foreign owner chat returns a non-terminal loss',
      true,
    ],
    [
      "leaks a write token",
      'read-only (fake_host): "fake_read" under a valid grant returns the field "writeToken"',
      true,
    ],
    [
      "leaks write guidance",
      'read-only (fake_host): "fake_read" under a valid grant returns the phrase "call fake_write"',
      true,
    ],
    [
      "changes the coordinator's state",
      `read-only (fake_host): "fake_read" under a valid grant changes the coordinator's state`,
      true,
    ],
    [
      "changes a Map it keeps",
      `read-only (fake_host): "fake_read" under a valid grant changes the coordinator's state`,
      true,
    ],
    [
      "advertises its write",
      'registration (fake_host): the write tool "fake_write" is advertised for grant calls',
      true,
    ],
    [
      "does not advertise its read",
      'registration (fake_host): "fake_read" is missing from X-Erato-Child-Client-Tools',
      true,
    ],
    [
      "returns no freshness",
      'freshness (fake_host): "fake_read" under a valid grant returns no freshness block',
      true,
    ],
    [
      "returns a non-ISO time",
      'freshness (fake_host): "fake_read" under a valid grant has neither an ISO capturedAt nor readAt',
      true,
    ],
    [
      "reports another turn's context_ref",
      `freshness (fake_host): "fake_read" under a valid grant reports context_ref "CONTEXT-1", not the turn's "CONTEXT-2"`,
      true,
    ],
    [
      "reports none in a blind spot",
      'freshness (fake_host): "fake_read" after its change events dropping out reports changes "none", expected "unknown"',
      true,
    ],
    [
      "never asks on the device",
      'device approval (fake_host): "fake_read" approved on the device raises no approval',
      true,
    ],
    [
      "asks under the requesting chat",
      [
        'device approval (fake_host): "fake_read" approved on the device asks under the requesting chat, not the owner chat',
        'device approval (fake_host): "fake_read" approved on the device is not pending under the owner chat',
      ],
      true,
    ],
    [
      "asks under a third chat",
      'device approval (fake_host): "fake_read" approved on the device is not pending under the owner chat',
      true,
    ],
    [
      "never settles after the answer",
      'device approval (fake_host): "fake_read" approved on the device does not settle once the approval is answered',
      true,
    ],
    [
      "declines without the declined code",
      'device approval (fake_host): "fake_read" declined on the device fails with "The user declined this read." and codes [rejected], expected the "declined" code',
      true,
    ],
    [
      "asks before checking the grant",
      'device approval (fake_host): "fake_read" asking on the device under a grant with a foreign owner chat asks on the device before it checks the grant',
      true,
    ],
    [
      "hangs on a read",
      'lineage (fake_host): "fake_read" under a valid grant does not settle within 1000 ms',
      true,
    ],
    [
      "keeps its results on the device",
      'registration (fake_host): "fake_read" keeps its results on the device, so a task\'s call is never answered',
      true,
    ],
    [
      "answers local_only",
      'lineage (fake_host): "fake_read" under a valid grant keeps its result on the device, so the task gets no answer',
      true,
    ],
    [
      "reports a context_ref without a context version",
      'freshness (fake_host): "fake_read" under a valid grant reports context_ref "leftover" for a turn without a context version',
      false,
    ],
    [
      "trusts the model's document identity",
      'lineage (fake_host): "fake_read" under a valid grant fails with "No document identity." and codes []',
      true,
    ],
  ])(
    "reports a host that %s",
    async (flaw, expected, versioned) => {
      const failures = await clientToolHostAdapterConformanceFailures(
        fakeHost({ flaw, versioned }),
      );
      for (const failure of [expected].flat()) {
        expect(failures).toContain(failure);
      }
    },
    // A host that asks before it checks holds every bad-grant call for a wait.
    30_000,
  );
});
