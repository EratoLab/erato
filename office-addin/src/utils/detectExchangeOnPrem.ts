/**
 * Mailbox-location probe — this module reads `Office.context.mailbox`. Two
 * consumers branch on it:
 *
 *   - The mail data plane ({@link "../hooks/useOutlookMessageFetcher"}) picks
 *     the mail backend by where the mailbox lives — Microsoft Graph for cloud
 *     mailboxes, the EWS SOAP backend (`fetchOutlookMessageEws.ts`) for
 *     on-prem ones (Graph can't reach on-prem mailboxes). Auth mode can't
 *     drive this choice: SE authenticates via the oauth2-proxy redirect login
 *     but still reports `entra-msal` (same as EXO).
 *   - The auth composition root ({@link "../providers/OutlookAuthProvider"})
 *     vetoes NAA for on-prem mailboxes: classic desktop Outlook reports the
 *     NestedAppAuth requirement set even when the profile has no Entra
 *     account, so host support alone would pick a broken MSAL path.
 */

/**
 * Hostname suffixes of Microsoft-hosted Exchange Online service endpoints
 * (worldwide, US government, and 21Vianet-operated China clouds). An
 * EWS/REST URL on any of these belongs to a cloud mailbox; any other host is
 * treated as customer-hosted (on-prem) Exchange. `.partner.outlook.cn` is
 * already covered by `.outlook.cn` but listed to document the full set.
 */
const MICROSOFT_CLOUD_HOST_SUFFIXES = [
  ".office.com",
  ".office365.com",
  ".outlook.com",
  ".office365.us",
  ".outlook.cn",
  ".partner.outlook.cn",
];

function isMicrosoftCloudHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return MICROSOFT_CLOUD_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
  );
}

/** `accountType` values that are definitively NOT on-prem Exchange:
 * Microsoft-hosted ("office365", consumer "outlookCom") or a non-Exchange
 * backend entirely ("outlook" = classic-desktop-connected, "gmail"). */
const NON_ON_PREM_ACCOUNT_TYPES = new Set([
  "office365",
  "outlook",
  "outlookCom",
  "gmail",
]);

/**
 * Whether the current mailbox is served by an on-prem Exchange (SE) rather
 * than Exchange Online — i.e. whether mail must be fetched via EWS SOAP
 * (backend proxy + host-brokered `makeEwsRequestAsync`) instead of Microsoft
 * Graph (Graph can't reach on-prem mailboxes).
 *
 * Signals, in order of authority:
 * (a) `userProfile.accountType`: "enterprise" ⇒ on-prem; any of the known
 *     cloud/non-Exchange values ⇒ not.
 * (b) `accountType` is officially Mailbox 1.6+ and may be absent (the SE probe
 *     on a 1.5-ceiling OWA empirically still returned "enterprise", but we
 *     don't rely on that): fall back to where the mailbox's service endpoints
 *     (`ewsUrl`/`restUrl`) live — a non-Microsoft host means on-prem.
 * (c) No usable signal ⇒ false. Conservative on purpose: better that a cloud
 *     host falls through to the Graph path than fetching mail via the on-prem
 *     EWS path its host won't broker or issue callback tokens for.
 */
export function detectExchangeOnPrem(): boolean {
  try {
    if (typeof Office === "undefined") {
      return false;
    }
    const mailbox = Office.context?.mailbox;
    if (!mailbox) {
      return false;
    }

    const accountType = mailbox.userProfile?.accountType;
    if (accountType === "enterprise") {
      return true;
    }
    if (accountType && NON_ON_PREM_ACCOUNT_TYPES.has(accountType)) {
      return false;
    }

    for (const serviceUrl of [mailbox.ewsUrl, mailbox.restUrl]) {
      if (!serviceUrl) {
        continue;
      }
      let hostname: string;
      try {
        hostname = new URL(serviceUrl).hostname;
      } catch {
        continue;
      }
      if (hostname && !isMicrosoftCloudHostname(hostname)) {
        return true;
      }
    }

    return false;
  } catch {
    // Office threw or is half-initialized — no usable signal.
    return false;
  }
}
