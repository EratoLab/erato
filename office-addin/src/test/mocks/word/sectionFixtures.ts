import { expect } from "vitest";

import { packageXml } from "./authoringFixtures";
import { escapeXml } from "../../../utils/escapeXml";
import { WordDocumentReadSession } from "../../../word/utils/wordDocumentReadTool";

import type { WordReadAccess } from "../../../word/utils/wordReadAccess";
import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordSourceBlock,
} from "@erato/frontend/word-review";

export type SectionBlock = Omit<WordSourceBlock, "ref" | "xml" | "protected">;

const CLAUSES = [
  "The Supplier shall provide the Services with the care of a prudent merchant and in accordance with the Service Levels set out in Schedule 2.",
  "Any change to the scope of the Services requires a written Change Request signed by both Parties before work on it begins.",
  "Fees are invoiced monthly in arrears and fall due thirty days after receipt of a correct invoice.",
  "The Customer may audit the Supplier's compliance once per contract year on four weeks' notice.",
  "Neither Party is liable for indirect or consequential loss, except in cases of intent or gross negligence.",
  "Personal data is processed only on documented instructions of the Customer and within the European Economic Area.",
];

/** Body text of about `bytes` UTF-8 bytes, from varied contract clauses. */
export function clauseText(seed: number, bytes = 360): string {
  let text = "";
  for (let k = seed; text.length < bytes; k++)
    text += (text ? " " : "") + CLAUSES[k % CLAUSES.length];
  return text.slice(0, bytes);
}

export const heading = (level: number, text: string): SectionBlock => ({
  type: "heading",
  level,
  styleRef: `Heading${level}`,
  text,
});
export const body = (text: string): SectionBlock => ({
  type: "paragraph",
  text,
});
export function table(rows: string[][]): SectionBlock {
  return {
    type: "native",
    nativeKind: "table",
    text: rows.map((r) => r.join("\t")).join("\n"),
    content: {
      columns: rows[0].map(() => 2400),
      format: {},
      sourcePatchSupported: true,
      rows: rows.map((cells, sourceIndex) => ({
        sourceIndex,
        format: {},
        cells: cells.map((text, cellIndex) => ({
          sourceIndex: cellIndex,
          text,
          blocks: [
            { id: `c${sourceIndex}_${cellIndex}`, type: "paragraph", text },
          ],
        })),
      })),
    },
  };
}

/** A chapter: its heading, subsections with clause paragraphs and one small table, about `kib` KiB of read form. */
export function chapter(
  n: number,
  kib: number,
  subsections = 3,
): SectionBlock[] {
  const blocks: SectionBlock[] = [heading(1, `${n}. Chapter ${n}`)];
  const paragraphs = Math.max(1, Math.round((kib * 1024) / 420));
  const per = Math.ceil(paragraphs / subsections);
  for (let s = 1; s <= subsections; s++) {
    blocks.push(heading(2, `${n}.${s} Section ${n}.${s}`));
    for (let p = 0; p < per; p++)
      blocks.push(body(clauseText(n * 31 + s * 7 + p)));
    if (s === 1)
      blocks.push(
        table([
          ["Service", "Level"],
          [`Service ${n}`, "99.5 %"],
        ]),
      );
  }
  return blocks;
}

/** A snapshot built straight from blocks, as a capture would read them. */
export function sectionSnapshot(
  blocks: SectionBlock[],
  extra: Partial<WordAuthoringSnapshot> = {},
): WordAuthoringSnapshot {
  return {
    token: `snapshot-${globalThis.crypto.randomUUID()}`,
    identity: "doc-sections",
    ooxml: "",
    fingerprint: "fingerprint",
    blocks: blocks.map((b, i) => ({
      ...b,
      ref: `b${i + 1}`,
      protected: false,
      xml: "",
    })),
    styles: [
      { id: "Normal", name: "Normal", type: "paragraph", default: true },
      { id: "Heading1", name: "heading 1", type: "paragraph" },
      { id: "Heading2", name: "heading 2", type: "paragraph" },
    ],
    read: new Set(),
    revoked: false,
    used: false,
    ...extra,
  };
}

/** The same blocks as a Word package, for captures that must accept a plan. Tables become paragraphs. */
export function sectionPackageXml(blocks: SectionBlock[]): string {
  return packageXml(
    blocks
      .map((b) => {
        const style =
          b.type === "heading"
            ? `<w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>`
            : "";
        return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(b.text.replace(/\n/g, " "))}</w:t></w:r></w:p>`;
      })
      .join(""),
  );
}

export const readContext = {
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: "r",
};

/** A read session on the snapshot, owned by readContext; calls fill in snapshot and documentIdentity. */
export function openReadSession(
  snapshot: WordAuthoringSnapshot,
  access?: WordReadAccess,
) {
  const session = new WordDocumentReadSession();
  session.activate(
    snapshot,
    readContext,
    undefined,
    access ? { access } : undefined,
  );
  const args = (extra: Record<string, unknown>) => ({
    snapshot: snapshot.token,
    documentIdentity: snapshot.identity,
    ...extra,
  });
  return {
    session,
    execute: (extra: Record<string, unknown>) =>
      session.execute(args(extra), readContext),
    readOnly: (extra: Record<string, unknown>) =>
      session.executeReadOnly(args(extra), readContext),
  };
}

export function okResult<T = Record<string, unknown>>(
  response: ClientToolExecutionResult,
): T {
  expect(response.ok, JSON.stringify(response).slice(0, 400)).toBe(true);
  if (!response.ok) throw new Error(response.error);
  return response.result as T;
}

export const writeState = (snapshot: WordAuthoringSnapshot) => ({
  readScopes: snapshot.readScopes?.size ?? 0,
  read: snapshot.read.size,
  readToken: snapshot.readToken,
  used: snapshot.used,
});
export const untouchedWriteState = {
  readScopes: 0,
  read: 0,
  readToken: undefined,
  used: false,
};
