import type { SpokenOptions, SpokenPiece } from "./spokenCard";

/**
 * Which details a short reading holds back: after the first `shortDetails`
 * in the card's order, each is held, and so is the piece that counts the
 * rest, whose number joins the one the voice says.
 */
export const holder = (
  options: Pick<SpokenOptions, "amount" | "shortDetails">,
  kind: "field" | "condition" = "field",
) => {
  const short = options.amount === "short";
  const keep = Math.max(0, Math.floor(options.shortDetails ?? 1));
  let kept = 0;
  let any = false;
  return {
    next(): "field" | "condition" | undefined {
      if (!short) return undefined;
      if (kept < keep) {
        kept += 1;
        return undefined;
      }
      any = true;
      return kind;
    },
    withMore<T extends Pick<SpokenPiece, "role" | "mustSay" | "held">>(
      pieces: T[],
    ): T[] {
      return any
        ? pieces.map((piece) =>
            piece.role === "more" && !piece.mustSay
              ? { ...piece, held: kind }
              : piece,
          )
        : pieces;
    },
  };
};
