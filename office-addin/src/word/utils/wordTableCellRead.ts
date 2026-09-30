import { cutToUtf8Bytes } from "./buildWordDocumentArgs";
import { WORD_AUTHORING_CONTRACT } from "./wordAuthoringContract";
import { MAX_WORD_SCOPES } from "./wordReadScope";
import {
  expandWordTableCellSubmission,
  WordTableCellSubmissionError,
} from "./wordTableCellSubmission";

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { WordTableCellScope } from "./wordTableCellScope";
import type { ClientToolExecutionResult } from "@erato/frontend/library";

const PAGE_SIZE = 5;
const CELL_BYTES = 4096;
const SNIPPET_BYTES = 256;

const encoder = new TextEncoder();
const normalize = (text: string) =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const snippet = (text: string) => {
  let bounded = cutToUtf8Bytes(text, SNIPPET_BYTES);
  while (encoder.encode(JSON.stringify(bounded)).length > SNIPPET_BYTES)
    bounded = cutToUtf8Bytes(
      bounded,
      Math.floor(encoder.encode(bounded).length / 2),
    );
  return { text: bounded, truncated: bounded !== text };
};

/** Snapshot-only discovery and authorization: no Office, network or live-document access. */
export function readWordTableCell(
  snapshot: WordAuthoringSnapshot,
  input: Record<string, unknown>,
): ClientToolExecutionResult {
  const fail = (code: string, message: string): ClientToolExecutionResult => ({
    ok: false,
    error: message,
    validationErrors: [{ path: "/table_cell", code, message }],
  });
  if (snapshot.revoked || snapshot.used || snapshot.issue)
    return fail(
      "snapshot-unavailable",
      "Use the current request's active, available snapshot.",
    );
  if (
    input.snapshot !== snapshot.token ||
    input.documentIdentity !== snapshot.identity
  )
    return fail(
      "snapshot-mismatch",
      "Targeted reads require the exact snapshot and documentIdentity from this request; they do not refresh old references.",
    );
  const query = input.table_cell;
  const textKeys = ["nearbyText", "header", "rowLabel", "text", "sourceRef"];
  const indexKeys = ["rowIndex", "cellIndex", "offset"];
  if (
    Object.keys(input).some(
      (k) => !["snapshot", "documentIdentity", "table_cell"].includes(k),
    ) ||
    !object(query) ||
    !Object.keys(query).length ||
    Object.keys(query).some((k) => ![...textKeys, ...indexKeys].includes(k)) ||
    textKeys.some(
      (k) =>
        query[k] !== undefined &&
        (typeof query[k] !== "string" ||
          query[k].length > 256 ||
          (k !== "text" && !normalize(query[k]))),
    ) ||
    indexKeys.some((k) => query[k] !== undefined && !integer(query[k])) ||
    !textKeys.some((k) => query[k] !== undefined) ||
    ((query.rowIndex !== undefined || query.cellIndex !== undefined) &&
      !query.sourceRef)
  )
    return fail(
      "cell-read-arguments",
      "Supply one or more bounded text filters; sourceRef is required with original rowIndex/cellIndex. offset pages candidates, never document blocks.",
    );

  const matches: {
    sourceRef: string;
    rowIndex: number;
    cellIndex: number;
    text: string;
    header: string;
    rowLabel: string;
    before: string;
    after: string;
  }[] = [];
  const contains = (value: string, key: string) =>
    query[key] === undefined ||
    normalize(value).includes(normalize(query[key] as string));
  for (const [position, block] of snapshot.blocks.entries()) {
    const content = block.content;
    if (
      !content ||
      (query.sourceRef !== undefined && query.sourceRef !== block.ref)
    )
      continue;
    const before = snapshot.blocks[position - 1]?.text ?? "";
    const after = snapshot.blocks[position + 1]?.text ?? "";
    if (!contains(before + "\n" + after, "nearbyText")) continue;
    for (const row of content.rows) {
      if (query.rowIndex !== undefined && row.sourceIndex !== query.rowIndex)
        continue;
      const rowLabel = row.cells[0]?.text ?? "";
      if (!contains(rowLabel, "rowLabel")) continue;
      for (const cell of row.cells) {
        if (
          query.cellIndex !== undefined &&
          cell.sourceIndex !== query.cellIndex
        )
          continue;
        const header =
          content.rows[0]?.cells.find((c) => c.sourceIndex === cell.sourceIndex)
            ?.text ?? "";
        if (!contains(header, "header") || !contains(cell.text, "text"))
          continue;
        matches.push({
          sourceRef: block.ref,
          rowIndex: row.sourceIndex,
          cellIndex: cell.sourceIndex,
          text: cell.text,
          header,
          rowLabel,
          before,
          after,
        });
      }
    }
  }
  const offset = (query.offset as number | undefined) ?? 0;
  if (offset > 0 && offset >= matches.length)
    return fail(
      "cell-read-offset",
      "offset must identify a page of the current query's matches.",
    );
  const result = {
    snapshot: snapshot.token,
    documentIdentity: snapshot.identity,
    scope: "table-cell",
    totalMatches: matches.length,
    candidates: matches
      .slice(offset, offset + PAGE_SIZE)
      .map(({ text, header, rowLabel, before, after, ...refs }) => ({
        ...refs,
        text: snippet(text),
        header: snippet(header),
        rowLabel: snippet(rowLabel),
        before: snippet(before),
        after: snippet(after),
      })),
    nextOffset: offset + PAGE_SIZE < matches.length ? offset + PAGE_SIZE : null,
    limits: {
      candidates: PAGE_SIZE,
      snippetBytes: SNIPPET_BYTES,
      cellBytes: CELL_BYTES,
    },
  };
  if (matches.length !== 1)
    return {
      ok: true,
      result: { ...result, status: matches.length ? "ambiguous" : "not-found" },
    };
  const match = matches[0];
  if (encoder.encode(match.text).length > CELL_BYTES)
    return {
      ok: true,
      result: {
        ...result,
        status: "unsupported",
        reason: "cell-context-limit",
        fallback: "complete-read",
      },
    };
  const scope: WordTableCellScope = {
    kind: "table-cell",
    snapshot: snapshot.token,
    identity: snapshot.identity,
    fingerprint: snapshot.fingerprint,
    sourceRef: match.sourceRef,
    rowIndex: match.rowIndex,
    cellIndex: match.cellIndex,
    expectedText: match.text,
  };
  // Validate eligibility through the same concise operation as submission. The
  // provisional capability is isolated until all exact target context can be returned.
  const readToken = globalThis.crypto.randomUUID();
  try {
    expandWordTableCellSubmission(
      {
        snapshot: snapshot.token,
        readToken,
        table_cell: {
          sourceRef: scope.sourceRef,
          rowIndex: scope.rowIndex,
          cellIndex: scope.cellIndex,
          expectedText: scope.expectedText,
          text: scope.expectedText,
        },
      },
      { ...snapshot, readScopes: new Map([[readToken, scope]]) },
    );
  } catch (error) {
    if (!(error instanceof WordTableCellSubmissionError)) throw error;
    return {
      ok: true,
      result: {
        ...result,
        status: "unsupported",
        reason: error.code,
        fallback: "complete-read",
      },
    };
  }
  snapshot.readScopes ??= new Map();
  if (snapshot.readScopes.size >= MAX_WORD_SCOPES)
    return fail(
      "cell-read-limit",
      "This request has reached its scoped-read capability limit; use a complete read or a fresh request.",
    );
  snapshot.readScopes.set(readToken, scope);
  return {
    ok: true,
    result: {
      ...result,
      status: "ready",
      readToken,
      target: {
        sourceRef: scope.sourceRef,
        rowIndex: scope.rowIndex,
        cellIndex: scope.cellIndex,
        expectedText: scope.expectedText,
      },
      contract: { tableCell: WORD_AUTHORING_CONTRACT.tableCell },
    },
  };
}
