import { afterEach, describe, expect, it } from "vitest";

import {
  registerClientToolExecutor,
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
  | "writes under a grant"
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
  | "declines without the declined code";

const READ = "fake_read";
const WRITE = "fake_write";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The smallest host that keeps the contract, with one switch per way to break
 * it. Without `versioned` it has no context version, like a live read. With
 * `late` it registers and deregisters its approvals a tick late, as a React
 * effect does.
 */
const fakeHost = ({
  flaw,
  versioned = true,
  late = false,
}: {
  flaw?: Flaw;
  versioned?: boolean;
  late?: boolean;
} = {}): ClientToolHostConformanceHarness => {
  const turns: ClientToolHostTurn[] = [];
  const edits: string[] = [];
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

  const read: ClientToolExecutor = async (input, context) => {
    const grant = context?.hostGrant;
    if (!context || !grant) {
      return lost;
    }
    const turn = grantedTurn(grant, context, input);
    if (!turn) {
      return lost;
    }
    const part = isRecord(input) ? String(input.part) : "";
    if (isRecord(input) && input.ask === true) {
      if (!(await askOnDevice(grant, context))) {
        return {
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
      }
    }
    if (flaw === "changes the coordinator's state") {
      edits.push(`read ${part}`);
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
                  ? { readAt: time }
                  : { context_ref: contextRef, capturedAt: time }),
                changes,
                counts: { own: 0, local: 0, remote: 0, unknown: blind ? 1 : 0 },
              },
            }),
      },
    };
  };

  const write: ClientToolExecutor = async (input, context) => {
    if (context?.hostGrant && flaw !== "writes under a grant") {
      return { ok: false, error: "Writes do not take calls from tasks." };
    }
    edits.push(`write ${isRecord(input) ? String(input.part) : ""}`);
    return { ok: true, result: { applied: true } };
  };

  registerClientToolExecutor(READ, read, () => true, {
    acceptsGrantCalls: flaw !== "does not advertise its read",
  });
  registerClientToolExecutor(WRITE, write, () => true, {
    acceptsGrantCalls: flaw === "advertises its write",
  });

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
    coordinatorState: () => ({ turn: turns.at(-1), edits }),
    reads: [{ tool: READ, input: { part: "intro" } }],
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
      "writes under a grant",
      'writes (fake_host): "fake_write" under a valid grant runs',
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
  ])("reports a host that %s", async (flaw, expected, versioned) => {
    const failures = await clientToolHostAdapterConformanceFailures(
      fakeHost({ flaw, versioned }),
    );
    for (const failure of [expected].flat()) {
      expect(failures).toContain(failure);
    }
  });
});
