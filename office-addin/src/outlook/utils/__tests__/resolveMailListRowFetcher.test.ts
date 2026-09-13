import { describe, expect, it } from "vitest";

import { resolveMailListRowFetcher } from "../resolveMailListRowFetcher";

import type { OutlookMessageFetcher } from "../fetchOutlookMessage";

const bound = { kind: "bound" } as unknown as OutlookMessageFetcher;
const own = { kind: "own" } as unknown as OutlookMessageFetcher;
const boundMailboxAddresses = [
  "Shared@Contoso.com",
  "shared.team@contoso.onmicrosoft.com",
];

describe("resolveMailListRowFetcher", () => {
  it("routes every row through the own backend when nothing foreign is bound", () => {
    const backends = { bound: own, own, boundMailboxAddresses: [] };
    expect(
      resolveMailListRowFetcher(
        { mailboxSmtpAddress: "me@contoso.com" },
        backends,
      ),
    ).toBe(own);
    expect(
      resolveMailListRowFetcher(
        { mailboxSmtpAddress: "other@contoso.com" },
        backends,
      ),
    ).toBe(own);
    expect(
      resolveMailListRowFetcher({ mailboxSmtpAddress: "" }, backends),
    ).toBe(own);
  });

  it("routes a row out of the bound store through the bound backend, case-insensitively", () => {
    const backends = { bound, own, boundMailboxAddresses };
    expect(
      resolveMailListRowFetcher(
        { mailboxSmtpAddress: "shared@contoso.com" },
        backends,
      ),
    ).toBe(bound);
    expect(
      resolveMailListRowFetcher(
        { mailboxSmtpAddress: " SHARED.TEAM@contoso.onmicrosoft.com " },
        backends,
      ),
    ).toBe(bound);
  });

  it("routes a row out of any other store through the own backend", () => {
    // A shared item is selected; the user drags a row from their own inbox.
    // Reading it through the bound backend asks the shared store for an id
    // that only exists in the user's own store.
    const backends = { bound, own, boundMailboxAddresses };
    expect(
      resolveMailListRowFetcher(
        { mailboxSmtpAddress: "me@contoso.com" },
        backends,
      ),
    ).toBe(own);
  });

  it("keeps a row of unknown provenance on the bound backend", () => {
    const backends = { bound, own, boundMailboxAddresses };
    expect(
      resolveMailListRowFetcher({ mailboxSmtpAddress: "" }, backends),
    ).toBe(bound);
  });

  it("skips a row out of a bound store whose backend is withheld", () => {
    // On-prem: the shared item is refused, the user's own store still reads.
    const backends = { bound: null, own, boundMailboxAddresses };
    expect(
      resolveMailListRowFetcher(
        { mailboxSmtpAddress: "shared@contoso.com" },
        backends,
      ),
    ).toBeNull();
    expect(
      resolveMailListRowFetcher(
        { mailboxSmtpAddress: "me@contoso.com" },
        backends,
      ),
    ).toBe(own);
  });
});
