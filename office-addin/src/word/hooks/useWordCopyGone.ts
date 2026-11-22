import { useState } from "react";

/**
 * Whether a card's document copy is gone, so that it folds and offers no Apply: the pane reloaded,
 * the card comes from history, or a later request took a new copy (`revoked`). A message the card
 * saw being written gets its copy one render after it completes, so a missing copy then is not gone.
 */
export function useWordCopyGone({
  generating,
  hasCopy,
  revoked = false,
}: {
  generating: boolean;
  hasCopy: boolean;
  revoked?: boolean;
}): boolean {
  const [sawWriting, setSawWriting] = useState(generating);
  if (generating && !sawWriting) setSawWriting(true);
  return hasCopy ? revoked : !generating && !sawWriting;
}
