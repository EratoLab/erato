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
  wordReadFragments,
  wordReadJsonBytes,
  wordReadPageStarts,
  wordReadRecord,
} from "./wordReadFragments";
import { wordReadFreshness, wordResultBlocks } from "./wordReadFreshness";
import { readWordSection, wordSectionReadExtent } from "./wordSectionRead";
import { readWordTableCell } from "./wordTableCellRead";
import { readWordTargets } from "./wordTargetRead";

import type { WordReadAccess } from "./wordReadAccess";
import type { WordReadFragment, WordReadRecord } from "./wordReadFragments";
import type { WordReadCapture, WordReadScope } from "./wordReadFreshness";
import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

export { WORD_READ_TOOL };
export type { WordReadAccess };
const MAX_PAGES = 12;
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

export class WordDocumentReadSession {
  private session: Session | null = null;
  private access: WordReadAccess = "write";
  private capture?: WordReadCapture;
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
  snapshotForSubmission(
    context: ClientToolCallContext,
  ): WordAuthoringSnapshot | undefined {
    const session = this.session;
    return session?.snapshot.ownerMessageId === context.messageId &&
      session.chatId === context.chatId
      ? session.snapshot
      : undefined;
  }
  clear(): void {
    this.access = "write";
    this.capture = undefined;
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
    this.capture = options?.capture;
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
    this.run(input, context, this.access);

  /** Reads read-only whatever the session's access, as a call under a host grant must. */
  executeReadOnly: ClientToolExecutor = (input, context) =>
    this.run(input, context, "read-only");

  private async run(
    input: unknown,
    context: ClientToolCallContext | undefined,
    sessionAccess: WordReadAccess,
  ): Promise<ClientToolExecutionResult> {
    const access =
      input && typeof input === "object" && "section" in input
        ? "read-only"
        : sessionAccess;
    const capture = context && this.snapshotForSubmission(context);
    const result = await this.executeRead(input, context, access);
    if (result.ok) {
      if (
        capture &&
        context &&
        this.snapshotForSubmission(context) === capture &&
        !capture.used &&
        !capture.revoked &&
        !context.signal?.aborted
      ) {
        const fresh = this.withFreshness(result, input, capture);
        return access === "read-only" ? withReadOnlyFields(fresh) : fresh;
      }
      return {
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
      };
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
    input: unknown,
    snapshot: WordAuthoringSnapshot,
  ): ClientToolExecutionResult {
    if (
      !result.ok ||
      result.disposition === "local_only" ||
      !result.result ||
      typeof result.result !== "object" ||
      Array.isArray(result.result)
    )
      return result;
    const args = input as Record<string, unknown>;
    const section = args.section as Record<string, unknown> | undefined;
    const scope: WordReadScope = section
      ? (wordSectionReadExtent(snapshot, section.ref, section.throughRef) ?? {
          kind: "blocks",
          blocks: new Set(),
        })
      : "target" in args || "table_cell" in args
        ? { kind: "blocks", blocks: wordResultBlocks(snapshot, result.result) }
        : { kind: "document" };
    return {
      ...result,
      result: {
        ...result.result,
        freshness: wordReadFreshness(snapshot, this.capture, scope),
      },
    };
  }

  private async executeRead(
    input: unknown,
    context: ClientToolCallContext | undefined,
    access: WordReadAccess,
  ): Promise<ClientToolExecutionResult> {
    const session = this.session;
    const fail = (error: string, code: string, path = "/snapshot") => ({
      ok: false as const,
      error,
      validationErrors: [{ path, code, message: error }],
    });
    if (!session || !context || context.signal?.aborted)
      return fail("Document read unavailable or stopped.", "read-unavailable");
    const { snapshot } = session;
    // Reject stale SSE ownership before disclosing a read token.
    if (
      !snapshot.ownerMessageId ||
      snapshot.ownerMessageId !== context.messageId ||
      session.chatId !== context.chatId
    )
      return fail(
        "This request has no document capture of its own. A new request with the document included is required.",
        "wrong-request",
      );
    if (!input || typeof input !== "object" || Array.isArray(input))
      return fail(
        "Expected a snapshot token and optional cursor.",
        "read-arguments",
        "",
      );
    const args = input as Record<string, unknown>;
    if ("section" in args) return readWordSection(snapshot, args);
    if ("target" in args) return readWordTargets(snapshot, args, access);
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
      return readWordTableCell(snapshot, args, access);
    }
    if (access === "read-only")
      return fail(
        "A read-only read cannot page the complete document. Read its parts with section:{ref} pages, following nextCursor, or with target, target.queries or table_cell.",
        "read-only-complete",
      );

    if (
      Object.keys(args).some((k) => k !== "snapshot" && k !== "cursor") ||
      typeof args.snapshot !== "string" ||
      !args.snapshot ||
      args.snapshot.length > 128 ||
      (args.cursor !== undefined &&
        args.cursor !== null &&
        typeof args.cursor !== "string")
    )
      return fail(
        "Expected a snapshot token and optional string or null cursor; no other arguments are supported.",
        "read-arguments",
        "",
      );
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
      return fail(
        "This document is too large for a complete read, so whole-document plans and repairs are unavailable. Read the sections the request needs with section:{ref} pages from the Outline, following nextCursor; use target, target.queries or table_cell only for what you edit, and submit scoped_edit or table_cell changes. No document changes were made.",
        snapshot.completeReadIssue,
      );
    if (this.completeBudgetCheck) {
      this.completeBudget ??= this.completeBudgetCheck().catch(
        () => "budget-unavailable",
      );
      const issue = await this.completeBudget;
      if (
        this.session !== session ||
        snapshot.revoked ||
        snapshot.used ||
        context.signal?.aborted
      )
        return fail("Document read stopped or expired.", "read-unavailable");
      if (issue)
        return fail(
          "The complete read is unavailable within this request's model budget. Scoped reads remain available.",
          issue,
        );
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
    };
  }
}

export const wordDocumentReadSession = new WordDocumentReadSession();
