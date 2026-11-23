import { afterEach, describe, expect, it } from "vitest";

import {
  setWordChainedApply,
  WORD_AUTHORING_CONTRACT,
  WORD_SCOPED_TOO_LARGE_FOR_FULL_PLAN,
  wordAuthoringContract,
  wordChainedWording,
} from "../wordAuthoringContract";

afterEach(() => setWordChainedApply(false));

describe("the contract's wording for a server that applies changes", () => {
  it("is today's wording while the facets list no apply tool", () => {
    expect(wordAuthoringContract()).toBe(WORD_AUTHORING_CONTRACT);
    expect(wordChainedWording(WORD_SCOPED_TOO_LARGE_FOR_FULL_PLAN)).toBe(
      WORD_SCOPED_TOO_LARGE_FOR_FULL_PLAN,
    );
  });

  it("says to continue with more_changes, never in the next turn", () => {
    setWordChainedApply(true);
    const contract = JSON.stringify(wordAuthoringContract());
    expect(contract).not.toContain("next turn");
    expect(contract).toContain(
      "submit what fits now with more_changes:true; after it is applied, read again and continue",
    );
    const refusal = wordChainedWording(WORD_SCOPED_TOO_LARGE_FOR_FULL_PLAN);
    expect(refusal).not.toContain("next turn");
    expect(refusal).toContain("more_changes:true");
  });
});
