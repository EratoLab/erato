/**
 * The host adapter contract for client tools that delegated tasks call under
 * a grant (contract §7, §9 and §10). A host runs it against its own handlers.
 * It reports failures rather than asserting: each side ends with one
 * `expect(failures).toEqual([])`. Executors are looked up in the shared
 * registry and called with a `hostGrant` built as `runClientToolCall` builds
 * it. Write tools are only checked to be registered without
 * `acceptsGrantCalls`: `runClientToolCall`, which the live dispatcher and the
 * parked-operation handler both use, answers a grant call to such a tool with
 * an error and never runs it, and it is the only place a `hostGrant` is made.
 * Waits use `setTimeout`, so run it with real timers.
 */
/* eslint-disable lingui/no-unlocalized-strings -- failure text for a test run, never shown to a user */
import {
  clientToolAcceptsGrantCalls,
  getChildClientToolHeaders,
  getClientToolExecutor,
  isClientToolResultLocalOnly,
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
  /**
   * What the host answers a call whose context it does not hold (contract §6),
   * always with `submissionFeedback.terminal`: a loss is never retried.
   */
  lossCode: "capture-unavailable" | "context_unavailable";
  /** Starts a coordinator turn, as a send does; it makes earlier turns stale. */
  startTurn: () => Promise<ClientToolHostTurn>;
  /**
   * The input field the server fills with the turn's context version
   * (`child_context_input`); the runner fills it the same way.
   */
  contextInput?: string;
  /**
   * Input fields the host fills from its own context (`child_host_inputs`);
   * the server drops them before the hand-over, and the runner does too.
   */
  hostInputs?: readonly string[];
  /**
   * The coordinator's state, compared before and after every grant call.
   * Maps and Sets count by content; return the state itself, since private
   * fields are not visible.
   */
  coordinatorState: () => unknown;
  /**
   * Calls to the read tools, which take grant calls. A host whose every read
   * asks on the device lists none and gives `deviceApproval`.
   */
  reads: readonly ClientToolHostCall[];
  /** The write tools, which must not be registered for grant calls. */
  writes: readonly ClientToolHostCall[];
  /** Result fields and phrases that would let a reader write. */
  writeMarkers: { fields: readonly string[]; phrases: readonly string[] };
  /** Ways the host loses sight of changes; the next read must say `unknown`. */
  blindSpots: readonly {
    name: string;
    apply: () => void | Promise<void>;
  }[];
  /**
   * A read that asks on the device, and how the user answers it. A decline
   * answers with the `declined` code, which the durable path reports as the
   * `declined` outcome; the live path does not map it yet (ERMAIN-1034).
   */
  deviceApproval?: {
    read: ClientToolHostCall;
    answer: (approved: boolean) => void | Promise<void>;
  };
}

const REQUESTING_CHAT_ID = "conformance-task-chat";
/** How long a grant call, or an approval it raises, may take. */
const WAIT_MS = 1000;
const CHANGES = new Set(["none", "elsewhere", "in-scope", "unknown"]);
const COUNTS = ["own", "local", "remote", "unknown"] as const;

interface CallIds {
  toolCallId: string;
  messageId: string;
  chatId: string;
}

type CallOutcome =
  | { kind: "missing" }
  | { kind: "unsettled"; afterApproval: boolean }
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

const byJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) < JSON.stringify(right) ? -1 : 1;

/** Plain data with sorted keys, and Maps and Sets by content, so neither key
 * order nor insertion order counts as a change. */
const comparable = (value: unknown): unknown => {
  if (value instanceof Map) {
    return {
      "<Map>": [...value.entries()]
        .map(([key, nested]) => [comparable(key), comparable(nested)])
        .sort(byJson),
    };
  }
  if (value instanceof Set) {
    return { "<Set>": [...value].map(comparable).sort(byJson) };
  }
  if (Array.isArray(value)) {
    return value.map(comparable);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, comparable(value[key])]),
    );
  }
  return value;
};

const stable = (value: unknown): string => JSON.stringify(comparable(value));

type PendingApprovals = Partial<Record<string, string[]>>;

const pendingApprovals = (): PendingApprovals =>
  useConfirmationRegistryStore.getState().pendingIdsByChatId;

/**
 * Approvals registered since `before`, as chat ids. A host that deregisters
 * in an effect cleanup can still hold an earlier call's entry.
 */
const approvalChatsSince = (before: PendingApprovals): string[] =>
  Object.entries(pendingApprovals()).flatMap(([chatId, ids]) =>
    (ids ?? [])
      .filter((id) => !(before[chatId] ?? []).includes(id))
      .map(() => chatId),
  );

/** The chat of the first approval registered since `before`. */
const waitForApprovalSince = (
  before: PendingApprovals,
): Promise<string | undefined> =>
  new Promise((resolve) => {
    const registered = approvalChatsSince(before).at(0);
    if (registered !== undefined) {
      resolve(registered);
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(undefined);
    }, WAIT_MS);
    const unsubscribe = useConfirmationRegistryStore.subscribe(() => {
      const chatId = approvalChatsSince(before).at(0);
      if (chatId !== undefined) {
        clearTimeout(timer);
        unsubscribe();
        resolve(chatId);
      }
    });
  });

const settleWithin = async (
  settled: Promise<CallOutcome>,
  afterApproval: boolean,
): Promise<CallOutcome> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settled,
      new Promise<CallOutcome>((resolve) => {
        timer = setTimeout(
          () => resolve({ kind: "unsettled", afterApproval }),
          WAIT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const threw = (error: unknown): CallOutcome => ({
  kind: "threw",
  message: error instanceof Error ? error.message : String(error),
});

const describeOutcome = (outcome: CallOutcome): string => {
  switch (outcome.kind) {
    case "missing":
      return "has no executor";
    case "unsettled":
      return outcome.afterApproval
        ? "does not settle once the approval is answered"
        : `does not settle within ${WAIT_MS} ms`;
    case "threw":
      return `throws "${outcome.message}"`;
    case "settled":
      return outcome.result.ok
        ? outcome.result.disposition === "local_only"
          ? "keeps its result on the device, so the task gets no answer"
          : "succeeds"
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

const isTerminal = (outcome: CallOutcome): boolean =>
  outcome.kind === "settled" &&
  !outcome.result.ok &&
  outcome.result.submissionFeedback?.terminal === true;

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
  if (
    read.turn.contextRef === undefined &&
    freshness.context_ref !== undefined
  ) {
    failures.push(
      `${read.label} reports context_ref ${JSON.stringify(freshness.context_ref)} for a turn without a context version`,
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
  // The server writes such a grant when the turn's action-facet arguments
  // lack the context version, and strips the input field.
  {
    name: "no context version for a turn that has one",
    applies: (turn) => turn.contextRef !== undefined,
    change: ({ contextRef: _omitted, ...grant }) => grant,
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
    const input: unknown = JSON.parse(JSON.stringify(call.input ?? null));
    if (isObject(input)) {
      for (const field of harness.hostInputs ?? []) {
        delete input[field];
      }
    }
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
   * approval is raised under the requesting chat. `asked` says whether the
   * call raised an approval at all.
   */
  const grantCall = async (
    label: string,
    call: ClientToolHostCall,
    turn: ClientToolHostTurn,
    change: GrantChange = (grant) => grant,
    whilePending?: (approvalsBefore: PendingApprovals) => Promise<void>,
  ): Promise<{ outcome: CallOutcome; asked: boolean }> => {
    const executor = getClientToolExecutor(call.tool);
    if (!executor) {
      return { outcome: { kind: "missing" }, asked: false };
    }
    const ids = nextIds();
    const hostGrant = change(grantFor(turn, ids), turn);
    const stateBefore = stable(harness.coordinatorState());
    const approvalsBefore = pendingApprovals();
    const approvalChats = new Set<string>();
    const unsubscribe = useConfirmationRegistryStore.subscribe(() => {
      approvalChatsSince(approvalsBefore).forEach((chatId) =>
        approvalChats.add(chatId),
      );
    });
    let outcome: CallOutcome;
    try {
      // Settled into an outcome at once, so a read that rejects while the
      // approval is pending is reported instead of escaping the run.
      const settled = executor(dispatched(call, hostGrant), {
        ...ids,
        signal: new AbortController().signal,
        hostGrant,
      }).then((result): CallOutcome => ({ kind: "settled", result }), threw);
      if (whilePending) {
        await whilePending(approvalsBefore);
      }
      outcome = await settleWithin(settled, whilePending !== undefined);
    } catch (error) {
      outcome = threw(error);
    } finally {
      unsubscribe();
    }
    if (stable(harness.coordinatorState()) !== stateBefore) {
      fail("read-only", `${label} changes the coordinator's state`);
    }
    if (approvalChats.has(ids.chatId)) {
      fail(
        "device approval",
        `${label} asks under the requesting chat, not the owner chat`,
      );
    }
    return { outcome, asked: approvalChats.size > 0 };
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
    } else if (!isTerminal(outcome)) {
      fail("lineage", `${label} returns a non-terminal loss`);
    }
  };

  const approval = harness.deviceApproval;
  if (harness.reads.length === 0 && !approval) {
    fail("harness", "lists no read, so no rule is checked");
  }

  const advertised = (
    getChildClientToolHeaders()["X-Erato-Child-Client-Tools"] ?? ""
  )
    .split(",")
    .filter(Boolean);
  const readTools = new Set([
    ...harness.reads.map((read) => read.tool),
    ...(approval ? [approval.read.tool] : []),
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
    if (isClientToolResultLocalOnly(tool)) {
      fail(
        "registration",
        `"${tool}" keeps its results on the device, so a task's call is never answered`,
      );
    }
  }
  for (const { tool } of harness.writes) {
    if (!getClientToolExecutor(tool)) {
      fail("writes", `"${tool}" has no available executor`);
    }
    if (clientToolAcceptsGrantCalls(tool) || advertised.includes(tool)) {
      fail(
        "registration",
        `the write tool "${tool}" is advertised for grant calls`,
      );
    }
  }

  /** A read that asks on the device, answered once the approval is up. */
  const readUnderApproval = async (
    device: NonNullable<ClientToolHostConformanceHarness["deviceApproval"]>,
    label: string,
    turn: ClientToolHostTurn,
    approved: boolean,
  ): Promise<CallOutcome> =>
    (
      await grantCall(
        label,
        device.read,
        turn,
        undefined,
        async (approvalsBefore) => {
          const chatId = await waitForApprovalSince(approvalsBefore);
          if (chatId === undefined) {
            fail("device approval", `${label} raises no approval`);
          } else if (chatId !== turn.ownerChatId) {
            fail(
              "device approval",
              `${label} is not pending under the owner chat`,
            );
          }
          await device.answer(approved);
        },
      )
    ).outcome;

  const stale = await harness.startTurn();
  let turn = await harness.startTurn();
  const lineageReads = [
    ...harness.reads.map((read) => ({ read, name: `"${read.tool}"` })),
    ...(approval
      ? [
          {
            read: approval.read,
            name: `"${approval.read.tool}" asking on the device`,
          },
        ]
      : []),
  ];
  for (const { read, name } of lineageReads) {
    if (read !== approval?.read) {
      const valid = `${name} under a valid grant`;
      expectRead(
        "lineage",
        valid,
        turn,
        (await grantCall(valid, read, turn)).outcome,
      );
    }
    // A bad grant is refused before anything else happens, so the user is
    // never asked about a call that cannot run.
    const expectRefused = async (
      label: string,
      grantTurn: ClientToolHostTurn,
      change?: GrantChange,
    ) => {
      const { outcome, asked } = await grantCall(
        label,
        read,
        grantTurn,
        change,
      );
      if (asked) {
        fail(
          "device approval",
          `${label} asks on the device before it checks the grant`,
        );
        await approval?.answer(false);
      }
      expectLoss(label, outcome);
    };
    for (const foreign of FOREIGN_GRANTS.filter(({ applies }) =>
      applies(turn),
    )) {
      await expectRefused(
        `${name} under a grant with ${foreign.name}`,
        turn,
        foreign.change,
      );
    }
    await expectRefused(`${name} under the grant of an earlier turn`, stale);
  }

  if (approval) {
    for (const approved of [true, false]) {
      const label = `"${approval.read.tool}" ${approved ? "approved" : "declined"} on the device`;
      const outcome = await readUnderApproval(approval, label, turn, approved);
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

  // A host whose every read asks on the device is checked through that read.
  const blindSpotRead = harness.reads.at(0);
  for (const blindSpot of harness.blindSpots) {
    turn = await harness.startTurn();
    await blindSpot.apply();
    let label: string;
    let outcome: CallOutcome;
    if (blindSpotRead) {
      label = `"${blindSpotRead.tool}" after ${blindSpot.name}`;
      outcome = (await grantCall(label, blindSpotRead, turn)).outcome;
    } else if (approval) {
      label = `"${approval.read.tool}" approved after ${blindSpot.name}`;
      outcome = await readUnderApproval(approval, label, turn, true);
    } else {
      break;
    }
    const result = expectRead("freshness", label, turn, outcome);
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
