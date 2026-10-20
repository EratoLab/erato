import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import {
  AttachmentIcon,
  CalendarIcon,
  ChatBubbleIcon,
  ChatLinesIcon,
  EditIcon,
  MailIcon,
  PageIcon,
  QuoteIcon,
  TimerIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@/components/ui/icons";

import type {
  ComposerContextIconName,
  ComposerContextState,
  ComposerContextTone,
} from "./types";
import type { ComponentType } from "react";

const GLYPHS: Record<
  ComposerContextIconName,
  ComponentType<{ className?: string }>
> = {
  document: PageIcon,
  selection: QuoteIcon,
  comment: ChatBubbleIcon,
  comments: ChatLinesIcon,
  mail: MailIcon,
  draft: EditIcon,
  calendar: CalendarIcon,
  attachment: AttachmentIcon,
  chats: ChatBubbleIcon,
  file: PageIcon,
  clock: TimerIcon,
};

const isIconName = (icon: string): icon is ComposerContextIconName =>
  Object.prototype.hasOwnProperty.call(GLYPHS, icon);

export const resolveComposerContextTone = (
  state: ComposerContextState,
  tone: ComposerContextTone | undefined,
): ComposerContextTone =>
  tone ??
  (state === "error" ? "error" : state === "attention" ? "warning" : "neutral");

interface ComposerContextGlyphProps {
  icon: string;
  state: ComposerContextState;
  tone: ComposerContextTone;
  toneIcon?: "item" | "tone";
}

/**
 * The chip's leading glyph: the item's own icon, or the state's when the state
 * says more (a spinner while loading, a warning or error mark for an error or
 * a choice). A tone alone, such as an included document with a warning, keeps
 * the item's icon unless the item asks for the tone's mark. Always hidden from
 * screen readers; the open button carries the state in words.
 */
export const ComposerContextGlyph = ({
  icon,
  state,
  tone,
  toneIcon = "item",
}: ComposerContextGlyphProps) => {
  if (state === "loading") {
    return <SpinnerIcon size="sm" aria-hidden="true" />;
  }
  const marked =
    state === "error" ||
    state === "attention" ||
    (toneIcon === "tone" && (tone === "warning" || tone === "error"));
  const errorMark = state === "error" ? tone !== "warning" : tone === "error";
  const Glyph = !marked
    ? GLYPHS[isIconName(icon) ? icon : "file"]
    : errorMark
      ? WarningCircleIcon
      : WarningIcon;
  return (
    <span aria-hidden="true" className="inline-flex">
      <Glyph className="size-4" />
    </span>
  );
};
