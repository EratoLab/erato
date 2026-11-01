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
 * Waits use `setTimeout`, so run it with real timers. A host whose read
 * checks a document approval (contract §16) gives `approvalScope`; one without
 * it must not advertise the check.
 */
/* eslint-disable lingui/no-unlocalized-strings -- failure text for a test run, never shown to a user */
import {
  CLIENT_TOOL_SCOPE_CHANGED,
  clientToolAcceptsGrantCalls,
  clientToolApprovalScopeAnchor,
  getChildClientToolHeaders,
  getClientToolExecutor,
  isClientToolResultLocalOnly,
} from "@/hooks/chat/clientToolExecutors";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import {
  operationExecutorBinding,
  operationExecutorHeaders,
} from "@/lib/clientOperations/registration";

import type {
  ClientToolApprovalScopeRef,
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
   * Who compares the grant's owner turn with the turn the host holds
   * (contract §7). `"host"` (the default): the host refuses a foreign owner
   * and an earlier turn's grant itself. `"server"`: a host whose context
   * outlives the pane (the desktop sidecar) has no owner turn of its own; the
   * server checks the owner at offer, dispatch, claim and every renewal, and
   * the host checks only the requesting ids and the context version.
   */
  ownerCheck?: "host" | "server";
  /**
   * A read that asks on the device, and how the user answers it. A decline
   * answers with the `declined` code, which both the live and the durable
   * path report as the `declined` outcome.
   */
  deviceApproval?: {
    read: ClientToolHostCall;
    answer: (approved: boolean) => void | Promise<void>;
  };
  /**
   * The read whose handler checks a document approval (contract §16): before
   * it reads, it compares `hostGrant.approvalScope.position` with the changes
   * since, and answers `scope_changed` after an outside one. Its binding is
   * registered with `registerOperationExecutor`, so the decision carries it.
   */
  approvalScope?: {
    read: ClientToolHostCall;
    /** How many reads of the context the host has made so far. */
    readCount: () => number;
    /** The scope id the server derives for this pane (Word: the binding identity). */
    scopeId: () => string;
    /** A change from outside the chat: the user typing, a co-author. */
    changeFromOutside: () => void | Promise<void>;
    /** A change by the chat's own write, which never ends an approval. */
    changeOwn: () => void | Promise<void>;
    /** Reloads the pane, after which no earlier position may pass. */
    reload?: () => void | Promise<void>;
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

/** Grants a host must refuse, each against a valid one for the turn.
 * `owner` marks a refusal the server makes instead for `ownerCheck: "server"`. */
const FOREIGN_GRANTS: readonly {
  name: string;
  applies: (turn: ClientToolHostTurn) => boolean;
  change: GrantChange;
  owner?: true;
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
    owner: true,
  },
  {
    name: "a foreign owner message",
    applies: () => true,
    change: (grant) => ({
      ...grant,
      ownerMessageId: "conformance-foreign-message",
    }),
    owner: true,
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
  const hostChecksOwner = (harness.ownerCheck ?? "host") === "host";
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

  const childHeaders = getChildClientToolHeaders();
  const advertised = (childHeaders["X-Erato-Child-Client-Tools"] ?? "")
    .split(",")
    .filter(Boolean);
  const scopedAdvertised = (childHeaders["X-Erato-Scoped-Client-Tools"] ?? "")
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
    change?: GrantChange,
  ): Promise<CallOutcome> =>
    (
      await grantCall(
        label,
        device.read,
        turn,
        change,
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

  /**
   * Contract §16: a covered call carries the position the pane took when the
   * user allowed the document, and the pane reads only if nothing changed
   * from outside the chat since.
   */
  async function approvalScopeRules(): Promise<void> {
    const rule = "approval scope";
    const scope = harness.approvalScope;
    const scopeRef = (scopeId: string): ClientToolApprovalScopeRef => ({
      hostContext: harness.hostContext,
      scopeId,
      covers: "document",
    });
    if (!scope) {
      for (const tool of readTools) {
        if (scopedAdvertised.includes(tool)) {
          fail(
            rule,
            `"${tool}" is listed in X-Erato-Scoped-Client-Tools, but the harness has no approval scope`,
          );
        }
        if (
          clientToolApprovalScopeAnchor(tool, scopeRef("conformance-scope"))
        ) {
          fail(
            rule,
            `"${tool}" takes a position for a scope, but the harness has no approval scope`,
          );
        }
      }
      return;
    }
    const tool = scope.read.tool;
    const name = `"${tool}"`;
    if (!scopedAdvertised.includes(tool)) {
      fail(rule, `${name} is missing from X-Erato-Scoped-Client-Tools`);
    }
    const binding = operationExecutorBinding(tool);
    if (
      !binding ||
      operationExecutorHeaders()["X-Erato-Executor"] !== JSON.stringify(binding)
    ) {
      fail(
        rule,
        `${name} has no binding of its own as X-Erato-Executor, which a document decision must carry`,
      );
    }
    const own = scopeRef(scope.scopeId());
    if (clientToolApprovalScopeAnchor(tool, scopeRef(`${own.scopeId}-other`))) {
      fail(rule, `${name} takes a position for another scope id`);
    }
    // Like a click on the card: each call takes a fresh position.
    const click = () => clientToolApprovalScopeAnchor(tool, own)?.();
    if (!clientToolApprovalScopeAnchor(tool, own)) {
      fail(rule, `${name} takes no position for its own scope`);
      return;
    }
    const earlier = await harness.startTurn();
    const turnNow = await harness.startTurn();

    const scopedCall = async (
      label: string,
      position: unknown,
      grantTurn: ClientToolHostTurn = turnNow,
      change: GrantChange = (grant) => grant,
    ) => {
      const before = scope.readCount();
      const { outcome } = await grantCall(
        label,
        scope.read,
        grantTurn,
        (grant, forTurn) => ({
          ...change(grant, forTurn),
          approvalScope: {
            approvalId: "conformance-approval",
            scopeId: own.scopeId,
            position,
          },
        }),
      );
      return { label, outcome, reads: scope.readCount() - before };
    };
    type ScopedOutcome = Awaited<ReturnType<typeof scopedCall>>;

    const expectScopedRead = (
      grantTurn: ClientToolHostTurn,
      { label, outcome, reads: made }: ScopedOutcome,
    ) => {
      expectRead(rule, label, grantTurn, outcome);
      if (outcome.kind === "settled" && outcome.result.ok && made === 0) {
        fail(rule, `${label} succeeds without reading`);
      }
    };
    const expectScopeChanged = ({
      label,
      outcome,
      reads: made,
    }: ScopedOutcome) => {
      if (!hasCode(outcome, CLIENT_TOOL_SCOPE_CHANGED)) {
        fail(
          rule,
          `${label} ${describeOutcome(outcome)}, expected the "${CLIENT_TOOL_SCOPE_CHANGED}" code`,
        );
      } else if (isTerminal(outcome)) {
        fail(
          rule,
          `${label} answers ${CLIENT_TOOL_SCOPE_CHANGED} as terminal, so the user is never asked again`,
        );
      }
      if (hasCode(outcome, harness.lossCode)) {
        fail(rule, `${label} answers the loss code`);
      }
      if (made > 0) {
        fail(
          rule,
          `${label} reads before it answers ${CLIENT_TOOL_SCOPE_CHANGED}`,
        );
      }
    };

    const allowed = click();
    expectScopedRead(
      turnNow,
      await scopedCall(`${name} under a document approval`, allowed),
    );
    await scope.changeOwn();
    expectScopedRead(
      turnNow,
      await scopedCall(
        `${name} under a document approval after the chat's own change`,
        allowed,
      ),
    );
    await scope.changeFromOutside();
    expectScopeChanged(
      await scopedCall(
        `${name} under a document approval after a change from outside`,
        allowed,
      ),
    );
    const plainLabel = `${name} without an approval after a change from outside`;
    const plainBefore = scope.readCount();
    expectScopedRead(turnNow, {
      label: plainLabel,
      outcome: (await grantCall(plainLabel, scope.read, turnNow)).outcome,
      reads: scope.readCount() - plainBefore,
    });
    // The grant is checked first: a foreign or stale call learns nothing,
    // not even that the document changed.
    const refused = [
      ...FOREIGN_GRANTS.filter(
        ({ applies, owner }) => applies(turnNow) && (hostChecksOwner || !owner),
      ).map((foreign) => ({
        what: `a grant with ${foreign.name}`,
        grantTurn: turnNow,
        change: foreign.change,
      })),
      ...(hostChecksOwner
        ? [
            {
              what: "the grant of an earlier turn",
              grantTurn: earlier,
              change: undefined,
            },
          ]
        : []),
    ];
    for (const { what, grantTurn, change } of refused) {
      const { label, outcome } = await scopedCall(
        `${name} under a document approval and ${what}`,
        allowed,
        grantTurn,
        change,
      );
      if (hasCode(outcome, CLIENT_TOOL_SCOPE_CHANGED)) {
        fail(
          rule,
          `${label} answers ${CLIENT_TOOL_SCOPE_CHANGED} before it checks the grant`,
        );
      } else {
        expectLoss(label, outcome);
      }
    }
    expectScopedRead(
      turnNow,
      await scopedCall(
        `${name} under a document approval given after the change`,
        click(),
      ),
    );
    // CT-9: a document approval stands for the server's ask, never the host's own.
    const deviceAnchor =
      approval && scopedAdvertised.includes(approval.read.tool)
        ? clientToolApprovalScopeAnchor(approval.read.tool, own)
        : undefined;
    if (approval && deviceAnchor) {
      const label = `"${approval.read.tool}" asking on the device under a document approval`;
      expectRead(
        rule,
        label,
        turnNow,
        await readUnderApproval(approval, label, turnNow, true, (grant) => ({
          ...grant,
          approvalScope: {
            approvalId: "conformance-approval",
            scopeId: own.scopeId,
            position: deviceAnchor(),
          },
        })),
      );
    }
    for (const [what, position] of [
      ["no position", undefined],
      ["a null position", null],
      ["a position that is not an object", "conformance-position"],
      ["an empty position", {}],
    ] as const) {
      expectScopeChanged(
        await scopedCall(
          `${name} under a document approval with ${what}`,
          position,
        ),
      );
    }
    if (scope.reload) {
      const beforeReload = click();
      await scope.reload();
      const reloadedTurn = await harness.startTurn();
      expectScopeChanged(
        await scopedCall(
          `${name} under a new turn's grant with a position from before a reload`,
          beforeReload,
          reloadedTurn,
        ),
      );
    }
  }

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
    for (const foreign of FOREIGN_GRANTS.filter(
      ({ applies, owner }) => applies(turn) && (hostChecksOwner || !owner),
    )) {
      await expectRefused(
        `${name} under a grant with ${foreign.name}`,
        turn,
        foreign.change,
      );
    }
    if (hostChecksOwner) {
      await expectRefused(`${name} under the grant of an earlier turn`, stale);
    }
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

  await approvalScopeRules();

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
