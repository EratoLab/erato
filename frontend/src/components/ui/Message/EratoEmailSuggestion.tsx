import { t } from "@lingui/core/macro";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { componentRegistry } from "@/config/componentRegistry";
import { copyEmailToClipboard } from "@/utils/emailClipboard";
import { sanitizeHtmlPreview } from "@/utils/sanitizeHtmlPreview";

import type { EratoEmailCodeBlockProps } from "@/config/componentRegistry";

/**
 * Default fallback for erato-email code blocks when no platform-specific
 * renderer is registered. Shows the suggestion text with a Copy button.
 *
 * The Office addin registers a richer version via componentRegistry that
 * adds "Replace Selection" and "Insert at Cursor" buttons.
 */
export function DefaultEratoEmailCodeBlock({
  content,
  isHtml,
  isStreaming,
}: EratoEmailCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const previewHtml = useMemo(
    () => (isHtml ? sanitizeHtmlPreview(content, { isStreaming }) : ""),
    [content, isHtml, isStreaming],
  );

  const handleCopy = useCallback(() => {
    void copyEmailToClipboard(content, isHtml ?? false)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Fallback: ignore clipboard errors
      });
  }, [content, isHtml]);

  return (
    <div className="my-2 rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-primary p-3">
      {isHtml ? (
        <div
          className="mb-2 text-sm [&_a]:text-theme-fg-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-theme-border [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
          // Sanitized with DOMPurify before rendering.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      ) : (
        <div className="mb-2 whitespace-pre-wrap text-sm">{content}</div>
      )}
      <div className="card-actions flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleCopy}>
          {copied
            ? t({ id: "chat.message.email.copied", message: "Copied!" })
            : t({ id: "chat.message.email.copy", message: "Copy" })}
        </Button>
      </div>
    </div>
  );
}

export function EratoEmailSuggestion(props: EratoEmailCodeBlockProps) {
  const Renderer =
    componentRegistry.EratoEmailCodeBlock ?? DefaultEratoEmailCodeBlock;
  return <Renderer {...props} />;
}
