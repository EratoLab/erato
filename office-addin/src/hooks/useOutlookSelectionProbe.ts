import { useEffect } from "react";

import { isMessageRead } from "../sessionPolicy";
import { selLog } from "../utils/selectionDebug";

const PROBE_INTERVAL_MS = 1500;

/**
 * TEMPORARY diagnostic hook. Polls the raw `Office.context.mailbox.item` in
 * BOTH read and compose mode and logs whether `getSelectedDataAsync` exists
 * and what it returns — so we can tell, in the actual Outlook host, whether
 * selection reading works, errors, or is simply unavailable (the office-js
 * types say it is compose-only; this proves it empirically per host).
 *
 * Never mutates app state. Remove once the selection-preview issue is solved.
 */
export function useOutlookSelectionProbe(): void {
  useEffect(() => {
    let cancelled = false;
    let lastLine = "";

    // One-time environment banner: host/platform/version + which Mailbox
    // requirement sets are available (1.2 gates the selection APIs).
    try {
      const diagnostics = Office?.context?.diagnostics;
      const requirements = Office?.context?.requirements;
      const sets = ["1.1", "1.2", "1.3", "1.5", "1.8", "1.10", "1.13"]
        .map(
          (version) =>
            `${version}:${
              requirements?.isSetSupported?.("Mailbox", version) ? "Y" : "n"
            }`,
        )
        .join(" ");
      selLog(
        `env host=${diagnostics?.host} platform=${diagnostics?.platform} version=${diagnostics?.version} | mailboxSets ${sets}`,
      );
    } catch (error) {
      selLog("env probe threw", error);
    }

    const logOnce = (line: string) => {
      if (line !== lastLine) {
        lastLine = line;
        selLog(line);
      }
    };

    const probe = () => {
      if (cancelled) return;

      const item = Office?.context?.mailbox?.item as
        | Office.MessageRead
        | Office.MessageCompose
        | null
        | undefined;

      if (!item) {
        logOnce("probe: no mailbox item");
        return;
      }

      const mode = isMessageRead(item) ? "READ" : "COMPOSE";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getSelected = (item as any).getSelectedDataAsync;
      if (typeof getSelected !== "function") {
        // The decisive read-mode signal: the API isn't even present.
        logOnce(
          `probe: ${mode} getSelectedDataAsync=ABSENT (unsupported here)`,
        );
        return;
      }

      getSelected.call(
        item,
        Office.CoercionType.Text,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result: Office.AsyncResult<any>) => {
          if (cancelled) return;

          if (result.status === Office.AsyncResultStatus.Succeeded) {
            const data: string = result.value?.data ?? "";
            const source = result.value?.sourceProperty;
            logOnce(
              `probe: ${mode} OK len=${data.length} src=${source} text=${JSON.stringify(
                data.slice(0, 40),
              )}`,
            );
          } else {
            logOnce(
              `probe: ${mode} FAIL code=${result.error?.code} name=${result.error?.name} msg=${result.error?.message}`,
            );
          }
        },
      );
    };

    probe();
    const intervalId = setInterval(probe, PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);
}
