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
  | "unknown"
  | "unreadable"
  | "empty"
  | "included";

export interface WordDocumentPreview {
  authoringIssue?: WordAuthoringSnapshot["issue"];
  authoringDetails?: string[];
  status: WordDocumentStatus;
  coverage: WordDocumentCoverage | null;
  changedSinceLastSend: boolean;
}

export interface WordDocumentSource {
  preview: WordDocumentPreview;
  capture: () => Promise<WordDocumentBuild | null>;
}

/** Only for UI change detection; never use this hash to authorize a write. */
function hashDocument(text: string, total: number): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${total}:${(hash >>> 0).toString(16)}`;
}

/** Label reads are advisory; each send captures fresh document state. */
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
  const inFlightRef = useRef(false);
  // Ignore older label reads that finish after a newer send has reported its result.
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
        // Native body blocks exclude table-cell paragraphs and can group anchored ranges.
        // Their count cannot be used as a paragraph collection ordinal.
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
    setPreview((previous) =>
      previous.changedSinceLastSend
        ? { ...previous, changedSinceLastSend: false }
        : previous,
    );
    return build;
  }, [read, authoringEnabled]);

  return { preview, capture };
}
