import { t } from "@lingui/core/macro";
import { useCallback, useMemo, useState } from "react";

import { componentRegistry } from "@/config/componentRegistry";
import { sanitizeHtmlPreview } from "@/utils/sanitizeHtmlPreview";

import type { EratoEmailCodeBlockProps } from "@/config/componentRegistry";

/**
 * Default fallback for erato-email code blocks when no platform-specific
 * renderer is registered. Shows the suggestion text with a Copy button.
 *
 * The Office addin registers a richer version via componentRegistry that
 * adds "Replace Selection" and "Insert at Cursor" buttons.
 */
function stripHtml(html: string): string {
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  }
  return html.replace(/<[^>]*>/g, "");
}

export function DefaultEratoEmailCodeBlock({
  content,
  isHtml,
}: EratoEmailCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const previewHtml = useMemo(() => sanitizeHtmlPreview(content), [content]);

  const handleCopy = useCallback(() => {
    const writeToClipboard = async () => {
      if (isHtml) {
        // For HTML content, write as text/html so paste targets receive
        // formatted text instead of raw markup. Provide a stripped plain-text
        // fallback for targets that only accept text/plain.
        if (typeof ClipboardItem !== "undefined") {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([content], { type: "text/html" }),
              "text/plain": new Blob([stripHtml(content)], {
                type: "text/plain",
              }),
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(stripHtml(content));
        }
      } else {
        await navigator.clipboard.writeText(content);
      }
    };
    void writeToClipboard()
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Fallback: ignore clipboard errors
      });
  }, [content, isHtml]);

  return (
    <div className="my-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
      {isHtml ? (
        <div
          className="mb-2 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-theme-border [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
          // Sanitized with DOMPurify before rendering.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      ) : (
        <div className="mb-2 whitespace-pre-wrap text-sm">{content}</div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md border border-theme-border bg-theme-bg-primary px-3 py-1 text-xs hover:bg-theme-bg-tertiary"
        >
          {copied ? t`Copied!` : t`Copy`}
        </button>
      </div>
    </div>
  );
}

export function EratoEmailSuggestion({
  content,
  isHtml,
}: EratoEmailCodeBlockProps) {
  const CustomRenderer = componentRegistry.EratoEmailCodeBlock;

  if (CustomRenderer) {
    return <CustomRenderer content={content} isHtml={isHtml} />;
  }

  return <DefaultEratoEmailCodeBlock content={content} isHtml={isHtml} />;
}
