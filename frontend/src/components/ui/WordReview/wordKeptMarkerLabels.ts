import { t } from "@lingui/core/macro";

import { replaceWordMarkers } from "@/lib/wordReview/wordSelectionReply";

import type {
  WordKeptItemKind,
  WordKeptItemNotes,
} from "@/lib/wordReview/wordSelectionReply";

function wordKeptItemName(kind: WordKeptItemKind): string {
  switch (kind) {
    case "field":
      return t({ id: "wordReview.selection.item.field", message: "field" });
    case "link":
      return t({ id: "wordReview.selection.item.link", message: "link" });
    case "note":
      return t({ id: "wordReview.selection.item.note", message: "note" });
    case "comment":
      return t({ id: "wordReview.selection.item.comment", message: "comment" });
    case "picture":
      return t({ id: "wordReview.selection.item.picture", message: "picture" });
    case "break":
      return t({
        id: "wordReview.selection.item.break",
        message: "line break",
      });
    case "control":
      return t({
        id: "wordReview.selection.item.control",
        message: "content control",
      });
    case "bookmark":
      return t({
        id: "wordReview.selection.item.bookmark",
        message: "bookmark",
      });
  }
}

/** One of kept_items' words for a format span's emphasis; others as they are. */
function wordFormattingName(word: string): string {
  switch (word) {
    case "bold":
      return t({ id: "wordReview.selection.format.bold", message: "bold" });
    case "not bold":
      return t({
        id: "wordReview.selection.format.notBold",
        message: "not bold",
      });
    case "italic":
      return t({ id: "wordReview.selection.format.italic", message: "italic" });
    case "not italic":
      return t({
        id: "wordReview.selection.format.notItalic",
        message: "not italic",
      });
    case "underline":
      return t({
        id: "wordReview.selection.format.underline",
        message: "underline",
      });
    case "no underline":
      return t({
        id: "wordReview.selection.format.noUnderline",
        message: "no underline",
      });
    case "strikethrough":
      return t({
        id: "wordReview.selection.format.strikethrough",
        message: "strikethrough",
      });
    case "no strikethrough":
      return t({
        id: "wordReview.selection.format.noStrikethrough",
        message: "no strikethrough",
      });
    default:
      return word;
  }
}

/**
 * Each marker labelled as the add-in's card labels it: a point by what it
 * shows, else by its kind; a span's ends as [kind] … [/kind], a format span's
 * as [bold] … [/bold]. A marker that kept_items does not explain gets a
 * numbered label.
 */
export function wordKeptMarkersLabelled(
  text: string,
  notes: WordKeptItemNotes,
): string {
  return replaceWordMarkers(text, (number, close) => {
    const note = notes.get(number);
    const name = !note
      ? t({
          id: "wordReview.selection.item.numbered",
          message: `item ${number}`,
        })
      : note.kind === "format"
        ? (note.formatting ?? []).map(wordFormattingName).join(", ")
        : wordKeptItemName(note.kind);
    if (close) return `[/${name}]`;
    return note?.point && note.shows ? `[${note.shows}]` : `[${name}]`;
  });
}
