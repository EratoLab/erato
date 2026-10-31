import { afterEach, describe, expect, it } from "vitest";

import {
  clientToolScopeChanged,
  registerClientToolExecutor,
  registerLocalOnlyClientTools,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { registerOperationExecutor } from "@/lib/clientOperations/registration";

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
  | "trusts the model's document identity"
  | "does not list its scope check"
  | "lists its scope check without the section"
  | "takes a position for any scope"
  | "takes its position once, not at the click"
  | "reads after an outside change"
  | "ends its approval on its own change"
  | "reads before it checks the scope"
  | "answers scope_changed as terminal"
  | "checks the scope before the grant"
  | "trusts an unreadable position"
  | "keeps positions across a reload"
  | "refuses a call without an approval after an outside change"
  | "registers no binding for its read"
  | "skips its device prompt under a document approval";

const READ = "fake_read";
const WRITE = "fake_write";
const unregister: (() => void)[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The smallest host that keeps the contract, with one switch per way to break
 * it. Without `versioned` it has no context version, like a live read. With
 * `late` it registers and deregisters its approvals a tick late, as a React
 * effect does. With `deviceOnly` every read asks on the device. With
 * `scoped` its read checks a document approval against a change journal.
 */
const fakeHost = ({
  flaw,
  versioned = true,
  late = false,
  deviceOnly = false,
  scoped = !deviceOnly,
}: {
  flaw?: Flaw;
  versioned?: boolean;
  late?: boolean;
  deviceOnly?: boolean;
  scoped?: boolean;
} = {}): ClientToolHostConformanceHarness => {
  const turns: ClientToolHostTurn[] = [];
  const edits: string[] = [];
  const readCounts = new Map<string, number>();
  let blind = false;
  let answer: ((approved: boolean) => void) | undefined;
  // The pane's change journal, one per pane load, like Word's.
  let pane = 1;
  let changeSeq = 0;
  const changes: { seq: number; own: boolean }[] = [];
  let contextReads = 0;
  const position = () => ({ journal: `journal-${pane}`, seq: changeSeq });
  const firstPosition = position();
  const changedSince = (taken: unknown): boolean => {
    if (
      !isRecord(taken) ||
      typeof taken.journal !== "string" ||
      typeof taken.seq !== "number"
    ) {
      return flaw !== "trusts an unreadable position";
    }
    if (taken.journal !== `journal-${pane}`) return true;
    return changes.some(
      (change) =>
        change.seq > (taken.seq as number) &&
        (!change.own || flaw === "ends its approval on its own change"),
    );
  };
  const scopeChanged = (): ClientToolExecutionResult => {
    const result = clientToolScopeChanged(
      "The document changed outside this chat since the user allowed it.",
    );
    return flaw === "answers scope_changed as terminal" && !result.ok
      ? {
          ...result,
          submissionFeedback: { terminal: true, recovery: "cannot_continue" },
        }
      : result;
  };
  /** Whether a grant call must answer that its scope changed. */
  const scopeEnded = (grant: ClientToolHostGrant): boolean => {
    if (!grant.approvalScope) {
      return (
        flaw === "refuses a call without an approval after an outside change" &&
        changes.some((change) => !change.own)
      );
    }
    return (
      flaw !== "reads after an outside change" &&
      changedSince(grant.approvalScope.position)
    );
  };

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
        turn.ownerChatId === grant.ownerChatId &&
        turn.ownerMessageId === grant.ownerMessageId &&
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
    if (flaw === "checks the scope before the grant" && scopeEnded(grant)) {
      return scopeChanged();
    }
    const turn = grantedTurn(grant, context, input);
    if (!turn) {
      return lost;
    }
    if (flaw === "reads before it checks the scope") {
      contextReads += 1;
    }
    if (scopeEnded(grant)) {
      return scopeChanged();
    }
    if (flaw !== "reads before it checks the scope") {
      contextReads += 1;
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
    if (
      asks &&
      flaw !== "asks before checking the grant" &&
      !(
        flaw === "skips its device prompt under a document approval" &&
        grant.approvalScope
      )
    ) {
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
    checksApprovalScope: () =>
      (scoped || flaw === "lists its scope check without the section") &&
      flaw !== "does not list its scope check",
    anchorsApprovalScope: (scope) =>
      scope.hostContext === "fake_host" &&
      (scope.scopeId === `pane-${pane}` ||
        flaw === "takes a position for any scope")
        ? flaw === "takes its position once, not at the click"
          ? () => firstPosition
          : position
        : undefined,
  });
  registerClientToolExecutor(WRITE, write, () => true, {
    acceptsGrantCalls: flaw === "advertises its write",
  });
  if (flaw === "keeps its results on the device") {
    registerLocalOnlyClientTools([READ], () => true);
  }
  if (flaw !== "registers no binding for its read") {
    unregister.push(
      registerOperationExecutor(READ, () => ({
        device_id: "fake-device-000000",
        realm: "frontend",
        host_context: { kind: "fake_host", identity: `pane-${pane}` },
      })),
    );
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
    ...(scoped
      ? {
          approvalScope: {
            read: { tool: READ, input: { part: "chapter" } },
            readCount: () => contextReads,
            scopeId: () => `pane-${pane}`,
            changeFromOutside: () => {
              changes.push({ seq: ++changeSeq, own: false });
            },
            changeOwn: () => {
              changes.push({ seq: ++changeSeq, own: true });
            },
            reload: () => {
              if (flaw !== "keeps positions across a reload") pane += 1;
            },
          },
        }
      : {}),
  };
};

it("reports a host that lists its scope check without the section", async () => {
  expect(
    await clientToolHostAdapterConformanceFailures(
      fakeHost({
        scoped: false,
        flaw: "lists its scope check without the section",
      }),
    ),
  ).toEqual([
    'approval scope (fake_host): "fake_read" is listed in X-Erato-Scoped-Client-Tools, but the harness has no approval scope',
  ]);
});

afterEach(() => {
  unregister.splice(0).forEach((undo) => undo());
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

  it("passes a host whose read does not check a document approval", async () => {
    expect(
      await clientToolHostAdapterConformanceFailures(
        fakeHost({ scoped: false }),
      ),
    ).toEqual([]);
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
  const SCOPE_CHANGED =
    "The document changed outside this chat since the user allowed it.";

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
    [
      "does not list its scope check",
      [
        'approval scope (fake_host): "fake_read" is missing from X-Erato-Scoped-Client-Tools',
        'approval scope (fake_host): "fake_read" takes no position for its own scope',
      ],
      true,
    ],
    [
      "registers no binding for its read",
      [
        'approval scope (fake_host): "fake_read" has no binding of its own as X-Erato-Executor, which a document decision must carry',
        'approval scope (fake_host): "fake_read" takes no position for its own scope',
      ],
      true,
    ],
    [
      "takes a position for any scope",
      'approval scope (fake_host): "fake_read" takes a position for another scope id',
      true,
    ],
    [
      "takes its position once, not at the click",
      `approval scope (fake_host): "fake_read" under a document approval given after the change fails with "${SCOPE_CHANGED}" and codes [scope_changed]`,
      true,
    ],
    [
      "reads after an outside change",
      'approval scope (fake_host): "fake_read" under a document approval after a change from outside succeeds, expected the "scope_changed" code',
      true,
    ],
    [
      "ends its approval on its own change",
      `approval scope (fake_host): "fake_read" under a document approval after the chat's own change fails with "${SCOPE_CHANGED}" and codes [scope_changed]`,
      true,
    ],
    [
      "reads before it checks the scope",
      'approval scope (fake_host): "fake_read" under a document approval after a change from outside reads before it answers scope_changed',
      true,
    ],
    [
      "answers scope_changed as terminal",
      'approval scope (fake_host): "fake_read" under a document approval after a change from outside answers scope_changed as terminal, so the user is never asked again',
      true,
    ],
    [
      "checks the scope before the grant",
      'approval scope (fake_host): "fake_read" under a document approval and a grant with a foreign owner chat answers scope_changed before it checks the grant',
      true,
    ],
    [
      "trusts an unreadable position",
      'approval scope (fake_host): "fake_read" under a document approval with no position succeeds, expected the "scope_changed" code',
      true,
    ],
    [
      "keeps positions across a reload",
      `approval scope (fake_host): "fake_read" under a new turn's grant with a position from before a reload succeeds, expected the "scope_changed" code`,
      true,
    ],
    [
      "refuses a call without an approval after an outside change",
      `approval scope (fake_host): "fake_read" without an approval after a change from outside fails with "${SCOPE_CHANGED}" and codes [scope_changed]`,
      true,
    ],
    [
      "skips its device prompt under a document approval",
      'device approval (fake_host): "fake_read" asking on the device under a document approval raises no approval',
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
