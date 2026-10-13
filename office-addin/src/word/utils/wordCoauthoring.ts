/** Who else Word on Windows or Mac sees in the open document (`Word.Coauthoring`, WordApiDesktop 1.4). */
export interface WordCoauthoringState {
  /** Everyone Word lists as editing the document, the user included. */
  authors: number;
  /** Co-authors' changes Word has received but not yet merged into this session. Word PC keeps it
   * true for minutes after the last co-author left (P-D-COAUTH), so it never means others are
   * editing by itself. */
  pendingUpdates: boolean;
  othersEditing: boolean;
}

/**
 * The co-authoring state for a warning before a whole-document write, or undefined where Word
 * cannot report it. Never throws: a failed read must not stand in the way of Apply.
 */
export async function readWordCoauthoring(): Promise<
  WordCoauthoringState | undefined
> {
  try {
    if (
      !globalThis.Office?.context?.requirements?.isSetSupported(
        "WordApiDesktop",
        "1.4",
      )
    )
      return undefined;
    return await Word.run(async (context) => {
      const coauthoring = context.document.coauthoring;
      coauthoring.load("pendingUpdates");
      const authors = coauthoring.authors;
      authors.load("items/id");
      await context.sync();
      const count = authors.items.length;
      const pendingUpdates = coauthoring.pendingUpdates === true;
      return {
        authors: count,
        pendingUpdates,
        othersEditing: count > 1,
      };
    });
  } catch {
    return undefined;
  }
}
