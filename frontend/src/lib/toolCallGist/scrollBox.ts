import { t } from "@lingui/core/macro";

export type ScrollBoxKind =
  | "card"
  | "line"
  | "value"
  | "arguments"
  | "description";

const scrollBoxLabel = (kind: ScrollBoxKind): string => {
  switch (kind) {
    case "card":
      return t({
        id: "toolGist.scrollBox.card",
        message: "Scrollable details of this call",
      });
    case "line":
      return t({
        id: "toolGist.scrollBox.line",
        message: "Scrollable summary of this call",
      });
    case "value":
      return t({
        id: "toolGist.scrollBox.value",
        message: "Scrollable value",
      });
    case "arguments":
      return t({
        id: "toolGist.scrollBox.arguments",
        message: "Scrollable arguments of this call",
      });
    case "description":
      return t({
        id: "toolGist.scrollBox.description",
        message: "Scrollable tool description",
      });
  }
};

/** The ring is inset so an outer scroll box does not clip it. */
export const SCROLL_BOX_CLASS = "focus-ring-inset overflow-y-auto";

/**
 * What lets a keyboard reach and name a box that scrolls on an approval card.
 * A group, not a region: a batch can hold many, and each region would be a
 * landmark.
 */
export const scrollBoxProps = (kind: ScrollBoxKind) => ({
  role: "group",
  tabIndex: 0,
  "aria-label": scrollBoxLabel(kind),
});
