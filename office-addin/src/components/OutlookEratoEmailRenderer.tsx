import { useCallback, useState } from "react";

import { replaceComposeSelection } from "../utils/outlookComposeWrite";

import type { EratoEmailCodeBlockProps } from "@erato/frontend/library";

/**
 * Office-aware renderer for erato-email code blocks.
 * Registered via componentRegistry in main.tsx so the shared MessageContent
 * delegates to this component when running inside the Outlook addin.
 *
 * Provides action buttons that write back into the Outlook compose body
 * via Office.js setSelectedDataAsync.
 */
export function OutlookEratoEmailRenderer({
  content,
}: EratoEmailCodeBlockProps) {
  const [status, setStatus] = useState<
    "idle" | "replacing" | "replaced" | "copied" | "error"
  >("idle");

  const handleReplace = useCallback(async () => {
    setStatus("replacing");
    try {
      await replaceComposeSelection(content);
      setStatus("replaced");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      console.warn("Failed to replace selection:", err);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [content]);

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

  return (
    <div className="my-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
      <div className="mb-2 whitespace-pre-wrap text-sm">{content}</div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleReplace()}
          disabled={status === "replacing"}
          className="rounded-md border border-theme-border bg-theme-bg-primary px-3 py-1 text-xs hover:bg-theme-bg-tertiary disabled:opacity-50"
        >
          {status === "replaced"
            ? "Replaced!"
            : status === "replacing"
              ? "Replacing..."
              : "Replace Selection"}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md border border-theme-border bg-theme-bg-primary px-3 py-1 text-xs hover:bg-theme-bg-tertiary"
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
