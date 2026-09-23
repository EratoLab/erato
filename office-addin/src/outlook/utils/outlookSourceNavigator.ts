import { uniqueOutlookId } from "@erato/frontend/library";

import type { OutlookSourceNavigator } from "@erato/frontend/library";

/** Only EWS IDs are accepted here. Local store IDs are never converted to EWS. */
export function createOutlookSourceNavigator(): OutlookSourceNavigator | null {
  if (typeof Office === "undefined" || !Office.context?.mailbox) return null;
  const mailbox = Office.context.mailbox;
  const requirements = Office.context.requirements;
  const useAsync =
    requirements.isSetSupported("Mailbox", "1.9") &&
    typeof mailbox.displayMessageFormAsync === "function";
  const useSync =
    requirements.isSetSupported("Mailbox", "1.1") &&
    typeof mailbox.displayMessageForm === "function";
  if (!useAsync && !useSync) return null;
  return {
    canOpen: (reference) => Boolean(uniqueOutlookId(reference, "ews_id")),
    open: (reference) =>
      new Promise<void>((resolve, reject) => {
        const ewsId = uniqueOutlookId(reference, "ews_id");
        if (!ewsId) {
          reject(new Error("No unambiguous EWS message ID."));
          return;
        }
        if (!useAsync) {
          mailbox.displayMessageForm(ewsId);
          resolve();
          return;
        }
        // A host callback is not guaranteed to arrive after the task pane changes.
        const timeout = setTimeout(
          () => reject(new Error("Outlook did not respond.")),
          15_000,
        );
        try {
          mailbox.displayMessageFormAsync(ewsId, (result) => {
            clearTimeout(timeout);
            if (result.status === Office.AsyncResultStatus.Failed)
              reject(new Error("Outlook could not display the message."));
            else resolve();
          });
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      }),
  };
}
