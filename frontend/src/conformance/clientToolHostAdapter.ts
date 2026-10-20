/**
 * The host adapter contract for client tools that delegated tasks call under
 * a grant (contract §7, §9 and §10). A host runs it against its own handlers.
 * It reports failures rather than asserting: each side ends with one
 * `expect(failures).toEqual([])`. Executors are called through the shared
 * registry with the context the executor stream passes, so it needs real
 * timers.
 */
/* eslint-disable lingui/no-unlocalized-strings -- failure text for a test run, never shown to a user */
import {
  clientToolAcceptsGrantCalls,
  getChildClientToolHeaders,
  getClientToolExecutor,
} from "@/hooks/chat/clientToolExecutors";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";

import type {
  ClientToolExecutionResult,
  ClientToolHostGrant,
} from "@/hooks/chat/clientToolExecutors";

/** A coordinator turn: what a send starts and a grant names as its owner. */
export interface ClientToolHostTurn {
  ownerChatId: string;
  ownerMessageId: string;
  /** The context version the turn captured, when the host has one. */
  contextRef?: string;
}

export interface ClientToolHostCall {
  tool: string;
  input: unknown;
}

export interface ClientToolHostConformanceHarness {
  /** The binding's host context kind, named in every failure. */
  hostContext: string;
  /** What the host answers a call whose context it does not hold (contract §6). */
  lossCode: "capture-unavailable" | "context_unavailable";
  /** Starts a coordinator turn, as a send does; it makes earlier turns stale. */
  startTurn: () => Promise<ClientToolHostTurn>;
  /**
   * The input field the server fills with the turn's context version
   * (`child_context_input`); the runner fills it the same way.
   */
  contextInput?: string;
  /** The coordinator's state, compared before and after every grant call. */
  coordinatorState: () => unknown;
  /** Calls to the read tools, which take grant calls. */
  reads: readonly ClientToolHostCall[];
  /** Calls to the write tools, which refuse them. */
  writes: readonly ClientToolHostCall[];
  /** Result fields and phrases that would let a reader write. */
  writeMarkers: { fields: readonly string[]; phrases: readonly string[] };
  /** Ways the host loses sight of changes; the next read must say `unknown`. */
  blindSpots: readonly {
    name: string;
    apply: () => void | Promise<void>;
  }[];
  /** A read that asks on the device, and how the user answers it. */
  deviceApproval?: {
    read: ClientToolHostCall;
    answer: (approved: boolean) => void | Promise<void>;
  };
}

const REQUESTING_CHAT_ID = "conformance-task-chat";
const APPROVAL_WAIT_MS = 1000;
const CHANGES = new Set(["none", "elsewhere", "in-scope", "unknown"]);
const COUNTS = ["own", "local", "remote", "unknown"] as const;

interface CallIds {
  toolCallId: string;
  messageId: string;
  chatId: string;
}

type CallOutcome =
  | { kind: "missing" }
  | { kind: "unsettled" }
  | { kind: "threw"; message: string }
  | { kind: "settled"; result: ClientToolExecutionResult };

/** A successful read and the turn whose grant it ran under. */
interface Read {
  label: string;
  turn: ClientToolHostTurn;
  result: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON with sorted keys, so key order never counts as a change. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, nested: unknown) =>
    isObject(nested)
      ? Object.fromEntries(
          Object.keys(nested)
            .sort()
            .map((key) => [key, nested[key]]),
        )
      : nested,
  );

const pendingChats = () =>
  Object.entries(useConfirmationRegistryStore.getState().pendingIdsByChatId)
    .filter(([, ids]) => (ids?.length ?? 0) > 0)
    .map(([chatId]) => chatId);

const waitForPendingApproval = (): Promise<boolean> =>
  new Promise((resolve) => {
    if (pendingChats().length > 0) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, APPROVAL_WAIT_MS);
    const unsubscribe = useConfirmationRegistryStore.subscribe(() => {
      if (pendingChats().length > 0) {
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }
    });
  });

const settleWithin = <T>(promise: Promise<T>): Promise<T | undefined> =>
  Promise.race([
    promise,
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), APPROVAL_WAIT_MS),
    ),
  ]);

const describeOutcome = (outcome: CallOutcome): string => {
  switch (outcome.kind) {
    case "missing":
      return "has no executor";
    case "unsettled":
      return "does not settle once the approval is answered";
    case "threw":
      return `throws "${outcome.message}"`;
    case "settled":
      return outcome.result.ok
        ? "succeeds"
        : `fails with "${outcome.result.error}" and codes [${(
            outcome.result.validationErrors ?? []
          )
            .map((issue) => issue.code)
            .join(", ")}]`;
  }
};

const hasCode = (outcome: CallOutcome, code: string): boolean =>
  outcome.kind === "settled" &&
  !outcome.result.ok &&
  (outcome.result.validationErrors ?? []).some((issue) => issue.code === code);

/** Every key and string in a result, however deep. */
const walk = (
  value: unknown,
  visit: (key: string | null, value: unknown) => void,
) => {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
  } else if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      visit(key, nested);
      walk(nested, visit);
    }
  } else {
    visit(null, value);
  }
};

const writeMarkerFailures = (
  read: Read,
  markers: ClientToolHostConformanceHarness["writeMarkers"],
): string[] => {
  const found = new Set<string>();
  walk(read.result, (key, value) => {
    if (key !== null && markers.fields.includes(key)) {
      found.add(`the field "${key}"`);
    }
    if (typeof value === "string") {
      const text = value.toLowerCase();
      for (const phrase of markers.phrases) {
        if (text.includes(phrase.toLowerCase())) {
          found.add(`the phrase "${phrase}"`);
        }
      }
    }
  });
  return [...found].map((marker) => `${read.label} returns ${marker}`);
};

const isIsoTime = (value: unknown): boolean =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  !Number.isNaN(Date.parse(value));

const freshnessFailures = (read: Read): string[] => {
  const freshness = isObject(read.result) ? read.result.freshness : undefined;
  if (!isObject(freshness)) {
    return [`${read.label} returns no freshness block`];
  }
  const failures: string[] = [];
  if (!isIsoTime(freshness.capturedAt) && !isIsoTime(freshness.readAt)) {
    failures.push(`${read.label} has neither an ISO capturedAt nor readAt`);
  }
  if (
    typeof freshness.changes !== "string" ||
    !CHANGES.has(freshness.changes)
  ) {
    failures.push(
      `${read.label} reports changes ${JSON.stringify(freshness.changes)}`,
    );
  }
  const counts = freshness.counts;
  if (!isObject(counts)) {
    failures.push(`${read.label} has no counts`);
  } else {
    for (const count of COUNTS) {
      const value = counts[count];
      if (!Number.isInteger(value) || (value as number) < 0) {
        failures.push(
          `${read.label} counts ${count} as ${JSON.stringify(value)}`,
        );
      }
    }
  }
  if (
    freshness.sections !== undefined &&
    !(
      Array.isArray(freshness.sections) &&
      freshness.sections.every((section) => typeof section === "string")
    )
  ) {
    failures.push(`${read.label} has sections that are not a list of refs`);
  }
  if (
    read.turn.contextRef !== undefined &&
    freshness.context_ref !== read.turn.contextRef
  ) {
    failures.push(
      `${read.label} reports context_ref ${JSON.stringify(freshness.context_ref)}, not the turn's "${read.turn.contextRef}"`,
    );
  }
  return failures;
};

type GrantChange = (
  grant: ClientToolHostGrant,
  turn: ClientToolHostTurn,
) => ClientToolHostGrant;

/** Grants a host must refuse, each against a valid one for the turn. */
const FOREIGN_GRANTS: readonly {
  name: string;
  applies: (turn: ClientToolHostTurn) => boolean;
  change: GrantChange;
}[] = [
  {
    name: "a requesting chat other than the call's",
    applies: () => true,
    change: (grant) => ({
      ...grant,
      requestingChatId: "conformance-other-task-chat",
    }),
  },
  {
    name: "a requesting message other than the call's",
    applies: () => true,
    change: (grant) => ({
      ...grant,
      requestingMessageId: "conformance-other-task-message",
    }),
  },
  {
    name: "a foreign owner chat",
    applies: () => true,
    change: (grant) => ({ ...grant, ownerChatId: "conformance-foreign-chat" }),
  },
  {
    name: "a foreign owner message",
    applies: () => true,
    change: (grant) => ({
      ...grant,
      ownerMessageId: "conformance-foreign-message",
    }),
  },
  {
    name: "a forged context version",
    applies: (turn) => turn.contextRef !== undefined,
    change: (grant, turn) => ({
      ...grant,
      contextRef: `${turn.contextRef}-forged`,
    }),
  },
  {
    name: "a context version for a turn that has none",
    applies: (turn) => turn.contextRef === undefined,
    change: (grant) => ({ ...grant, contextRef: "conformance-context" }),
  },
];

export const clientToolHostAdapterConformanceFailures = async (
  harness: ClientToolHostConformanceHarness,
): Promise<string[]> => {
  const failures: string[] = [];
  const fail = (rule: string, message: string) =>
    failures.push(`${rule} (${harness.hostContext}): ${message}`);
  const reads: Read[] = [];
  let calls = 0;

  const nextIds = (): CallIds => {
    calls += 1;
    return {
      toolCallId: `conformance-call-${calls}`,
      messageId: `conformance-task-message-${calls}`,
      chatId: REQUESTING_CHAT_ID,
    };
  };

  const grantFor = (
    turn: ClientToolHostTurn,
    ids: CallIds,
  ): ClientToolHostGrant => ({
    ownerChatId: turn.ownerChatId,
    ownerMessageId: turn.ownerMessageId,
    requestingChatId: ids.chatId,
    requestingMessageId: ids.messageId,
    ...(turn.contextRef === undefined ? {} : { contextRef: turn.contextRef }),
  });

  /** The input as the server dispatches it under `grant`. */
  const dispatched = (call: ClientToolHostCall, grant: ClientToolHostGrant) => {
    const input: unknown =
      call.input === undefined
        ? undefined
        : JSON.parse(JSON.stringify(call.input));
    if (harness.contextInput && isObject(input)) {
      if (grant.contextRef === undefined) {
        delete input[harness.contextInput];
      } else {
        input[harness.contextInput] = grant.contextRef;
      }
    }
    return input;
  };

  /**
   * Runs one grant call as the executor stream does, and checks what holds
   * for every grant call: the coordinator's state is left alone and no
   * approval is raised under the requesting chat.
   */
  const grantCall = async (
    label: string,
    call: ClientToolHostCall,
    turn: ClientToolHostTurn,
    change: GrantChange = (grant) => grant,
    whilePending?: () => Promise<void>,
  ): Promise<CallOutcome> => {
    const executor = getClientToolExecutor(call.tool);
    if (!executor) {
      return { kind: "missing" };
    }
    const ids = nextIds();
    const hostGrant = change(grantFor(turn, ids), turn);
    const before = stable(harness.coordinatorState());
    let underRequestingChat = pendingChats().includes(ids.chatId);
    const unsubscribe = useConfirmationRegistryStore.subscribe(() => {
      underRequestingChat ||= pendingChats().includes(ids.chatId);
    });
    let outcome: CallOutcome;
    try {
      const running = executor(dispatched(call, hostGrant), {
        ...ids,
        signal: new AbortController().signal,
        hostGrant,
      });
      if (whilePending) {
        await whilePending();
        const result = await settleWithin(running);
        outcome = result ? { kind: "settled", result } : { kind: "unsettled" };
      } else {
        outcome = { kind: "settled", result: await running };
      }
    } catch (error) {
      outcome = {
        kind: "threw",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      unsubscribe();
    }
    if (stable(harness.coordinatorState()) !== before) {
      fail("read-only", `${label} changes the coordinator's state`);
    }
    if (underRequestingChat) {
      fail(
        "device approval",
        `${label} asks under the requesting chat, not the owner chat`,
      );
    }
    return outcome;
  };

  const expectRead = (
    rule: string,
    label: string,
    turn: ClientToolHostTurn,
    outcome: CallOutcome,
  ) => {
    if (
      outcome.kind === "settled" &&
      outcome.result.ok &&
      outcome.result.disposition !== "local_only"
    ) {
      reads.push({ label, turn, result: outcome.result.result });
      return outcome.result.result;
    }
    fail(rule, `${label} ${describeOutcome(outcome)}`);
    return undefined;
  };

  const expectLoss = (label: string, outcome: CallOutcome) => {
    if (!hasCode(outcome, harness.lossCode)) {
      fail(
        "lineage",
        `${label} ${describeOutcome(outcome)}, expected the "${harness.lossCode}" code`,
      );
    }
  };

  const advertised = (
    getChildClientToolHeaders()["X-Erato-Child-Client-Tools"] ?? ""
  )
    .split(",")
    .filter(Boolean);
  const readTools = new Set([
    ...harness.reads.map((read) => read.tool),
    ...(harness.deviceApproval ? [harness.deviceApproval.read.tool] : []),
  ]);
  for (const tool of readTools) {
    if (!getClientToolExecutor(tool)) {
      fail("registration", `"${tool}" has no available executor`);
    } else if (!clientToolAcceptsGrantCalls(tool)) {
      fail("registration", `"${tool}" is not registered to take grant calls`);
    }
    if (!advertised.includes(tool)) {
      fail(
        "registration",
        `"${tool}" is missing from X-Erato-Child-Client-Tools`,
      );
    }
  }
  for (const { tool } of harness.writes) {
    if (clientToolAcceptsGrantCalls(tool) || advertised.includes(tool)) {
      fail(
        "registration",
        `the write tool "${tool}" is advertised for grant calls`,
      );
    }
  }

  const stale = await harness.startTurn();
  let turn = await harness.startTurn();
  for (const read of harness.reads) {
    const valid = `"${read.tool}" under a valid grant`;
    expectRead("lineage", valid, turn, await grantCall(valid, read, turn));
    for (const foreign of FOREIGN_GRANTS.filter(({ applies }) =>
      applies(turn),
    )) {
      const label = `"${read.tool}" under a grant with ${foreign.name}`;
      expectLoss(label, await grantCall(label, read, turn, foreign.change));
    }
    const label = `"${read.tool}" under the grant of an earlier turn`;
    expectLoss(label, await grantCall(label, read, stale));
  }

  for (const write of harness.writes) {
    const label = `"${write.tool}" under a valid grant`;
    const outcome = await grantCall(label, write, turn);
    if (outcome.kind === "missing") {
      fail("writes", `"${write.tool}" has no available executor`);
    } else if (outcome.kind === "settled" && outcome.result.ok) {
      fail("writes", `${label} runs`);
    }
  }

  const approval = harness.deviceApproval;
  if (approval) {
    for (const approved of [true, false]) {
      const label = `"${approval.read.tool}" ${approved ? "approved" : "declined"} on the device`;
      const owner = turn.ownerChatId;
      const outcome = await grantCall(
        label,
        approval.read,
        turn,
        undefined,
        async () => {
          if (!(await waitForPendingApproval())) {
            fail("device approval", `${label} raises no approval`);
          } else if (!pendingChats().includes(owner)) {
            fail(
              "device approval",
              `${label} is not pending under the owner chat`,
            );
          }
          await approval.answer(approved);
        },
      );
      if (approved) {
        expectRead("device approval", label, turn, outcome);
      } else if (!hasCode(outcome, "declined")) {
        fail(
          "device approval",
          `${label} ${describeOutcome(outcome)}, expected the "declined" code`,
        );
      }
    }
  }

  for (const blindSpot of harness.blindSpots) {
    turn = await harness.startTurn();
    await blindSpot.apply();
    const read = harness.reads.at(0);
    if (!read) {
      break;
    }
    const label = `"${read.tool}" after ${blindSpot.name}`;
    const result = expectRead(
      "freshness",
      label,
      turn,
      await grantCall(label, read, turn),
    );
    const freshness = isObject(result) ? result.freshness : undefined;
    if (isObject(freshness) && freshness.changes !== "unknown") {
      fail(
        "freshness",
        `${label} reports changes ${JSON.stringify(freshness.changes)}, expected "unknown"`,
      );
    }
  }

  for (const read of reads) {
    for (const failure of writeMarkerFailures(read, harness.writeMarkers)) {
      fail("read-only", failure);
    }
    for (const failure of freshnessFailures(read)) {
      fail("freshness", failure);
    }
  }

  return failures;
};
