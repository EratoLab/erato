import { i18n } from "@lingui/core";
import { useMemo } from "react";

import { toolCallCardOf } from "./gist";
import { gistAskLineSlots } from "./gistLabels";
import { isRecord } from "./serverText";

import type { ToolCallCard } from "./gist";
import type {
  ToolCallLabel,
  ToolDisplayMetadata,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The descriptor as the cards render it: text fields only when they are
 * text, so a row from another writer cannot put an object into the page.
 */
export const approvalDisplayOf = (
  display: unknown,
  toolName: string,
): ToolDisplayMetadata | null => {
  if (!isRecord(display)) return null;
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  return {
    title: text(display.title) ?? toolName,
    description: text(display.description),
    description_truncated: display.description_truncated === true,
    server_name: text(display.server_name),
    label: display.label as ToolCallLabel | undefined,
  };
};

/** The card for a label, with the values its line names in the language shown. */
export const useToolCallCard = (
  label: ToolCallLabel | undefined,
  input: unknown,
): ToolCallCard => {
  const locale = i18n.locale;
  return useMemo(
    () => toolCallCardOf(label, input, gistAskLineSlots),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the line's words, and so which values it names, follow the locale
    [label, input, locale],
  );
};

/** An approval's descriptor and the card its label gives, as the referent renders them. */
export const useApprovalCard = (
  display: unknown,
  toolName: string,
  input: unknown,
): { display: ToolDisplayMetadata | null; card: ToolCallCard } => {
  const shown = useMemo(
    () => approvalDisplayOf(display, toolName),
    [display, toolName],
  );
  return { display: shown, card: useToolCallCard(shown?.label, input) };
};
