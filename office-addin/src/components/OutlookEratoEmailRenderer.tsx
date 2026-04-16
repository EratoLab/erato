import { sanitizeHtmlPreview } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useMemo, useState } from "react";

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
  const previewHtml = useMemo(
    () => (isHtml ? sanitizeHtmlPreview(content) : null),
    [content, isHtml],
  );

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
    if (status === "done")
      return t({
        id: "officeAddin.emailRenderer.done",
        message: "Done!",
      });
    if (status === "inserting")
      return t({
        id: "officeAddin.emailRenderer.inserting",
        message: "Inserting...",
      });
    return hasSelection
      ? t({
          id: "officeAddin.emailRenderer.replaceSelection",
          message: "Replace Selection",
        })
      : t({
          id: "officeAddin.emailRenderer.insertAtCursor",
          message: "Insert at Cursor",
        });
  })();

  return (
    <div className="my-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
      {isHtml ? (
        <div
          className="mb-2 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-theme-border [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
          // Sanitized with DOMPurify before rendering.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }}
        />
      ) : (
        <div className="mb-2 whitespace-pre-wrap text-sm">{content}</div>
      )}
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
          {status === "copied"
            ? t({
                id: "officeAddin.emailRenderer.copied",
                message: "Copied!",
              })
            : t({
                id: "officeAddin.emailRenderer.copy",
                message: "Copy",
              })}
        </button>
      </div>
      {status === "error" && (
        <p className="mt-1 text-xs text-red-500">
          {t({
            id: "officeAddin.emailRenderer.insertFailed",
            message: "Failed to insert into compose body.",
          })}
        </p>
      )}
    </div>
  );
}
