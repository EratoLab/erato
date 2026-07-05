/**
 * DEV-only console probe for the compose-selection pipeline, installed as
 * `window.__eratoSelectionProbe()`. Exists to diagnose a live-observed host
 * wedge where `getSelectedDataAsync` stops delivering callbacks entirely
 * (survives taskpane reload). One call captures everything a host bug report
 * needs: host/platform/version, item state, and whether EACH item API still
 * calls back — `body.getTypeAsync` is the discriminator between "this one API
 * is dead" and "the whole Office.js bridge is dead".
 *
 * Zero production footprint: only installed behind `import.meta.env.DEV`.
 * Remove before merge if no longer needed (same lifecycle as the #798
 * calendar probes).
 */

const PROBE_TIMEOUT_MS = 5000;

function probeCall(
  label: string,
  invoke: (callback: (result: Office.AsyncResult<unknown>) => void) => void,
): void {
  let fired = false;
  const watchdog = setTimeout(() => {
    if (!fired) {
      console.warn(
        `[probe] ${label}: callback NEVER fired within ${PROBE_TIMEOUT_MS}ms — API wedged`,
      );
    }
  }, PROBE_TIMEOUT_MS);
  try {
    invoke((result) => {
      fired = true;
      clearTimeout(watchdog);
      console.log(
        `[probe] ${label}:`,
        "status:",
        result.status,
        "error:",
        result.error?.code,
        result.error?.message,
        "value:",
        JSON.stringify(result.value)?.slice(0, 300),
      );
    });
  } catch (error) {
    clearTimeout(watchdog);
    console.warn(`[probe] ${label}: threw synchronously:`, error);
  }
}

export function installSelectionDiagnosticsProbe(): void {
  const devWindow = window as Window & {
    __eratoSelectionProbe?: () => string;
  };
  devWindow.__eratoSelectionProbe = () => {
    const diagnostics = Office.context?.diagnostics;
    const mailboxDiagnostics = Office.context?.mailbox?.diagnostics;
    console.log(
      "[probe] office:",
      "host:",
      diagnostics?.host,
      "platform:",
      diagnostics?.platform,
      "version:",
      diagnostics?.version,
      "| mailbox host:",
      mailboxDiagnostics?.hostName,
      mailboxDiagnostics?.hostVersion,
      "OWAView:",
      mailboxDiagnostics?.OWAView,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = Office.context?.mailbox?.item as any;
    console.log(
      "[probe] item:",
      "present:",
      !!item,
      "itemType:",
      item?.itemType,
      "getSelectedDataAsync:",
      typeof item?.getSelectedDataAsync,
      "body.getTypeAsync:",
      typeof item?.body?.getTypeAsync,
      "setSelectedDataAsync:",
      typeof item?.body?.setSelectedDataAsync,
    );
    if (!item) {
      return "[probe] no mailbox item — select/open a draft first";
    }

    if (typeof item.getSelectedDataAsync === "function") {
      probeCall("getSelectedDataAsync(Text)", (cb) =>
        item.getSelectedDataAsync(Office.CoercionType.Text, cb),
      );
      probeCall("getSelectedDataAsync(Html)", (cb) =>
        item.getSelectedDataAsync(Office.CoercionType.Html, cb),
      );
    }
    if (typeof item.body?.getTypeAsync === "function") {
      probeCall("body.getTypeAsync", (cb) => item.body.getTypeAsync(cb));
    }
    return "[probe] running — watch for [probe] lines (up to 5s)";
  };
}
