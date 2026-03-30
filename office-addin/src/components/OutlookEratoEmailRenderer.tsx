import { useCallback, useState } from "react";

import { useOutlookComposeSelection } from "../hooks/useOutlookComposeSelection";
import { replaceComposeSelection } from "../utils/outlookComposeWrite";

import type { EratoEmailCodeBlockProps } from "@erato/frontend/library";

/**
 * Office-aware renderer for erato-email code blocks.
 * Registered via componentRegistry in main.tsx so the shared MessageContent
 * delegates to this component when running inside the Outlook addin.
 *
 * Provides action buttons that write back into the Outlook compose body
 * via Office.js setSelectedDataAsync. Button labels adapt dynamically:
 * - "Replace Selection" when text is selected in the compose window
 * - "Insert at Cursor" when nothing is selected
 */
export function OutlookEratoEmailRenderer({
  content,
  isHtml,
}: EratoEmailCodeBlockProps) {
  const composeSelection = useOutlookComposeSelection();
  const hasSelection = composeSelection.data.length > 0;

  const [status, setStatus] = useState<
    "idle" | "inserting" | "done" | "copied" | "error"
  >("idle");
  const isBusy = status === "inserting";

  const handleInsert = useCallback(async () => {
    setStatus("inserting");
    try {
      await replaceComposeSelection(content, isHtml);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      console.warn("Failed to insert into compose body:", err);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [content, isHtml]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setStatus("copied");
        setTimeout(() => setStatus("idle"), 2000);
      })
      .catch(() => {
        // ignore clipboard errors
      });
  }, [content]);

  const insertLabel = (() => {
    if (status === "done") return "Done!";
    if (status === "inserting") return "Inserting...";
    return hasSelection ? "Replace Selection" : "Insert at Cursor";
  })();

  return (
    <div className="my-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
      <div className="mb-2 whitespace-pre-wrap text-sm">{content}</div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleInsert()}
          disabled={isBusy}
          className="rounded-md border border-theme-border bg-theme-bg-primary px-3 py-1 text-xs hover:bg-theme-bg-tertiary disabled:opacity-50"
        >
          {insertLabel}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={isBusy}
          className="rounded-md border border-theme-border bg-theme-bg-primary px-3 py-1 text-xs hover:bg-theme-bg-tertiary disabled:opacity-50"
        >
          {status === "copied" ? "Copied!" : "Copy"}
        </button>
      </div>
      {status === "error" && (
        <p className="mt-1 text-xs text-red-500">
          Failed to insert into compose body.
        </p>
      )}
    </div>
  );
}
