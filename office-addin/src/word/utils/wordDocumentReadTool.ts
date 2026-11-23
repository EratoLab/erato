import {
  MAX_SOURCE_BYTES,
  MAX_PLAN_BYTES,
  MAX_DOCUMENT_BLOCKS,
  wordSourceReadRefs,
  wordImageAssetMetadata,
  wordSourceDetails,
  isWordHistorySnapshot,
  WORD_READ_TOOL,
  wordReplayRecordRead,
} from "@erato/frontend/word-review";

import { checkWordApprovalScope } from "./wordApprovalScope";
import { wordAuthoringContract } from "./wordAuthoringContract";
import {
  wordReadableSourceBlock,
  wordReadableStyles,
  wordStyleNamesBytes,
} from "./wordAuthoringReadData";
import { WordDocumentDraftStore } from "./wordDocumentDrafts";
import { MAX_WORD_DOCX_BYTES } from "./wordDocumentPackageCodec";
import { withReadOnlyFields, wordReadRefusedByIssue } from "./wordReadAccess";
import {
  WORD_PLAIN_READ_KEYS,
  wordCompleteReadUnavailable,
  wordReadArgumentsRefusal,
  wordRefusalOffersPlainRead,
} from "./wordReadArguments";
import {
  wordReadFragments,
  wordReadJsonBytes,
  wordReadPageStarts,
  wordReadRecord,
} from "./wordReadFragments";
import { wordReadFreshness } from "./wordReadFreshness";
import { captureWordDocumentForRequest } from "./wordRequestCapture";
import { readWordSection } from "./wordSectionRead";
import { readWordTableCell } from "./wordTableCellRead";
import { readWordTargets } from "./wordTargetRead";

import type { WordReadAccess } from "./wordReadAccess";
import type { WordReadFragment, WordReadRecord } from "./wordReadFragments";
import type {
  WordFreshnessScope,
  WordReadCapture,
  WordReadOutcome,
} from "./wordReadFreshness";
import type {
  WordRequestCapture,
  WordVerifiedBody,
} from "./wordRequestCapture";
import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentCapture,
} from "@erato/frontend/word-review";

export { WORD_READ_TOOL };
export type { WordReadAccess };
const MAX_PAGES = 12;
const FIXABLE_READ_ISSUES = new Set([
  "read-arguments",
  "snapshot-mismatch",
  "target-arguments",
  "cell-read-arguments",
]);
interface Session {
  snapshot: WordAuthoringSnapshot;
  pages: WordReadFragment[][];
  cursors: string[];
  next: number;
  chatId: string | null;
}
export type WordDocumentReadRequest = Pick<
  ClientToolCallContext,
  "chatId" | "messageId"
>;

/** The pane has no read session for this request: it reloaded, a newer request from the pane
 * replaced it, or the request was not sent with the document. Said so the model can pass it on. */
export const WORD_NO_REQUEST_SESSION_MESSAGE =
  "The Word pane was reloaded, a newer request replaced this one, or this message wasn't sent with the document; send your request again from the Word pane.";

/** The complete-read budget check of a capture, kept for the captures an answer takes after it. */
export type WordReadBudgetFor = (
  snapshot: WordAuthoringSnapshot,
) => () => Promise<string | undefined>;

/** The copy an applied change leaves for the rest of its answer: reserved, read on first use. */
interface WordSuccessor {
  token: string;
  chatId: string;
  messageId: string;
  identity: string;
  access: WordReadAccess;
  requestText?: string;
  verified?: WordVerifiedBody;
  assets?: WordAuthoringSnapshot["assets"];
  imageAssetIssues?: WordAuthoringSnapshot["imageAssetIssues"];
}

export const WORD_SNAPSHOT_REPLACED = "snapshot-replaced";

/** A read of a copy an applied change used: not final, the answer reads the new copy instead. */
export const snapshotReplaced = (token: string): ClientToolExecutionResult => ({
  ok: false,
  error: `This copy was used by an applied change. Read again with snapshot ${token}.`,
  validationErrors: [
    {
      path: "/snapshot",
      code: WORD_SNAPSHOT_REPLACED,
      message: `This copy was used by an applied change. Read again with snapshot ${token}.`,
    },
  ],
});

/** A lost capture is final: a new request must capture the document again (contract §6). */
export const captureUnavailable = (): ClientToolExecutionResult => ({
  ok: false,
  error: "The document capture is no longer available.",
  validationErrors: [
    {
      path: "/snapshot",
      code: "capture-unavailable",
      message: "Start a new request with the document included.",
    },
  ],
  submissionFeedback: { terminal: true, recovery: "cannot_continue" },
});

export class WordDocumentReadSession {
  private session: Session | null = null;
  private access: WordReadAccess = "write";
  private readCapture?: WordReadCapture;
  private requestText?: string;
  private completeBudgetCheck?: () => Promise<string | undefined>;
  private completeBudget?: Promise<string | undefined>;
  private budgetFor?: WordReadBudgetFor;
  private successor: WordSuccessor | null = null;
  private successorCapture?: Promise<boolean>;
  /** Copies of this answer an applied change used, by token, with the message they belong to. */
  private replaced = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly liveCaptures = new WeakMap<
    WordAuthoringSnapshot,
    WordDocumentCapture
  >();
  readonly drafts = new WordDocumentDraftStore();
  constructor(
    private readonly captureForRequest: (
      identity: string,
      verified?: WordVerifiedBody,
    ) => Promise<WordRequestCapture | null> = captureWordDocumentForRequest,
  ) {}
  /** Cards redraw when the copy a plan was made on comes or goes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
  /** The live copy with this token, as a card's capture; none once a later copy replaced it. */
  liveCapture(token: string | undefined): WordDocumentCapture | undefined {
    const session = this.session;
    if (!token || !session || session.snapshot.token !== token)
      return undefined;
    const { snapshot } = session;
    let capture = this.liveCaptures.get(snapshot);
    if (!capture) {
      capture = {
        identity: snapshot.identity,
        authoring: snapshot,
        ordinalMap: this.readCapture?.ordinalMap ?? new Map(),
        paragraphsSent: 0,
        renderedOrdinals: new Set(),
        partialOrdinal: null,
      };
      this.liveCaptures.set(snapshot, capture);
    }
    return capture;
  }
  /** The read setting and request this answer's copy was taken with, for a successor. */
  get readAccess(): WordReadAccess {
    return this.access;
  }
  /**
   * After an apply: the copy it used is void, and the next read of this answer takes a new one.
   * Nothing is read from Word now; an answer that ends here never reads again.
   */
  reserveSuccessor(request: {
    chatId: string;
    messageId: string;
    identity: string;
    access?: WordReadAccess;
    requestText?: string;
    verified?: WordVerifiedBody;
  }): string {
    const token = globalThis.crypto.randomUUID();
    const current = this.session?.snapshot;
    if (current && current.ownerMessageId === request.messageId)
      this.replaced.set(current.token, request.messageId);
    if (this.successor?.messageId === request.messageId)
      this.replaced.set(this.successor.token, request.messageId);
    this.drafts.clear();
    this.successor = {
      token,
      chatId: request.chatId,
      messageId: request.messageId,
      identity: request.identity,
      access: request.access ?? this.access,
      requestText: request.requestText ?? this.requestText,
      verified: request.verified,
      assets: current?.assets,
      imageAssetIssues: current?.imageAssetIssues,
    };
    this.successorCapture = undefined;
    this.notify();
    return token;
  }
  /** Takes the reserved copy for a read of its answer; false when it cannot be read. */
  private takeSuccessor(
    context: ClientToolCallContext | undefined,
    request?: { chatId: string; messageId: string },
  ): Promise<boolean> | undefined {
    const successor = this.successor;
    const owner = request ?? context;
    if (
      !successor ||
      !owner ||
      owner.chatId !== successor.chatId ||
      owner.messageId !== successor.messageId
    )
      return undefined;
    this.successorCapture ??= this.captureSuccessor(successor);
    return this.successorCapture;
  }
  private async captureSuccessor(successor: WordSuccessor): Promise<boolean> {
    const taken = await this.captureForRequest(
      successor.identity,
      successor.verified,
    ).catch(() => null);
    if (this.successor !== successor) return false;
    if (!taken) {
      this.successor = null;
      this.successorCapture = undefined;
      return false;
    }
    const { snapshot, capture } = taken;
    snapshot.token = successor.token;
    if (!snapshot.issue) {
      snapshot.assets ??= successor.assets;
      snapshot.imageAssetIssues ??= successor.imageAssetIssues;
    }
    const replaced = this.replaced;
    const budgetFor = this.budgetFor;
    this.activate(
      snapshot,
      { chatId: successor.chatId, messageId: successor.messageId },
      budgetFor?.(snapshot),
      {
        access: successor.access,
        capture,
        request: successor.requestText,
        budgetFor,
      },
    );
    this.replaced = replaced;
    return true;
  }
  /** A read naming a copy of this answer that an applied change used. */
  private replacedRead(
    input: unknown,
    messageId: string | undefined,
  ): ClientToolExecutionResult | undefined {
    const { call } = wordReplayRecordRead(input);
    const token =
      call && typeof call === "object" && !Array.isArray(call)
        ? (call as Record<string, unknown>).snapshot
        : undefined;
    const current = this.session?.snapshot.token ?? this.successor?.token;
    if (
      typeof token !== "string" ||
      !current ||
      token === current ||
      !messageId ||
      this.replaced.get(token) !== messageId
    )
      return undefined;
    return snapshotReplaced(current);
  }
  /** The host binds ownership; model arguments cannot transfer a snapshot to another turn. */
  bindRequest(token: string, request: WordDocumentReadRequest): boolean {
    const session = this.session;
    if (
      !session ||
      session.snapshot.token !== token ||
      session.snapshot.revoked ||
      session.snapshot.used ||
      !request.chatId ||
      !request.messageId ||
      (session.snapshot.ownerMessageId &&
        (session.snapshot.ownerMessageId !== request.messageId ||
          session.chatId !== request.chatId))
    )
      return false;
    session.snapshot.ownerMessageId = request.messageId;
    session.chatId = request.chatId;
    return true;
  }
  /** Where the change journal stood when the session's capture was taken. */
  get capture(): WordReadCapture | undefined {
    return this.readCapture;
  }
  /** What the user asked when the capture was taken; part checks look for the sections it names. */
  get request(): string | undefined {
    return this.requestText;
  }
  snapshotForSubmission(
    context: ClientToolCallContext,
  ): WordAuthoringSnapshot | undefined {
    const session = this.session;
    return session?.snapshot.ownerMessageId === context.messageId &&
      session.chatId === context.chatId
      ? session.snapshot
      : undefined;
  }
  /** Why this request cannot make a complete read, if it cannot; the budget is checked once. */
  async completeReadIssue(): Promise<string | undefined> {
    if (this.session?.snapshot.completeReadIssue)
      return this.session.snapshot.completeReadIssue;
    if (!this.completeBudgetCheck) return undefined;
    this.completeBudget ??= this.completeBudgetCheck().catch(
      () => "budget-unavailable",
    );
    return this.completeBudget;
  }
  clear(): void {
    this.access = "write";
    this.readCapture = undefined;
    this.requestText = undefined;
    this.completeBudgetCheck = undefined;
    this.completeBudget = undefined;
    this.budgetFor = undefined;
    this.successor = null;
    this.successorCapture = undefined;
    this.replaced = new Map();
    this.drafts.clear();
    if (this.session) this.session.snapshot.revoked = true;
    this.session = null;
    this.notify();
  }
  activate(
    snapshot?: WordAuthoringSnapshot,
    request?: WordDocumentReadRequest,
    completeBudgetCheck?: () => Promise<string | undefined>,
    options?: {
      access?: WordReadAccess;
      capture?: WordReadCapture;
      request?: string;
      /** Checks the budget of the copies an applied change leaves for this answer. */
      budgetFor?: WordReadBudgetFor;
    },
  ): void {
    this.clear();
    if (!snapshot || isWordHistorySnapshot(snapshot)) return;
    this.budgetFor = options?.budgetFor;
    this.access = options?.access ?? "write";
    this.readCapture = options?.capture;
    this.requestText = options?.request;
    this.completeBudgetCheck = completeBudgetCheck;
    snapshot.revoked = false;
    snapshot.read.clear();
    snapshot.readScopes = new Map();
    snapshot.readToken = undefined;
    snapshot.ownerMessageId = undefined;
    const records: WordReadRecord[] = [
      ...snapshot.blocks.map(wordReadableSourceBlock).map(wordReadRecord),
      ...(snapshot.fullDocument
        ? (snapshot.stories ?? []).map(
            ({ xml, part: _part, nativeId: _nativeId, ...story }) => ({
              ref: `story_${story.id}`,
              type: "story" as const,
              protected: false,
              text: story.text,
              runs: undefined,
              structure: {
                story,
                ...wordSourceDetails(xml, `story_${story.id}`),
              },
            }),
          )
        : []),
      ...(snapshot.fullDocument && snapshot.sections?.length
        ? [
            {
              ref: "document_sections",
              type: "sections" as const,
              protected: false,
              text: "",
              runs: undefined,
              structure: {
                sections: snapshot.sections.map(
                  ({ xml: _xml, ...section }) => section,
                ),
              } as Record<string, unknown>,
            },
          ]
        : []),
    ];
    if (
      new TextEncoder().encode(JSON.stringify(records)).length >
      MAX_SOURCE_BYTES
    )
      snapshot.completeReadIssue = "too-large";
    const fragments = records.flatMap(wordReadFragments);
    const starts = wordReadPageStarts(fragments.map(wordReadJsonBytes));
    const pages: WordReadFragment[][] = starts.length
      ? starts.map((start, k) => fragments.slice(start, starts[k + 1]))
      : [[]];
    if (wordStyleNamesBytes(snapshot.styles) > 16384)
      snapshot.completeReadIssue = "too-large";
    if (pages.length > MAX_PAGES) snapshot.completeReadIssue = "too-large";
    this.session = {
      snapshot,
      pages,
      cursors: pages.map(() => globalThis.crypto.randomUUID()),
      next: 0,
      chatId: null,
    };
    if (request) this.bindRequest(snapshot.token, request);
    this.notify();
  }

  execute: ClientToolExecutor = (input, context) =>
    context?.hostGrant
      ? this.executeChildRead(input, context)
      : this.run(input, context, this.access);

  /**
   * A delegated task's call under the server's grant (contract §7): it reads the capture of the
   * turn that owns the grant, read-only, while that turn still holds it. The grant is checked
   * before the document approval, so a foreign or stale call never learns whether the document
   * changed. The server drops documentIdentity from the call, and the capture fills it and the
   * snapshot in.
   */
  executeChildRead: ClientToolExecutor = async (input, context) => {
    const grant = context?.hostGrant;
    if (grant)
      await this.takeSuccessor(undefined, {
        chatId: grant.ownerChatId,
        messageId: grant.ownerMessageId,
      });
    const session = this.session;
    if (
      !grant ||
      !context ||
      !session ||
      grant.requestingChatId !== context.chatId ||
      grant.requestingMessageId !== context.messageId ||
      session.snapshot.revoked ||
      session.snapshot.used ||
      // A task granted an earlier copy of the same answer reads the copy that replaced it.
      (grant.contextRef !== session.snapshot.token &&
        (!grant.contextRef ||
          this.replaced.get(grant.contextRef) !== grant.ownerMessageId)) ||
      !session.snapshot.ownerMessageId ||
      grant.ownerMessageId !== session.snapshot.ownerMessageId ||
      grant.ownerChatId !== session.chatId
    )
      return captureUnavailable();
    const approval = checkWordApprovalScope(grant);
    if (!approval.read) return approval.result;
    const { snapshot } = session;
    const { hostGrant: _grant, ...call } = context;
    // Filled into the read the call means, so a replay record still reads as one.
    const { call: read } = wordReplayRecordRead(input);
    const filled =
      read && typeof read === "object" && !Array.isArray(read)
        ? {
            ...read,
            snapshot: snapshot.token,
            documentIdentity: snapshot.identity,
          }
        : read;
    return this.executeReadOnly(
      read === input ? filled : { ...(input as object), kept: filled },
      { ...call, chatId: grant.ownerChatId, messageId: grant.ownerMessageId },
    );
  };

  /** Reads read-only whatever the session's access, as a call under a host grant must. */
  executeReadOnly: ClientToolExecutor = (input, context) =>
    this.run(input, context, "read-only");

  private async run(
    input: unknown,
    context: ClientToolCallContext | undefined,
    sessionAccess: WordReadAccess,
  ): Promise<ClientToolExecutionResult> {
    const pending = this.takeSuccessor(context);
    if (pending && !(await pending))
      return {
        ok: false,
        error: WORD_NO_REQUEST_SESSION_MESSAGE,
        validationErrors: [
          {
            path: "/snapshot",
            code: "read-unavailable",
            message: WORD_NO_REQUEST_SESSION_MESSAGE,
          },
        ],
        submissionFeedback: { terminal: true, recovery: "cannot_continue" },
      };
    const replaced = this.replacedRead(input, context?.messageId);
    if (replaced) return replaced;
    const { call, replayRecord } = wordReplayRecordRead(input);
    const access =
      call && typeof call === "object" && "section" in call
        ? "read-only"
        : sessionAccess;
    const capture = context && this.snapshotForSubmission(context);
    const { result, scope } = await this.executeRead(
      call,
      context,
      access,
      replayRecord,
    );
    if (result.ok) {
      if (
        capture &&
        context &&
        this.snapshotForSubmission(context) === capture &&
        !capture.used &&
        !capture.revoked &&
        !context.signal?.aborted
      ) {
        const fresh = scope
          ? this.withFreshness(result, capture, scope)
          : result;
        return access === "read-only" ? withReadOnlyFields(fresh) : fresh;
      }
      return captureUnavailable();
    }
    const snapshot = context && this.snapshotForSubmission(context);
    if (
      !snapshot ||
      snapshot.used ||
      snapshot.revoked ||
      wordReadRefusedByIssue(snapshot, access) ||
      context?.signal?.aborted
    ) {
      return {
        ...result,
        submissionFeedback: { terminal: true, recovery: "cannot_continue" },
      };
    }
    return result;
  }

  /** Every read response says which capture it read and what Word reported changed since. */
  private withFreshness(
    result: ClientToolExecutionResult,
    snapshot: WordAuthoringSnapshot,
    scope: WordFreshnessScope,
  ): ClientToolExecutionResult {
    if (
      !result.ok ||
      !result.result ||
      typeof result.result !== "object" ||
      Array.isArray(result.result)
    )
      return result;
    return {
      ...result,
      result: {
        ...result.result,
        freshness: wordReadFreshness(snapshot, this.readCapture, scope),
      },
    };
  }

  private async executeRead(
    input: unknown,
    context: ClientToolCallContext | undefined,
    access: WordReadAccess,
    replayRecord: boolean,
  ): Promise<WordReadOutcome> {
    const session = this.session;
    const fail = (error: string, code: string, path = "/snapshot") => ({
      result: {
        ok: false as const,
        error,
        validationErrors: [{ path, code, message: error }],
      },
    });
    if (!context || context.signal?.aborted)
      return fail("Document read unavailable or stopped.", "read-unavailable");
    if (!session)
      return fail(WORD_NO_REQUEST_SESSION_MESSAGE, "read-unavailable");
    const { snapshot } = session;
    // Reject stale SSE ownership before disclosing a read token.
    if (
      !snapshot.ownerMessageId ||
      snapshot.ownerMessageId !== context.messageId ||
      session.chatId !== context.chatId
    )
      return fail(WORD_NO_REQUEST_SESSION_MESSAGE, "wrong-request");
    const plainAvailable = async () =>
      access !== "read-only" &&
      !snapshot.revoked &&
      !snapshot.used &&
      !snapshot.issue &&
      !(await this.completeReadIssue());
    const refuse = async (issue: {
      path: string;
      code: string;
      message: string;
    }) =>
      wordReadArgumentsRefusal(snapshot, input, {
        plainAvailable:
          wordRefusalOffersPlainRead(input) && (await plainAvailable()),
        replayRecord,
        issue,
      });
    // Refusals a corrected call gets past; they say how.
    const withFix = async (read: WordReadOutcome) => {
      const issue = read.result.ok
        ? undefined
        : read.result.validationErrors?.[0];
      return issue && FIXABLE_READ_ISSUES.has(issue.code)
        ? refuse(issue)
        : read;
    };
    if (!input || typeof input !== "object" || Array.isArray(input))
      return refuse({
        path: "",
        code: "read-arguments",
        message: "Expected a snapshot token and optional cursor.",
      });
    const args = input as Record<string, unknown>;
    if ("section" in args) return withFix(readWordSection(snapshot, args));
    if ("target" in args)
      return withFix(readWordTargets(snapshot, args, access));
    if ("table_cell" in args) {
      if (
        snapshot.revoked ||
        snapshot.used ||
        wordReadRefusedByIssue(snapshot, access)
      )
        return fail(
          "This capture is unavailable; use a fresh request or the existing complete-read workflow.",
          snapshot.issue ??
            (snapshot.used ? "snapshot-used" : "snapshot-revoked"),
        );
      return withFix(readWordTableCell(snapshot, args, access));
    }
    if (access === "read-only")
      return fail(
        "A read-only read cannot page the complete document. Read its parts with section:{ref} pages, following nextCursor, or with target, target.queries or table_cell.",
        "read-only-complete",
      );

    if (
      Object.keys(args).some((k) => !WORD_PLAIN_READ_KEYS.includes(k)) ||
      typeof args.snapshot !== "string" ||
      !args.snapshot ||
      args.snapshot.length > 128 ||
      (args.cursor !== undefined &&
        args.cursor !== null &&
        typeof args.cursor !== "string")
    )
      return refuse({
        path: "",
        code: "read-arguments",
        message:
          "Expected a snapshot token and optional string or null cursor; no other arguments are supported.",
      });
    if (snapshot.revoked || snapshot.used)
      return fail(
        "This document capture has been used or revoked. A new request with the document included must capture the updated document before further editing.",
        snapshot.used ? "snapshot-used" : "snapshot-revoked",
      );
    if (snapshot.issue)
      return fail(
        `Whole-body authoring unavailable: ${snapshot.issue}${snapshot.issueDetails?.length ? ` (${snapshot.issueDetails.join(", ")})` : ""}. No document changes were made.`,
        snapshot.issue,
      );
    if (snapshot.completeReadIssue)
      return wordCompleteReadUnavailable(snapshot, snapshot.completeReadIssue);
    if (this.completeBudgetCheck) {
      const issue = await this.completeReadIssue();
      if (
        this.session !== session ||
        snapshot.revoked ||
        snapshot.used ||
        context.signal?.aborted
      )
        return fail("Document read stopped or expired.", "read-unavailable");
      if (issue) return wordCompleteReadUnavailable(snapshot, issue);
    }
    const firstPage = args.cursor == null || args.cursor === "";
    const snapshotChanged = args.snapshot !== snapshot.token;
    const restart = `Restart read_document_blocks with ${JSON.stringify({ snapshot: snapshot.token, cursor: null })}. Use the snapshot, source refs, cursors and readToken returned by that read.`;
    // The first page can refresh an expired snapshot; continuation pages must use the same version.
    if (snapshotChanged && !firstPage)
      return fail(restart, "snapshot-mismatch");
    const index = firstPage ? 0 : session.cursors.indexOf(String(args.cursor));
    if (index < 0 || index > session.next)
      return fail(restart, "read-cursor", "/cursor");
    for (const b of session.pages[index])
      if (b.part === b.parts) snapshot.read.add(b.ref);
    session.next = Math.max(session.next, index + 1);
    const complete = session.next === session.pages.length;
    if (complete) snapshot.readToken ??= globalThis.crypto.randomUUID();
    return {
      scope: { kind: "document" },
      result: {
        ok: true,
        result: {
          snapshot: snapshot.token,
          ...(snapshotChanged
            ? {
                snapshotRecovery: {
                  requestedSnapshot: args.snapshot,
                  restarted: true,
                },
              }
            : {}),
          scope: snapshot.fullDocument ? "document" : "body",
          blocks: session.pages[index],
          ...(index === 0
            ? {
                styles: wordReadableStyles(snapshot.styles),
                limits: {
                  maxSourceBytes: MAX_SOURCE_BYTES,
                  maxPages: MAX_PAGES,
                  maxPlanBytes: MAX_PLAN_BYTES,
                  maxOutputBlocks: MAX_DOCUMENT_BLOCKS,
                  maxNestedDepth: 12,
                  ...(snapshot.fullDocument
                    ? { maxDocumentFileBytes: MAX_WORD_DOCX_BYTES }
                    : {}),
                },
                supportedBlocks: [
                  "paragraph",
                  "heading",
                  "list-item",
                  "table",
                  "image",
                  "drawing",
                  "field",
                  "bookmark",
                  "content-control",
                  "native-edit",
                ],
                contract: wordAuthoringContract(),
                fullDocument: !!snapshot.fullDocument,
                assets: (snapshot.assets ?? []).map(wordImageAssetMetadata),
                imageAssetIssues: (snapshot.imageAssetIssues ?? []).map(
                  ({ name, reason }) => ({ name, reason }),
                ),
                nativeContent:
                  "Native body source operations: keep, replace, deleted. Object metadata is JSON fragmented into structureJson, ordered by structurePart for each ref. Object selectors and sourceRef identify captured content. Explicit sections replaces section boundaries. Story and section edits require scope=document and fullDocument=true. Source XML and binary data remain on the host.",
                preservedStories: snapshot.preservedStories ?? [],
              }
            : {}),
          blocksRead: snapshot.read.size,
          blocksTotal: wordSourceReadRefs(snapshot).length,
          nextCursor: session.cursors[index + 1] ?? null,
          complete,
          ...(complete ? { readToken: snapshot.readToken } : {}),
        },
      },
    };
  }
}

export const wordDocumentReadSession = new WordDocumentReadSession();
