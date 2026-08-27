import clsx from "clsx";
import { useId, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Textarea } from "./Textarea";

import type { TextareaProps } from "./Textarea";
import type { KeyboardEvent } from "react";

type MarkdownPreviewTab = "markdown" | "preview";

/** Left-to-right order of the tab strip, for arrow-key navigation. */
const TAB_ORDER: MarkdownPreviewTab[] = ["markdown", "preview"];

export interface MarkdownPreviewInputProps
  extends Omit<TextareaProps, "className"> {
  /** Accessible label for the Markdown/Preview tab list. */
  tablistLabel: string;
  /** Label for the source editing tab. */
  markdownTabLabel: string;
  /** Label for the rendered output tab. */
  previewTabLabel: string;
  /** Message shown when the source is empty. */
  emptyPreviewMessage: string;
  /** Additional classes for the input wrapper. */
  className?: string;
}

/**
 * A themed textarea with a rendered Markdown preview.
 *
 * The Markdown source remains the controlled value, so switching tabs never
 * changes the value submitted by the containing form.
 */
export function MarkdownPreviewInput({
  tablistLabel,
  markdownTabLabel,
  previewTabLabel,
  emptyPreviewMessage,
  className,
  disabled = false,
  error,
  id,
  value = "",
  ...textareaProps
}: MarkdownPreviewInputProps) {
  const generatedId = useId();
  const baseId = id ?? `markdown-preview-input-${generatedId}`;
  const [activeTab, setActiveTab] = useState<MarkdownPreviewTab>("markdown");
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const markdownTabId = `${baseId}-markdown-tab`;
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const previewTabId = `${baseId}-preview-tab`;
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const panelId = `${baseId}-panel`;

  const isMarkdownTab = activeTab === "markdown";

  const tabIds: Record<MarkdownPreviewTab, string> = {
    markdown: markdownTabId,
    preview: previewTabId,
  };

  /**
   * Automatic activation: selection and focus move together. Without this the
   * selected tab is the only tab stop in the strip and a keyboard user cannot
   * reach the other one.
   */
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: MarkdownPreviewTab,
  ) => {
    const currentIndex = TAB_ORDER.indexOf(currentTab);
    let nextTab: MarkdownPreviewTab;

    switch (event.key) {
      case "ArrowRight":
        nextTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length];
        break;
      case "ArrowLeft":
        nextTab =
          TAB_ORDER[(currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length];
        break;
      case "Home":
        nextTab = TAB_ORDER[0];
        break;
      case "End":
        nextTab = TAB_ORDER[TAB_ORDER.length - 1];
        break;
      default:
        return;
    }

    event.preventDefault();
    setActiveTab(nextTab);
    document.getElementById(tabIds[nextTab])?.focus({ preventScroll: true });
  };

  return (
    <div
      className={clsx(
        "overflow-hidden rounded-[var(--theme-radius-input)] border border-[var(--theme-border-field)] bg-theme-bg-secondary",
        error && "border-theme-error-border",
        className,
      )}
    >
      <div className="flex items-center border-b border-theme-border bg-theme-bg-primary px-2 py-1">
        <div aria-label={tablistLabel} className="flex gap-1" role="tablist">
          <button
            id={markdownTabId}
            type="button"
            role="tab"
            aria-controls={panelId}
            aria-selected={isMarkdownTab}
            tabIndex={isMarkdownTab ? 0 : -1}
            disabled={disabled}
            className={clsx(
              "theme-transition rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
              isMarkdownTab
                ? "bg-theme-bg-selected text-theme-fg-primary"
                : "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary",
              disabled && "cursor-not-allowed opacity-50",
            )}
            onClick={() => setActiveTab("markdown")}
            onKeyDown={(event) => handleTabKeyDown(event, "markdown")}
          >
            {markdownTabLabel}
          </button>
          <button
            id={previewTabId}
            type="button"
            role="tab"
            aria-controls={panelId}
            aria-selected={!isMarkdownTab}
            tabIndex={isMarkdownTab ? -1 : 0}
            disabled={disabled}
            className={clsx(
              "theme-transition rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
              !isMarkdownTab
                ? "bg-theme-bg-selected text-theme-fg-primary"
                : "text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary",
              disabled && "cursor-not-allowed opacity-50",
            )}
            onClick={() => setActiveTab("preview")}
            onKeyDown={(event) => handleTabKeyDown(event, "preview")}
          >
            {previewTabLabel}
          </button>
        </div>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={isMarkdownTab ? markdownTabId : previewTabId}
        tabIndex={0}
      >
        {isMarkdownTab ? (
          <Textarea
            {...textareaProps}
            {...(id ? { id } : {})}
            disabled={disabled}
            error={error}
            value={value}
            className="rounded-none border-0 focus:ring-0"
          />
        ) : (
          <div className="min-h-[8.5rem] px-4 py-3 text-base text-theme-fg-primary">
            {value ? (
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ children, href, node: _node, ...props }) => (
                    <a
                      {...props}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-theme-fg-accent underline hover:opacity-80"
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children, node: _node, ...props }) => (
                    <blockquote
                      {...props}
                      className="mb-3 border-l-4 border-theme-border pl-4 text-theme-fg-secondary last:mb-0"
                    >
                      {children}
                    </blockquote>
                  ),
                  code: ({
                    children,
                    className: codeClassName,
                    node: _node,
                    ...props
                  }) => (
                    <code
                      {...props}
                      className={clsx(
                        "rounded bg-theme-bg-tertiary px-1 py-0.5 font-mono text-sm",
                        codeClassName,
                      )}
                    >
                      {children}
                    </code>
                  ),
                  h1: ({ children, node: _node, ...props }) => (
                    <h1
                      {...props}
                      className="mb-3 mt-5 text-2xl font-bold first:mt-0"
                    >
                      {children}
                    </h1>
                  ),
                  h2: ({ children, node: _node, ...props }) => (
                    <h2
                      {...props}
                      className="mb-3 mt-5 text-xl font-semibold first:mt-0"
                    >
                      {children}
                    </h2>
                  ),
                  h3: ({ children, node: _node, ...props }) => (
                    <h3
                      {...props}
                      className="mb-2 mt-4 text-lg font-semibold first:mt-0"
                    >
                      {children}
                    </h3>
                  ),
                  li: ({ children, node: _node, ...props }) => (
                    <li {...props} className="mb-1 last:mb-0">
                      {children}
                    </li>
                  ),
                  ol: ({ children, node: _node, ...props }) => (
                    <ol {...props} className="mb-3 list-decimal pl-6 last:mb-0">
                      {children}
                    </ol>
                  ),
                  p: ({ children, node: _node, ...props }) => (
                    <p {...props} className="mb-3 last:mb-0">
                      {children}
                    </p>
                  ),
                  pre: ({ children, node: _node, ...props }) => (
                    <pre
                      {...props}
                      className="mb-3 overflow-x-auto rounded bg-theme-bg-tertiary p-3 last:mb-0"
                    >
                      {children}
                    </pre>
                  ),
                  ul: ({ children, node: _node, ...props }) => (
                    <ul {...props} className="mb-3 list-disc pl-6 last:mb-0">
                      {children}
                    </ul>
                  ),
                }}
              >
                {value}
              </Markdown>
            ) : (
              <p className="text-theme-fg-muted">{emptyPreviewMessage}</p>
            )}
          </div>
        )}
      </div>
      {!isMarkdownTab && error && (
        <p className="px-4 pb-3 text-sm text-theme-error-fg" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
