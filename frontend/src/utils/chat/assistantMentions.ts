export interface AssistantMention {
  id: string;
  name: string;
}

export interface MentionTrigger {
  query: string;
  /** Index of the `@` in the full text, not in the slice passed to the detector. */
  startIndex: number;
}

export interface MentionRange {
  start: number;
  /** Exclusive, so `text.slice(start, end)` is the whole `@Name` token. */
  end: number;
  id: string;
  name: string;
}

/**
 * Requiring start-or-whitespace before the `@` is what keeps `a@b.com` from
 * opening the picker; excluding `@` from the query keeps a second `@` from
 * re-arming it mid-address. The length cap bounds how far a stray `@` can keep
 * the picker alive while the user types prose.
 */
const MENTION_TRIGGER = /(^|\s)@([^\s@]{0,40})$/;

export function mentionToken(name: string): string {
  return `@${name}`;
}

export function detectMentionTrigger(
  textBeforeCaret: string,
): MentionTrigger | null {
  const match = MENTION_TRIGGER.exec(textBeforeCaret);
  if (!match) {
    return null;
  }
  return {
    query: match[2],
    startIndex: match.index + match[1].length,
  };
}

export function applyMentionSelection(
  text: string,
  caret: number,
  trigger: MentionTrigger,
  assistantName: string,
): { text: string; caret: number } {
  const before = text.slice(0, trigger.startIndex);
  const rest = text.slice(caret);
  const token = `${mentionToken(assistantName)} `;
  const after = rest.startsWith(" ") ? rest.slice(1) : rest;
  return {
    text: `${before}${token}${after}`,
    caret: before.length + token.length,
  };
}

function isAtWordStart(text: string, index: number): boolean {
  return index === 0 || /\s/.test(text[index - 1]);
}

/**
 * Punctuation ends a mention (`@Data, please`), a further letter does not:
 * `@Bobby` names nobody when only "Bob" is tracked. Asymmetric with the leading
 * side on purpose — there only whitespace may precede, or `me@Data` would count.
 */
function isAtWordEnd(text: string, index: number): boolean {
  return index >= text.length || !/[\p{L}\p{N}_]/u.test(text[index]);
}

function trackedKey(mention: AssistantMention): string {
  return JSON.stringify([mention.id, mention.name]);
}

/**
 * Where each tracked mention stands in the text, in text order and without
 * overlaps. Matching the longest names first is what makes `@Data Analyst`
 * claim the span before "Data" can, so the composer highlight and the submitted
 * ids are two readings of one result rather than two rules that can drift.
 */
export function findMentionRanges(
  text: string,
  tracked: AssistantMention[],
): MentionRange[] {
  const ranges: MentionRange[] = [];
  const byNameLength = [...tracked].sort(
    (a, b) => b.name.length - a.name.length,
  );

  for (const mention of byNameLength) {
    const token = mentionToken(mention.name);
    let searchFrom = 0;
    for (;;) {
      const start = text.indexOf(token, searchFrom);
      if (start < 0) {
        break;
      }
      searchFrom = start + 1;
      const end = start + token.length;
      const overlapsClaimed = ranges.some(
        (range) => start < range.end && end > range.start,
      );
      if (
        !overlapsClaimed &&
        isAtWordStart(text, start) &&
        isAtWordEnd(text, end)
      ) {
        ranges.push({ start, end, id: mention.id, name: mention.name });
      }
    }
  }

  return ranges.sort((a, b) => a.start - b.start);
}

/** The mentions the composer should submit: tracked order, deduped, text wins. */
export function resolveMentionedAssistants(
  text: string,
  tracked: AssistantMention[],
): AssistantMention[] {
  const present = new Set(
    findMentionRanges(text, tracked).map((range) => range.id),
  );
  const mentions: AssistantMention[] = [];
  const seen = new Set<string>();
  for (const mention of tracked) {
    if (seen.has(mention.id) || !present.has(mention.id)) {
      continue;
    }
    seen.add(mention.id);
    mentions.push(mention);
  }
  return mentions;
}

/** The ids the composer should submit: tracked order, deduped, text wins. */
export function resolveMentionedAssistantIds(
  text: string,
  tracked: AssistantMention[],
): string[] {
  return resolveMentionedAssistants(text, tracked).map((mention) => mention.id);
}

/**
 * Returns the same array reference when nothing was dropped, so callers can
 * feed the result straight back into state without looping.
 */
export function pruneTrackedMentions(
  text: string,
  tracked: AssistantMention[],
): AssistantMention[] {
  const present = new Set(findMentionRanges(text, tracked).map(trackedKey));
  const seen = new Set<string>();
  const next = tracked.filter((mention) => {
    const key = trackedKey(mention);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return present.has(key);
  });
  return next.length === tracked.length ? tracked : next;
}
