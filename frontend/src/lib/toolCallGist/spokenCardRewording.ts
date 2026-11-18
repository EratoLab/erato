import { spokenWordsFor } from "./spokenCardWords";

import type { SpokenOptions, SpokenPiece, SpokenPieceRole } from "./spokenCard";

/**
 * The natural reading of a spoken card: the backend rewords the precise
 * pieces and checks each wording against the words the piece says for its
 * values. This side only says which words those are and puts a checked
 * wording in place of a piece's text. Ids, roles, order, what must be said
 * and what can be read out never change, so skipping, "the rest", repeating
 * and the difference reading work as in the precise reading.
 */

/** Pieces a wording may replace; the consequence and the request never. */
export const REWORDABLE_ROLES: readonly SpokenPieceRole[] = [
  "what",
  "item",
  "detail",
  "outside",
  "more",
  "text",
];

export const rewordable = (piece: Pick<SpokenPiece, "role">): boolean =>
  REWORDABLE_ROLES.includes(piece.role);

export interface RewordingPiece {
  id: string;
  role: SpokenPieceRole;
  text: string;
  facts: string[];
}

export interface RewordedPiece {
  id: string;
  text: string;
  natural: boolean;
}

/** Words as the backend's check reads them: lowercase, apostrophes inside kept. */
export const factTokens = (text: string): string[] =>
  text
    .replaceAll(/[’‘]/g, "'")
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length > 0);

const contains = (haystack: string[], needle: string[]): boolean =>
  needle.length > 0 &&
  haystack.some((_, start) =>
    needle.every((word, offset) => haystack[start + offset] === word),
  );

/**
 * The words `piece` says for each value it is built from, in the card's
 * order. A value the piece does not say, such as list entries it only
 * counts, is not a fact of the piece; the count it says instead is kept by
 * the check's rule on numbers.
 */
export const pieceFacts = (
  piece: SpokenPiece,
  options: Pick<SpokenOptions, "language" | "now" | "timeZone">,
): string[] => {
  const words = spokenWordsFor(options.language, options);
  const said = factTokens(piece.text);
  return (piece.values ?? []).flatMap((source) => {
    const forms = words
      .factWords(source.value)
      .filter((form) => factTokens(form).length > 0);
    if (forms.length === 0) return [];
    const form = forms.find((candidate) =>
      contains(said, factTokens(candidate)),
    );
    return form === undefined ? [] : [form];
  });
};

/** What the backend is asked to reword: every piece, each with its facts. */
export const rewordingRequest = (
  pieces: readonly SpokenPiece[],
  options: Pick<SpokenOptions, "language" | "now" | "timeZone">,
): { language: string; pieces: RewordingPiece[] } => ({
  language: options.language.split(/[-_]/)[0]?.toLowerCase() ?? "en",
  pieces: pieces.map((piece) => ({
    id: piece.id,
    role: piece.role,
    text: piece.text,
    facts: pieceFacts(piece, options),
  })),
});

/**
 * The pieces with each checked wording in place of its text. Anything else
 * the answer holds (an unknown id, a piece that may not be reworded, an
 * empty text) is ignored.
 */
export const withRewording = (
  pieces: readonly SpokenPiece[],
  answer: readonly RewordedPiece[] | undefined,
): SpokenPiece[] => {
  const byId = new Map(
    (answer ?? [])
      .filter((piece) => piece.natural && piece.text.trim().length > 0)
      .map((piece) => [piece.id, piece.text.trim()]),
  );
  return pieces.map((piece) => {
    const text = rewordable(piece) ? byId.get(piece.id) : undefined;
    return text === undefined ? piece : { ...piece, text };
  });
};
