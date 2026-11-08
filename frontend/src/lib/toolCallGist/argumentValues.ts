import { isConsentClaim } from "./consent";
import {
  cleanServerText,
  countOf,
  isRecord,
  jsonPreview,
  lastPointerSegment,
  MAX_ARGUMENT_VALUE_CHARS,
  MAX_SERVER_TEXT_CHARS,
  pointerSegments,
  readPointer,
} from "./serverText";

import type { CleanText } from "./serverText";
import type { ToolArgumentNode } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** What an approval card shows of each argument value, by its path. */
export type ArgumentTexts = ReadonlyMap<string, CleanText>;

// Bounds the work for a label that lists the same long value many times.
const MAX_CARD_VALUE_CHARS = 200_000;

/** The characters an approval card has left to show values whole. */
export interface ValueBudget {
  left: number;
}

export const valueBudget = (): ValueBudget => ({ left: MAX_CARD_VALUE_CHARS });

const valueText = (value: unknown, maxChars: number): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return jsonPreview(value, maxChars);
};

/**
 * A value as an approval card shows it: whole up to
 * `MAX_ARGUMENT_VALUE_CHARS`, and once the card's budget is spent, its start.
 */
export const wholeValue = (raw: unknown, budget: ValueBudget): CleanText => {
  const maxChars = Math.min(
    MAX_ARGUMENT_VALUE_CHARS,
    Math.max(MAX_SERVER_TEXT_CHARS, budget.left),
  );
  const cleaned = cleanServerText(valueText(raw, maxChars), maxChars);
  budget.left -= cleaned.text.length;
  return cleaned;
};

export interface ArgumentValues {
  texts: ArgumentTexts;
  /** Whether a value is longer than the card shows. */
  cut: boolean;
  /** Whether cleaning removed hidden characters from a value or a name. */
  hiddenCharacters: boolean;
}

/**
 * The values of every argument a view lists, read from `input` once each.
 * Consent flags are skipped, as the view leaves them out.
 */
export const readArgumentValues = (
  view: ToolArgumentNode | undefined,
  input: unknown,
  budget: ValueBudget,
): ArgumentValues => {
  const texts = new Map<string, CleanText>();
  let cut = false;
  let hiddenCharacters = false;
  const visit = (node: ToolArgumentNode) => {
    if (isConsentClaim(node.path)) return;
    if (cleanServerText(lastPointerSegment(node.path)).hiddenCharacters) {
      hiddenCharacters = true;
    }
    if (node.kind === "group" || node.kind === "list") {
      for (const child of node.children ?? []) visit(child);
      return;
    }
    if (texts.has(node.path)) return;
    const text = wholeValue(readPointer(input, node.path), budget);
    texts.set(node.path, text);
    cut ||= text.truncated;
    hiddenCharacters ||= text.hiddenCharacters;
  };
  if (view) visit(view);
  return { texts, cut, hiddenCharacters };
};

/** Whether a view lists a consent flag, which a card leaves out. */
export const holdsConsentFlag = (view: ToolArgumentNode): boolean =>
  isConsentClaim(view.path) || (view.children ?? []).some(holdsConsentFlag);

/**
 * Whether the backend left a member of the call out of the view without
 * counting it as omitted, as it does the server's configured approval
 * argument: Erato sets that one from the user's decision.
 */
export const viewLeavesOutMembers = (
  view: ToolArgumentNode,
  input: unknown,
): boolean => {
  if (view.path !== "" || view.kind !== "group" || !isRecord(input)) {
    return false;
  }
  const listed = new Set(
    (view.children ?? []).flatMap((child) => {
      const segments = pointerSegments(child.path);
      return segments.length === 1 ? segments : [];
    }),
  );
  const omitted = countOf(view.omitted);
  let unlisted = 0;
  for (const name in input) {
    if (!Object.hasOwn(input, name) || listed.has(name)) continue;
    unlisted += 1;
    if (unlisted > omitted) return true;
  }
  return false;
};
