export interface AssistantMention {
  id: string;
  name: string;
}

export interface MentionTrigger {
  query: string;
  /** Index of the `@` in the full text, not in the slice passed to the detector. */
  startIndex: number;
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

/**
 * A token only counts where it is not the leading fragment of a longer tracked
 * name at the same position: with both "Data" and "Data Analyst" tracked, the
 * text `@Data Analyst` must resolve to the latter alone.
 */
function isMentionPresent(
  text: string,
  mention: AssistantMention,
  tracked: AssistantMention[],
): boolean {
  const token = mentionToken(mention.name);
  const shadowingTokens = tracked
    .filter(
      (other) =>
        other.name.length > mention.name.length &&
        other.name.startsWith(mention.name),
    )
    .map((other) => mentionToken(other.name));

  let searchFrom = 0;
  for (;;) {
    const index = text.indexOf(token, searchFrom);
    if (index < 0) {
      return false;
    }
    const shadowed = shadowingTokens.some((shadowing) =>
      text.startsWith(shadowing, index),
    );
    if (
      !shadowed &&
      isAtWordStart(text, index) &&
      isAtWordEnd(text, index + token.length)
    ) {
      return true;
    }
    searchFrom = index + 1;
  }
}

/** The ids the composer should submit: tracked order, deduped, text wins. */
export function resolveMentionedAssistantIds(
  text: string,
  tracked: AssistantMention[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const mention of tracked) {
    if (seen.has(mention.id) || !isMentionPresent(text, mention, tracked)) {
      continue;
    }
    seen.add(mention.id);
    ids.push(mention.id);
  }
  return ids;
}

/**
 * Returns the same array reference when nothing was dropped, so callers can
 * feed the result straight back into state without looping.
 */
export function pruneTrackedMentions(
  text: string,
  tracked: AssistantMention[],
): AssistantMention[] {
  const seen = new Set<string>();
  const next = tracked.filter((mention) => {
    const key = JSON.stringify([mention.id, mention.name]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return isMentionPresent(text, mention, tracked);
  });
  return next.length === tracked.length ? tracked : next;
}
