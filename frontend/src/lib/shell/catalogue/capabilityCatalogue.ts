/**
 * What one capability the page describes as data puts into the shell
 * catalogue (`pnpm shell:catalogue`): every document the page can send or
 * accept, which host apps test their reading against.
 */
export interface CapabilityCatalogue<
  Document = unknown,
  Index extends object = object,
> {
  capability: string;
  version: number;
  /** Each file name (without `.json`) once. */
  documents: { name: string; document: Document }[];
  /** What the capability's `index.json` says besides the document names. */
  index: Index;
}
