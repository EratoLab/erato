import { useCallback, useEffect, useRef, useState } from "react";

import { buildWordDocumentArgs } from "../utils/buildWordDocumentArgs";
import { readWordDocument } from "../utils/readWordDocument";
import { captureWordAuthoringSnapshot } from "../utils/wordDocumentXml";

import type {
  WordDocumentBuild,
  WordDocumentCoverage,
} from "../utils/buildWordDocumentArgs";
import type { WordAuthoringSnapshot } from "../utils/wordDocumentPlan";

export type WordDocumentStatus =
  /** No read has completed yet. */
  | "unknown"
  /** The read failed or the host was unavailable. */
  | "unreadable"
  /** Readable, but no paragraph carries text. */
  | "empty"
  /** Readable, with content. */
  | "included";

export interface WordDocumentPreview {
  authoringIssue?: WordAuthoringSnapshot["issue"];
  authoringDetails?: string[];
  status: WordDocumentStatus;
  /** null until a read has completed, or when the read failed. */
  coverage: WordDocumentCoverage | null;
  /** The document changed since the last send in this chat. */
  changedSinceLastSend: boolean;
}

export interface WordDocumentSource {
  preview: WordDocumentPreview;
  /**
   * The authoritative send-time read. Always reads fresh — the facet rides
   * every send while the chip is on, so there is no de-dup and no cache.
   * Resolves to null when the document could not be read.
   */
  capture: () => Promise<WordDocumentBuild | null>;
}

/** FNV-1a. Only ever compared against itself, to label "changed since last send". */
function hashDocument(text: string, total: number): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${total}:${(hash >>> 0).toString(16)}`;
}

/**
 * The pane's view of the open document: a cheap read for the chip's label, and
 * the authoritative read that produces the facet arguments at send time.
 *
 * The labelling read runs when the chip is switched on and when the pane
 * regains focus. There is deliberately no `onParagraphAdded` /
 * `onParagraphChanged` wiring: v1 needs a "changed since last send" label, not
 * a live indicator, and the change hash is NEVER a reason to skip a send.
 */
export function useWordDocumentSource({
  enabled,
  documentIdentity,
  authoringEnabled = false,
}: {
  enabled: boolean;
  documentIdentity: string;
  authoringEnabled?: boolean;
}): WordDocumentSource {
  const [preview, setPreview] = useState<WordDocumentPreview>({
    status: "unknown",
    coverage: null,
    changedSinceLastSend: false,
  });
  const lastSentHashRef = useRef<string | null>(null);
  // Focus and chip-on can land together; a second read while one is in flight
  // buys nothing and would race the state it writes.
  const inFlightRef = useRef(false);
  // A labelling read started before a send can resolve after it. Without a
  // ticket the older, successful result would overwrite the send's verdict and
  // the chip would claim the document was included when it was not.
  const readSeqRef = useRef(0);

  const read = useCallback(
    async (includeAuthoring = false): Promise<WordDocumentBuild | null> => {
      readSeqRef.current += 1;
      const ticket = readSeqRef.current;
      const result = await readWordDocument(includeAuthoring);
      const isLatest = () => readSeqRef.current === ticket;
      if (!result.ok) {
        if (isLatest()) {
          setPreview({
            status: "unreadable",
            coverage: null,
            changedSinceLastSend: false,
          });
        }
        return null;
      }
      const build = buildWordDocumentArgs(result.paragraphs);
      if (result.authoring) {
        build.authoring = captureWordAuthoringSnapshot(
          result.authoring.ooxml,
          documentIdentity,
          result.authoring.tracking,
          result.authoring.fullDocument,
        );
        build.authoring.documentUrl = result.authoring.documentUrl;
        // The native inventory also contains tables and anchored ranges. It is
        // authoritative for structural plans; it cannot be compared one-for-one
        // with Word's paragraph collection. Bind navigation only when exact and
        // unambiguous. The live native package is checked again before writing.
        for (const block of build.authoring.blocks) {
          if (block.type === "native") continue;
          const matches = result.paragraphs.filter(
            (p) => p.text === block.text,
          );
          if (
            matches.length === 1 &&
            build.authoring.blocks.filter((b) => b.text === block.text)
              .length === 1
          )
            block.paragraphOrdinal = matches[0].ordinal;
        }
      }
      const hash = hashDocument(
        build.args.document_text,
        build.coverage.paragraphsTotal,
      );
      if (isLatest()) {
        setPreview({
          authoringIssue: build.authoring?.issue,
          authoringDetails: build.authoring?.issueDetails,
          status: build.coverage.hasContent ? "included" : "empty",
          coverage: build.coverage,
          changedSinceLastSend:
            lastSentHashRef.current !== null &&
            lastSentHashRef.current !== hash,
        });
      }
      return build;
    },
    [documentIdentity],
  );

  const refresh = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void read().finally(() => {
      inFlightRef.current = false;
    });
  }, [read]);

  // A different document means a different pane session: the counts, the
  // status and the "changed" baseline all belong to the old one.
  useEffect(() => {
    lastSentHashRef.current = null;
    setPreview({
      status: "unknown",
      coverage: null,
      changedSinceLastSend: false,
    });
  }, [documentIdentity]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    globalThis.addEventListener("focus", refresh);
    return () => globalThis.removeEventListener("focus", refresh);
  }, [enabled, refresh, documentIdentity]);

  const capture = useCallback(async () => {
    const build = await read(authoringEnabled);
    lastSentHashRef.current = build
      ? hashDocument(build.args.document_text, build.coverage.paragraphsTotal)
      : null;
    // The label states what the send actually carried, so a "changed" flag
    // raised before the send must not survive it.
    setPreview((previous) =>
      previous.changedSinceLastSend
        ? { ...previous, changedSinceLastSend: false }
        : previous,
    );
    return build;
  }, [read, authoringEnabled]);

  return { preview, capture };
}
