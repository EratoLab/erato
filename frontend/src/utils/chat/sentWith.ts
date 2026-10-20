import { i18n } from "@lingui/core";

import type { ComposerContextIconName } from "@/components/ui/Chat/ComposerContext/types";
import type { Message } from "@/types/chat";

/** One read-only chip naming context a sent message carried. */
export interface SentWithChip {
  /** Unique within the message, e.g. "word.document". */
  id: string;
  /** The composer chip kind it mirrors, e.g. "word.document", "outlook.draft". */
  kind: string;
  icon: ComposerContextIconName | (string & {});
  label: string;
  meta?: string;
  /** What the edit lane's announcements and remove name call it; defaults to the label. */
  spokenLabel?: string;
  /** Full text the edit lane's detail shows, e.g. the selected passage. */
  quote?: string;
  /**
   * The label is the start of `quote`. The edit lane shows the spoken label
   * instead, so its "Sent as before" is not cut for an excerpt.
   */
  labelIsExcerpt?: boolean;
}

/**
 * Rebuilds the chips from a stored facet's args. Returns `null` for a facet
 * that carried no user content (a mode, a reply to the open email).
 */
export type SentWithDescriptor = (
  args: Readonly<Record<string, string>>,
) => readonly SentWithChip[] | null;

type SentWithMessage = Pick<
  Message,
  "role" | "action_facet_id" | "action_facet_args"
>;

const descriptors = new Map<string, SentWithDescriptor>();
let generation = 0;

interface CachedChips {
  facetId: string;
  locale: string;
  generation: number;
  chips: readonly SentWithChip[];
}

const cache = new WeakMap<object, CachedChips>();
const EMPTY: readonly SentWithChip[] = Object.freeze([]);

/**
 * Declares how this host names the context its facets sent, keyed by facet
 * id. Registering an id again replaces its descriptor.
 */
export function registerSentWithDescriptors(
  map: Readonly<Record<string, SentWithDescriptor>>,
): void {
  for (const [facetId, descriptor] of Object.entries(map)) {
    descriptors.set(facetId, descriptor);
  }
  generation += 1;
}

export function resetSentWithDescriptors(): void {
  descriptors.clear();
  generation += 1;
}

/**
 * The chips a sent user message shows under its text. Empty when the host
 * registered nothing for the message's facet, and when a stored row no
 * longer parses: an old message must never break the transcript.
 */
export function sentWithChipsFor(
  message: SentWithMessage,
): readonly SentWithChip[] {
  const facetId = message.action_facet_id;
  const args = message.action_facet_args;
  if (message.role !== "user" || !facetId || !args) {
    return EMPTY;
  }
  // Descriptors translate as they build, so a language switch or a late
  // registration must rebuild what an earlier render cached.
  const locale = i18n.locale;
  const cached = cache.get(args);
  if (
    cached?.facetId === facetId &&
    cached.locale === locale &&
    cached.generation === generation
  ) {
    return cached.chips;
  }
  const chips = buildChips(facetId, args);
  cache.set(args, { facetId, locale, generation, chips });
  return chips;
}

const buildChips = (
  facetId: string,
  args: Readonly<Record<string, string>>,
): readonly SentWithChip[] => {
  const descriptor = descriptors.get(facetId);
  if (!descriptor) {
    return EMPTY;
  }
  try {
    const chips = descriptor(args);
    return chips && chips.length > 0 ? chips : EMPTY;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(
        `[sentWith] the descriptor for "${facetId}" threw; the message shows no sent-with row.`,
        error,
      );
    }
    return EMPTY;
  }
};
