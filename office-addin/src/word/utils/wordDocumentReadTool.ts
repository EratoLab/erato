import { WORD_AUTHORING_CONTRACT } from "./wordAuthoringContract";
import { wordReadableSourceBlock } from "./wordAuthoringReadData";
import { MAX_WORD_DOCX_BYTES } from "./wordDocumentPackageCodec";
import {
  MAX_SOURCE_BYTES,
  MAX_PLAN_BYTES,
  MAX_DOCUMENT_BLOCKS,
  wordSourceReadRefs,
} from "./wordDocumentPlan";
import { wordImageAssetMetadata } from "./wordImageAssetData";
import { wordSourceDetails } from "./wordRichContent";

import type { WordAuthoringSnapshot, WordPlanRun } from "./wordDocumentPlan";
import type {
  ClientToolCallContext,
  ClientToolExecutor,
} from "@erato/frontend/library";

export const WORD_READ_TOOL = "read_document_blocks";
const PAGE_BYTES = 20 * 1024;
const MAX_PAGES = 12;
interface Fragment {
  ref: string;
  type: string;
  level?: number;
  styleRef?: string;
  protected: boolean;
  part: number;
  parts: number;
  text: string;
  runs?: WordPlanRun[];
  nativeKind?: string;
  description?: string;
  sectionBoundary?: boolean;
  structureJson?: string;
  structurePart?: number;
  structureParts?: number;
}
interface Session {
  snapshot: WordAuthoringSnapshot;
  pages: Fragment[][];
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
    if (this.session) this.session.snapshot.revoked = true;
    this.session = null;
  }
  activate(
    snapshot?: WordAuthoringSnapshot,
    request?: WordDocumentReadRequest,
  ): void {
    this.clear();
    if (!snapshot) return;
    snapshot.revoked = false;
    snapshot.read.clear();
    snapshot.readToken = undefined;
    snapshot.ownerMessageId = undefined;
    const pages: Fragment[][] = [[]];
    const records = [
      ...snapshot.blocks
        .map(wordReadableSourceBlock)
        .map(({ content, objects, format, ...b }) => ({
          ...b,
          structure: {
            ...(content ? { content } : {}),
            ...(objects ? { objects } : {}),
            ...(format ? { format } : {}),
          },
        })),
      ...(snapshot.fullDocument
        ? (snapshot.stories ?? []).map(
            ({ xml, part: _part, nativeId: _nativeId, ...story }) => ({
              ref: `story_${story.id}`,
              type: "story",
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
              type: "sections",
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
      snapshot.issue = "too-large";
    for (const { text, runs, structure, ...block } of records) {
      const chars = Array.from(text);
      const fragments: Fragment[] = [];
      let offset = 0,
        codeUnitOffset = 0;
      do {
        let end = Math.min(chars.length, offset + 4096);
        let fragment: Fragment;
        while (true) {
          const piece = chars.slice(offset, end).join("");
          let position = 0;
          const pieceRuns = runs?.flatMap((r) => {
            const start = Math.max(0, codeUnitOffset - position);
            const until = Math.min(
              r.text.length,
              codeUnitOffset + piece.length - position,
            );
            position += r.text.length;
            return until > start
              ? [{ ...r, text: r.text.slice(start, until) }]
              : [];
          });
          fragment = {
            ...block,
            text: piece,
            ...(pieceRuns ? { runs: pieceRuns } : {}),
            part: fragments.length + 1,
            parts: 0,
          };
          if (
            new TextEncoder().encode(JSON.stringify(fragment)).length <=
              PAGE_BYTES ||
            end <= offset + 1
          )
            break;
          end = offset + Math.max(1, Math.floor((end - offset) / 2));
        }
        fragments.push(fragment);
        codeUnitOffset += fragment.text.length;
        offset = end;
      } while (offset < chars.length);
      if (Object.keys(structure).length) {
        const data = Array.from(JSON.stringify(structure));
        const count = Math.ceil(data.length / 2048);
        for (let part = 0; part < count; part++)
          fragments.push({
            ref: block.ref,
            type: block.type,
            protected: false,
            text: "",
            part: fragments.length + 1,
            parts: 0,
            structureJson: data.slice(part * 2048, (part + 1) * 2048).join(""),
            structurePart: part + 1,
            structureParts: count,
          });
      }
      for (const fragment of fragments) {
        fragment.parts = fragments.length;
        let page = pages[pages.length - 1];
        if (
          new TextEncoder().encode(JSON.stringify([...page, fragment])).length >
            PAGE_BYTES &&
          page.length
        ) {
          page = [];
          pages.push(page);
        }
        page.push(fragment);
      }
    }
    if (
      new TextEncoder().encode(JSON.stringify(snapshot.styles)).length > 16384
    )
      snapshot.issue = "too-large";
    if (pages.length > MAX_PAGES) snapshot.issue = "too-large";
    this.session = {
      snapshot,
      pages,
      cursors: pages.map(() => globalThis.crypto.randomUUID()),
      next: 0,
      chatId: null,
    };
    if (request) this.bindRequest(snapshot.token, request);
  }

  execute: ClientToolExecutor = async (input, context) => {
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
              styles: snapshot.styles,
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
  };
}

export const wordDocumentReadSession = new WordDocumentReadSession();
