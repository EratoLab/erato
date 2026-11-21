import {
  MAX_SOURCE_BYTES,
  MAX_PLAN_BYTES,
  MAX_DOCUMENT_BLOCKS,
  wordSourceReadRefs,
  wordImageAssetMetadata,
  wordSourceDetails,
  isWordHistorySnapshot,
  WORD_READ_TOOL,
} from "@erato/frontend/word-review";

import { checkWordApprovalScope } from "./wordApprovalScope";
import { WORD_AUTHORING_CONTRACT } from "./wordAuthoringContract";
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
  wordReplayRecordRead,
} from "./wordReadArguments";
import {
  wordReadFragments,
  wordReadJsonBytes,
  wordReadPageStarts,
  wordReadRecord,
} from "./wordReadFragments";
import { wordReadFreshness } from "./wordReadFreshness";
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
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

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
  private completeBudgetCheck?: () => Promise<string | undefined>;
  private completeBudget?: Promise<string | undefined>;
  readonly drafts = new WordDocumentDraftStore();
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
  snapshotForSubmission(
    context: ClientToolCallContext,
  ): WordAuthoringSnapshot | undefined {
    const session = this.session;
    return session?.snapshot.ownerMessageId === context.messageId &&
      session.chatId === context.chatId
      ? session.snapshot
      : undefined;
  }
  /** Why this request's model budget refuses the complete read, checked once per request. */
  private completeBudgetIssue(): Promise<string | undefined> {
    if (!this.completeBudgetCheck) return Promise.resolve(undefined);
    this.completeBudget ??= this.completeBudgetCheck().catch(
      () => "budget-unavailable",
    );
    return this.completeBudget;
  }
  clear(): void {
    this.access = "write";
    this.readCapture = undefined;
    this.completeBudgetCheck = undefined;
    this.completeBudget = undefined;
    this.drafts.clear();
    if (this.session) this.session.snapshot.revoked = true;
    this.session = null;
  }
  activate(
    snapshot?: WordAuthoringSnapshot,
    request?: WordDocumentReadRequest,
    completeBudgetCheck?: () => Promise<string | undefined>,
    options?: { access?: WordReadAccess; capture?: WordReadCapture },
  ): void {
    this.clear();
    if (!snapshot || isWordHistorySnapshot(snapshot)) return;
    this.access = options?.access ?? "write";
    this.readCapture = options?.capture;
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
    const session = this.session;
    if (
      !grant ||
      !context ||
      !session ||
      grant.requestingChatId !== context.chatId ||
      grant.requestingMessageId !== context.messageId ||
      session.snapshot.revoked ||
      session.snapshot.used ||
      grant.contextRef !== session.snapshot.token ||
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
      !snapshot.completeReadIssue &&
      !(await this.completeBudgetIssue());
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
      const issue = await this.completeBudgetIssue();
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
                contract: WORD_AUTHORING_CONTRACT,
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
