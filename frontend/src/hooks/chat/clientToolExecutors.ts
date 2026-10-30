import { operationExecutorHeaders } from "@/lib/clientOperations/registration";

/**
 * Registry for client-executed tools. The host (e.g. the Outlook add-in)
 * registers executors by tool name; the shared streaming loop looks them up when
 * the backend emits a `client_tool_call`. Executors MUST be read-only /
 * idempotent — a backend restart drops the parked turn and the client may
 * re-execute on recovery; mutations belong on `propose_client_action`.
 */

import type {
  CallLineage,
  ClientToolSubmissionFeedback,
  ClientToolValidationIssue,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type { ClientToolValidationIssue } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type ClientToolExecutionResult =
  | {
      ok: true;
      disposition: "local_only";
      result?: never;
      fileUploadIds?: never;
    }
  | {
      ok: true;
      disposition?: "submit";
      result: unknown;
      /**
       * Uploaded files to attach to the assistant message with rich previews.
       * The server authorizes the IDs and also extracts their text for the model.
       * Upload through the ordinary files API before returning these IDs.
       */
      fileUploadIds?: string[];
    }
  | {
      ok: false;
      disposition?: "submit";
      error: string;
      validationErrors?: ClientToolValidationIssue[];
      /** Correction handle and terminal rejection, never a successful artifact. */
      submissionFeedback?: ClientToolSubmissionFeedback;
    };

/**
 * The grant a delegated task's call runs under, as the server asserted it.
 * A handler compares it with its own context before it reads anything.
 */
export interface ClientToolHostGrant {
  /** The turn that owns the client context and granted the task its tools. */
  ownerChatId: string;
  ownerMessageId: string;
  /** The task run that made this call; the same ids as the call's own. */
  requestingChatId: string;
  requestingMessageId: string;
  /** The context version the owner turn captured, when the tool has one. */
  contextRef?: string;
  /**
   * Set when the user allowed this tool for the whole document instead of per
   * call (contract §16). The handler checks it after the grant and before it
   * reads, and answers `clientToolScopeChanged` if the context changed from
   * outside the chat since `position`.
   */
  approvalScope?: ClientToolApprovalScope;
}

/** The approval a covered grant call runs under, as the server sent it. */
export interface ClientToolApprovalScope {
  approvalId: string;
  scopeId: string;
  /** The host's position at the decision, opaque to everyone but the host. */
  position: unknown;
}

/** A scope as the approval card shows it, before any approval exists. */
export interface ClientToolApprovalScopeRef {
  /** The binding's host context kind, e.g. `word_document`. */
  hostContext: string;
  scopeId: string;
  covers: "document" | "turn";
}

/**
 * Identifiers of the call being executed. Additive second parameter: existing
 * one-parameter executors stay assignable, and hosts that need to correlate
 * (e.g. keying an on-device trace by tool call, or a consent by chat) opt in.
 */
export interface ClientToolCallContext {
  toolCallId: string;
  messageId: string;
  chatId: string | null;
  /**
   * Fires when the user aborts the turn (the stop action behind the
   * abortstream POST) — deliberately NOT on SSE transport loss, which resumes
   * and replays, so an executor that kept running still delivers its result.
   * Executors doing long on-device work should forward it (e.g. as a sidecar
   * invoke's `signal`) so a stopped turn stops the device too.
   */
  signal?: AbortSignal;
  /**
   * Set only on a delegated task's call, pushed over the executor stream or
   * claimed as a parked operation, and only to an executor registered with
   * `acceptsGrantCalls`. Absent on every call of the user's own turn.
   */
  hostGrant?: ClientToolHostGrant;
}

export type ClientToolExecutor = (
  input: unknown,
  context?: ClientToolCallContext,
) => Promise<ClientToolExecutionResult>;

interface RegisteredExecutor {
  execute: ClientToolExecutor;
  isAvailable: () => boolean;
  acceptsGrantCalls: boolean;
  checksApprovalScope: () => boolean;
  anchorsApprovalScope?: ClientToolExecutorOptions["anchorsApprovalScope"];
}

const executors = new Map<string, RegisteredExecutor>();

export interface ClientToolExecutorOptions {
  /** The handler checks `hostGrant` and reads without side effects, so a
   * delegated task may call it under a grant. */
  acceptsGrantCalls?: boolean;
  /**
   * The handler checks `hostGrant.approvalScope` right now, so the server may
   * hand it calls covered by a document approval. Only grant-capable tools
   * count; the tool is listed in `X-Erato-Scoped-Client-Tools`.
   */
  checksApprovalScope?: () => boolean;
  /**
   * When this client holds the scope's context and can check it later, a
   * function that takes the host's position at the moment the user allows
   * the scope. A document approval is offered only where one exists.
   */
  anchorsApprovalScope?: (
    scope: ClientToolApprovalScopeRef,
  ) => (() => unknown) | undefined;
}

/** Register an executor by tool name; returns an unregister function. */
export function registerClientToolExecutor(
  name: string,
  executor: ClientToolExecutor,
  isAvailable: () => boolean = () => true,
  options: ClientToolExecutorOptions = {},
): () => void {
  const entry: RegisteredExecutor = {
    execute: executor,
    isAvailable,
    acceptsGrantCalls: options.acceptsGrantCalls ?? false,
    checksApprovalScope: options.checksApprovalScope ?? (() => false),
    anchorsApprovalScope: options.anchorsApprovalScope,
  };
  executors.set(name, entry);
  return () => {
    if (executors.get(name) === entry) {
      executors.delete(name);
    }
  };
}

export function getClientToolExecutor(
  name: string,
): ClientToolExecutor | undefined {
  const entry = executors.get(name);
  return entry?.isAvailable() ? entry.execute : undefined;
}

export function clientToolAcceptsGrantCalls(name: string): boolean {
  return executors.get(name)?.acceptsGrantCalls ?? false;
}

function availableToolNames(
  accepts: (entry: RegisteredExecutor) => boolean,
): string[] {
  return [...executors.entries()]
    .filter(
      ([name, entry]) =>
        /^[a-zA-Z0-9_-]{1,64}$/.test(name) &&
        accepts(entry) &&
        entry.isAvailable(),
    )
    .map(([name]) => name)
    .sort()
    .slice(0, 128);
}

/** A capability hint only; server configuration and facet allowlists still decide. */
export function getClientToolHeaders(): Record<string, string> {
  const names = availableToolNames(() => true);
  const operations = operationExecutorHeaders();
  const allNames = [
    ...new Set([
      ...names,
      ...(operations["X-Erato-Client-Tools"]?.split(",") ?? []),
    ]),
  ]
    .sort()
    .slice(0, 128);
  return { ...operations, "X-Erato-Client-Tools": allNames.join(",") };
}

const hostGrantFromLineage = (lineage: CallLineage): ClientToolHostGrant => ({
  ownerChatId: lineage.owner_chat_id,
  ownerMessageId: lineage.owner_message_id,
  requestingChatId: lineage.requesting_chat_id,
  requestingMessageId: lineage.requesting_message_id,
  ...(lineage.context_ref ? { contextRef: lineage.context_ref } : {}),
  ...(lineage.approval_scope
    ? {
        approvalScope: {
          approvalId: lineage.approval_scope.approval_id,
          scopeId: lineage.approval_scope.scope_id,
          position: lineage.approval_scope.position,
        },
      }
    : {}),
});

/**
 * Runs one call of a client tool, for the live dispatcher and the parked
 * operation handler alike: the only place a `hostGrant` is made. The server
 * only hands a task's call to a tool advertised as taking them; a handler that
 * did not opt in has no grant check and must not run it.
 */
export async function runClientToolCall(
  toolName: string,
  executor: ClientToolExecutor,
  input: unknown,
  context: Omit<ClientToolCallContext, "hostGrant">,
  lineage?: CallLineage | null,
): Promise<ClientToolExecutionResult> {
  if (!lineage) return executor(input, context);
  if (!clientToolAcceptsGrantCalls(toolName))
    return {
      ok: false,
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Read by the task's model, never shown.
      error: `The client tool "${toolName}" does not take calls from delegated tasks`,
    };
  return executor(input, {
    ...context,
    hostGrant: hostGrantFromLineage(lineage),
  });
}

const checksScope = (entry: RegisteredExecutor): boolean =>
  entry.acceptsGrantCalls && entry.checksApprovalScope();

/**
 * The tools whose handlers accept grant calls, and those of them that check an
 * approval scope now, for the executor stream only.
 */
export function getChildClientToolHeaders(): Record<string, string> {
  const names = availableToolNames((entry) => entry.acceptsGrantCalls);
  if (!names.length) return {};
  const scoped = availableToolNames(checksScope);
  return {
    "X-Erato-Child-Client-Tools": names.join(","),
    ...(scoped.length
      ? { "X-Erato-Scoped-Client-Tools": scoped.join(",") }
      : {}),
  };
}

/**
 * The host's position-taker for `scope` on this client, or `undefined` where
 * the client cannot check that scope later: it does not hold the context, or
 * its handler does not check scopes now.
 */
export function clientToolApprovalScopeAnchor(
  name: string,
  scope: ClientToolApprovalScopeRef,
): (() => unknown) | undefined {
  const entry = executors.get(name);
  if (!entry?.isAvailable() || !checksScope(entry)) return undefined;
  return entry.anchorsApprovalScope?.(scope);
}

/** The validation code of a covered call whose scope changed from outside. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- API validation code
export const CLIENT_TOOL_SCOPE_CHANGED = "scope_changed";

/**
 * What a handler answers, without reading, when the context changed from
 * outside the chat since the user allowed the scope. Not terminal: the server
 * ends the approval and asks the user about the same call again.
 */
export function clientToolScopeChanged(
  message: string,
): ClientToolExecutionResult {
  return {
    ok: false,
    error: message,
    validationErrors: [{ path: "", code: CLIENT_TOOL_SCOPE_CHANGED, message }],
  };
}

export const answersScopeChanged = (
  issues: readonly ClientToolValidationIssue[] | null | undefined,
): boolean =>
  (issues ?? []).some((issue) => issue.code === CLIENT_TOOL_SCOPE_CHANGED);

// tool_call_ids handled this session, so a resumestream replay never re-runs a
// tool. Capped — idempotent executors make evicting the oldest safe.
const MAX_ANSWERED_TOOL_CALLS = 500;
const answeredToolCallIds = new Set<string>();

export function markClientToolCallAnswered(toolCallId: string): void {
  answeredToolCallIds.add(toolCallId);
  if (answeredToolCallIds.size > MAX_ANSWERED_TOOL_CALLS) {
    const oldest = answeredToolCallIds.values().next().value;
    if (oldest !== undefined) answeredToolCallIds.delete(oldest);
  }
}

/** Un-mark after a failed delivery so a resumestream replay can retry. */
export function unmarkClientToolCallAnswered(toolCallId: string): void {
  answeredToolCallIds.delete(toolCallId);
}

export function hasClientToolCallBeenAnswered(toolCallId: string): boolean {
  return answeredToolCallIds.has(toolCallId);
}

// One controller per running execution, grouped by chat, so the stop action
// cancels exactly that turn's on-device work.
const abortControllers = new Map<
  string,
  { chatId: string; controller: AbortController }
>();

/** Track a starting execution; the returned signal goes into its context. */
export function trackClientToolCallAbort(
  toolCallId: string,
  chatId: string,
): AbortSignal {
  const controller = new AbortController();
  abortControllers.set(toolCallId, { chatId, controller });
  return controller.signal;
}

/** Drop the controller once the execution settles, whatever the outcome. */
export function releaseClientToolCallAbort(toolCallId: string): void {
  abortControllers.delete(toolCallId);
}

export function isClientToolCallInFlight(toolCallId: string): boolean {
  return abortControllers.has(toolCallId);
}

/** Stop local work when the server reports that this call has finished or expired. */
export function abortClientToolCall(toolCallId: string): void {
  const tracked = abortControllers.get(toolCallId);
  abortControllers.delete(toolCallId);
  tracked?.controller.abort();
}

/**
 * Fire the signal of every execution still running for `chatId`. Called from
 * the user stop pathway only (`cancelMessage`, next to the abortstream POST)
 * — never from SSE cleanup, so a dropped connection cannot kill an execution
 * that could still deliver on resume.
 */
export function abortClientToolCalls(chatId: string): void {
  for (const [toolCallId, tracked] of abortControllers) {
    if (tracked.chatId === chatId) {
      abortControllers.delete(toolCallId);
      tracked.controller.abort();
    }
  }
}

export function resetClientToolRegistryForTests(): void {
  localOnlyGuards.clear();
  executors.clear();
  answeredToolCallIds.clear();
  abortControllers.clear();
}

// These predicates carry no content/status upstream. They also protect the
// missing-executor and exception fallbacks, which otherwise automatically POST.
const localOnlyGuards = new Set<{
  names: ReadonlySet<string>;
  active: () => boolean;
}>();
export function registerLocalOnlyClientTools(
  names: Iterable<string>,
  active: () => boolean,
): () => void {
  const guard = { names: new Set(names), active };
  localOnlyGuards.add(guard);
  return () => {
    localOnlyGuards.delete(guard);
  };
}
export function isClientToolResultLocalOnly(name: string): boolean {
  return (
    name === "local_collect_evidence" ||
    [...localOnlyGuards].some(
      (guard) => guard.names.has(name) && guard.active(),
    )
  );
}
