import { spokenNamesFor } from "@/lib/toolCallGist/spokenNames";
import { spokenReadFactsOf } from "@/lib/toolCallGist/spokenRead";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Templates from the deployment, per language: `{search}` or `{table}`. */
export interface ToolLineTemplates {
  search?: string;
  items?: string;
  list?: string;
}

/** Longer than this, a line is not a short line; the server refuses it. */
export const MAX_TOOL_LINE_CHARS = 160;

const fill = (template: string, slot: string, value: string) =>
  template.replace(`{${slot}}`, value);

/**
 * The line a running tool call gets, from what its label says it reads:
 * the search text, or what the records are called in the server's spoken
 * vocabulary. A call that writes, or whose label names neither, gets none:
 * the voice never guesses what a call does.
 */
export function toolWaitLine(
  label: ToolCallLabel | null | undefined,
  language: string,
  templates: ToolLineTemplates,
): string | undefined {
  const names = spokenNamesFor(label, language);
  const facts = spokenReadFactsOf(label, undefined, undefined, names);
  if (!facts) return undefined;
  let line: string | undefined;
  const searchText =
    facts.search && "text" in facts.search
      ? facts.search.text.trim()
      : undefined;
  if (facts.shape === "search" && searchText && templates.search) {
    line = fill(templates.search, "search", searchText);
  } else if (facts.things) {
    const template = facts.shape === "list" ? templates.list : templates.items;
    if (template) line = fill(template, "table", facts.things);
  }
  if (!line) return undefined;
  line = line.replace(/\s+/g, " ").trim();
  return line.length > 0 && line.length <= MAX_TOOL_LINE_CHARS
    ? line
    : undefined;
}
