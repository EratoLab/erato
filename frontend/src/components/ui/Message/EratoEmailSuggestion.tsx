import { t } from "@lingui/core/macro";
import { useCallback, useState } from "react";

import { componentRegistry } from "@/config/componentRegistry";

import type { EratoEmailCodeBlockProps } from "@/config/componentRegistry";

/**
 * Default fallback for erato-email code blocks when no platform-specific
 * renderer is registered. Shows the suggestion text with a Copy button.
 *
 * The Office addin registers a richer version via componentRegistry that
 * adds "Replace Selection" and "Insert at Cursor" buttons.
 */
function DefaultEratoEmailCodeBlock({ content }: EratoEmailCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Fallback: ignore clipboard errors
      });
  }, [content]);

  return (
    <div className="my-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
      <div className="mb-2 whitespace-pre-wrap text-sm">{content}</div>
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

export function EratoEmailSuggestion({ content }: EratoEmailCodeBlockProps) {
  const CustomRenderer = componentRegistry.EratoEmailCodeBlock;

  if (CustomRenderer) {
    return <CustomRenderer content={content} />;
  }

  return <DefaultEratoEmailCodeBlock content={content} />;
}
