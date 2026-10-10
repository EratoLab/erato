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

/**
 * Each marker labelled as the add-in's card labels it: a point by what it
 * shows, else by its kind; a span's ends as [kind] … [/kind]. A marker that
 * kept_items does not explain gets a numbered label.
 */
export function wordKeptMarkersLabelled(
  text: string,
  notes: WordKeptItemNotes,
): string {
  return replaceWordMarkers(text, (number, close) => {
    const note = notes.get(number);
    const name = note
      ? wordKeptItemName(note.kind)
      : t({
          id: "wordReview.selection.item.numbered",
          message: `item ${number}`,
        });
    if (close) return `[/${name}]`;
    return note?.point && note.shows ? `[${note.shows}]` : `[${name}]`;
  });
}
