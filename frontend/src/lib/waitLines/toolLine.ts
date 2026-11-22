import { spokenNamesFor } from "@/lib/toolCallGist/spokenNames";
import { spokenReadFactsOf } from "@/lib/toolCallGist/spokenRead";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Templates from the deployment, per language: `{search}`, `{table}` or
 * `{server}`.
 */
export interface ToolLineTemplates {
  search?: string;
  items?: string;
  list?: string;
  server?: string;
}

/** Longer than this, a line is not a short line; the server refuses it. */
export const MAX_TOOL_LINE_CHARS = 160;
/**
 * A search text said in a wait line: a line that has started is finished
 * before the answer plays, so a long one would hold the answer back.
 */
export const MAX_SEARCH_WORDS = 6;

const fill = (template: string, slot: string, value: string) =>
  template.replace(`{${slot}}`, value);

/**
 * The line a running tool call gets, from what its label says it reads:
 * the search text, or what the records are called in the server's spoken
 * vocabulary. A long search text is never cut short; it gives way to the
 * table, or to the server line. That one only names the server, and only
 * for a call the backend found to do nothing but read (`readOnlyServer`,
 * the server's name, given only for a display marked `plain_read`). A call
 * that writes gets none: the voice never guesses what a call does.
 */
export function toolWaitLine(
  label: ToolCallLabel | null | undefined,
  language: string,
  templates: ToolLineTemplates,
  readOnlyServer?: string,
): string | undefined {
  const names = spokenNamesFor(label, language);
  const facts = spokenReadFactsOf(label, undefined, undefined, names);
  let line: string | undefined;
  if (facts) {
    const searchText =
      facts.search && "text" in facts.search
        ? facts.search.text.trim()
        : undefined;
    const searchWords = searchText?.split(/\s+/).filter(Boolean).length ?? 0;
    if (
      facts.shape === "search" &&
      searchText &&
      searchWords <= MAX_SEARCH_WORDS &&
      templates.search
    ) {
      line = fill(templates.search, "search", searchText);
    } else if (facts.things) {
      const template =
        facts.shape === "list" ? templates.list : templates.items;
      if (template) line = fill(template, "table", facts.things);
    }
  }
  const server = readOnlyServer?.trim();
  if (!line && label && server && templates.server) {
    line = fill(templates.server, "server", server);
  }
  if (!line) return undefined;
  line = line.replace(/\s+/g, " ").trim();
  return line.length > 0 && line.length <= MAX_TOOL_LINE_CHARS
    ? line
    : undefined;
}
