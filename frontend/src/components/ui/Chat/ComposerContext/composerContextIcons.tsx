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
}

/**
 * The chip's leading glyph: the item's own icon, or the state's when the state
 * says more (a spinner while loading, a warning or error mark for an error or
 * a choice). A tone alone, such as an included document with a warning, keeps
 * the item's icon. Always hidden from screen readers; the open button carries
 * the state in words.
 */
export const ComposerContextGlyph = ({
  icon,
  state,
  tone,
}: ComposerContextGlyphProps) => {
  if (state === "loading") {
    return <SpinnerIcon size="sm" aria-hidden="true" />;
  }
  const Glyph =
    state === "error"
      ? tone === "warning"
        ? WarningIcon
        : WarningCircleIcon
      : state === "attention"
        ? tone === "error"
          ? WarningCircleIcon
          : WarningIcon
        : GLYPHS[isIconName(icon) ? icon : "file"];
  return (
    <span aria-hidden="true" className="inline-flex">
      <Glyph className="size-4" />
    </span>
  );
};
