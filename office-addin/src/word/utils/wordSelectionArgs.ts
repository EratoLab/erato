import { cutToUtf8Bytes } from "./buildWordDocumentArgs";
import { wordEmphasisWords } from "./wordSelectionFormatSpans";
import { wordMarkerText } from "./wordSelectionItems";
import {
  ACTION_FACET_ARG_MAX_BYTES,
  advertisedFacetArgs,
  utf8ByteLength,
} from "../../core/clientActions/actionFacetArgs";

import type { WordSelectionSnapshot } from "./wordSelectionAnchor";
import type { WordKeptItemKind } from "./wordSelectionItems";

/**
 * The word_selection facet's allowed_args, frozen by the owner (decision 1). The subscription
 * config test pins the same list; removing a key later fails requests from deployed add-ins.
 */
export const WORD_SELECTION_ARG_KEYS = [
  "document_name",
  "document_identity",
  "selected_text",
  "selection_role",
  "context_reason",
  "selection_shape",
  "selection_story",
  "paragraph_count",
  "style_names",
  "context_before",
  "context_after",
  "truncated",
  "kept_items",
] as const;

export type WordSelectionArgKey = (typeof WORD_SELECTION_ARG_KEYS)[number];

/**
 * Keeps whole lines, one per paragraph. Only a first paragraph that alone exceeds the limit is cut
 * inside, as the document context does, so the model is not left with nothing.
 */
export function fitWordSelectionText(
  text: string,
  maxBytes: number = ACTION_FACET_ARG_MAX_BYTES,
): { text: string; truncated: boolean } {
  if (utf8ByteLength(text) <= maxBytes) return { text, truncated: false };
  const lines = text.split("\n");
  let used = 0;
  let kept = 0;
  for (const line of lines) {
    const cost = utf8ByteLength(line) + (kept === 0 ? 0 : 1);
    if (used + cost > maxBytes) break;
    used += cost;
    kept += 1;
  }
  return {
    text:
      kept === 0
        ? cutToUtf8Bytes(lines[0], maxBytes)
        : lines.slice(0, kept).join("\n"),
    truncated: true,
  };
}

export interface WordSelectionArgsInput {
  documentName: string;
  documentIdentity: string;
  selection: WordSelectionSnapshot;
}

/**
 * Every key is filled, empty when it does not apply, so the template never shows a literal
 * placeholder; keys the server does not advertise are dropped.
 */
export function wordSelectionFacetArgs(
  input: WordSelectionArgsInput,
  allowedArgs: ReadonlySet<string> | undefined,
): Record<string, string> {
  const { selection } = input;
  const selected = fitWordSelectionText(selection.selectedText);
  const args: Record<WordSelectionArgKey, string> = {
    document_name: input.documentName,
    document_identity: input.documentIdentity,
    selected_text: selected.text,
    selection_role: selection.role,
    context_reason: selection.reasonCode ?? "",
    selection_shape: selection.shape,
    selection_story: selection.story,
    paragraph_count: String(selection.paragraphCount),
    style_names: fitWordSelectionText(
      selection.paragraphs.map((p) => p.styleName).join("\n"),
    ).text,
    context_before: selection.contextBefore,
    context_after: selection.contextAfter,
    truncated: String(selection.truncated || selected.truncated),
    kept_items: wordKeptItemsArg(selection),
  };
  return advertisedFacetArgs(args, allowedArgs);
}

const KEPT_ITEM_NAMES: Readonly<Record<WordKeptItemKind, string>> = {
  field: "a field",
  link: "a link",
  note: "a footnote or endnote reference",
  comment: "a comment",
  picture: "a picture",
  break: "a line break",
  control: "a content control",
  bookmark: "a bookmark",
};

/**
 * One line per marker in selected_text, saying what it stands for: an item the rewrite keeps where
 * the marker is, or a format span whose text keeps its formatting (ERMAIN-943). Empty when nothing
 * is marked. The Erato web app parses these lines to label the markers of a stored chat (frontend
 * wordSelectionReply.ts), so changing them needs both sides.
 */
export function wordKeptItemsArg(selection: WordSelectionSnapshot): string {
  const lines: { number: number; line: string }[] = [];
  const said = new Set<number>();
  for (const p of selection.paragraphs) {
    for (const marker of p.kept?.markers ?? []) {
      if (said.has(marker.number)) continue;
      said.add(marker.number);
      const name = KEPT_ITEM_NAMES[marker.kind];
      const both = (p.kept?.markers ?? []).filter(
        (m) => m.number === marker.number,
      ).length;
      const shown = marker.shows.replace(/[\u0000-\u001F]/g, "");
      lines.push({
        number: marker.number,
        line:
          marker.end === "point"
            ? `${wordMarkerText(marker)} ${name}${shown ? ` showing "${shown}"` : ""}`
            : both === 2
              ? `${wordMarkerText(marker)}…${wordMarkerText({ ...marker, end: "close" })} ${name} around the text between; that text may change`
              : marker.end === "open"
                ? `${wordMarkerText(marker)} where ${name} starts; it runs on past the selection`
                : `${wordMarkerText(marker)} where ${name} that started before the selection ends`,
      });
    }
    for (const span of p.formats?.spans ?? [])
      lines.push({
        number: span.number,
        line: `${wordMarkerText({ number: span.number, end: "open" })}…${wordMarkerText({ number: span.number, end: "close" })} formatting: ${wordEmphasisWords(span.emphasis).join(", ")}`,
      });
  }
  return lines
    .sort((a, b) => a.number - b.number)
    .map(({ line }) => line)
    .join("\n");
}
