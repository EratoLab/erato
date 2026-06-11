import { afterEach, describe, expect, it, vi } from "vitest";

import { detectExchangeOnPrem } from "../detectExchangeOnPrem";

function installMailbox(mailbox: Record<string, unknown>) {
  (Office.context as unknown as Record<string, unknown>).mailbox = mailbox;
}

describe("detectExchangeOnPrem", () => {
  afterEach(() => {
    // Restore the shared Office stub first — the Office-absent test replaces it.
    vi.unstubAllGlobals();
    delete (Office.context as unknown as Record<string, unknown>).mailbox;
  });

  it("treats accountType enterprise as on-prem", () => {
    installMailbox({ userProfile: { accountType: "enterprise" } });
    expect(detectExchangeOnPrem()).toBe(true);
  });

  it.each(["office365", "outlook", "outlookCom", "gmail"])(
    "treats accountType %s as not on-prem",
    (accountType) => {
      installMailbox({
        userProfile: { accountType },
        // The URL fallback must not override the authoritative accountType.
        ewsUrl: "https://mail.corp.example.com/EWS/Exchange.asmx",
      });
      expect(detectExchangeOnPrem()).toBe(false);
    },
  );

  it("falls back to a non-Microsoft ewsUrl host when accountType is missing", () => {
    installMailbox({
      userProfile: {},
      ewsUrl: "https://mail.corp.example.com/EWS/Exchange.asmx",
    });
    expect(detectExchangeOnPrem()).toBe(true);
  });

  it("treats a Microsoft-cloud restUrl as not on-prem when accountType is missing", () => {
    installMailbox({
      userProfile: {},
      restUrl: "https://outlook.office365.com/api",
    });
    expect(detectExchangeOnPrem()).toBe(false);
  });

  it("returns false when no usable signal exists", () => {
    installMailbox({ userProfile: {} });
    expect(detectExchangeOnPrem()).toBe(false);
  });

  it("returns false without a mailbox", () => {
    expect(detectExchangeOnPrem()).toBe(false);
  });

  it("returns false when Office is absent", () => {
    vi.stubGlobal("Office", undefined);
    expect(detectExchangeOnPrem()).toBe(false);
  });
});
