import React, { memo } from "react";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import type { Components } from "react-markdown";

interface MessageContentProps {
  content: string;
  isStreaming?: boolean;
  showRaw?: boolean;
}

// Define custom components for react-markdown
const markdownComponents: Partial<Components> = {
  // Custom code block rendering with syntax highlighting
  // @ts-expect-error - react-markdown types don't expose inline prop
  code({ inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const language = match ? match[1] : "";

    if (!inline && language) {
      return (
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          className="!my-4 rounded-md"
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      );
    }

    return (
      <code
        className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800"
        {...props}
      >
        {children}
      </code>
    );
  },
  // Ensure links open in new tab
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        {...props}
      >
        {children}
      </a>
    );
  },
  // Custom table styling
  table({ children, ...props }) {
    return (
      <div className="my-4 overflow-x-auto">
        <table
          className="min-w-full divide-y divide-gray-200 dark:divide-gray-700"
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  // Handle incomplete markdown gracefully
  p({ children, ...props }) {
    return (
      <p className="mb-4 last:mb-0" {...props}>
        {children}
      </p>
    );
  },
};

export const MessageContent = memo(function MessageContent({
  content,
  isStreaming = false,
  showRaw = false,
}: MessageContentProps) {
  // For streaming content, append a cursor if the content doesn't end with a newline
  const displayContent =
    isStreaming && !content.endsWith("\n") ? content + "▊" : content;

  // If showing raw markdown, render as preformatted text
  if (showRaw) {
    return (
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <pre className="whitespace-pre-wrap rounded-md bg-gray-100 p-4 font-mono text-sm dark:bg-gray-800">
          <code>{displayContent}</code>
        </pre>
      </article>
    );
  }

  // Create dynamic components based on streaming state
  const components: Partial<Components> = {
    ...markdownComponents,
    // Override p component for streaming to handle incomplete markdown
    p: isStreaming
      ? ({ children, ...props }) => {
          // Check if this paragraph contains only incomplete markdown
          if (
            typeof children === "string" &&
            children.match(/^(\*{1,2}|_{1,2}|~{1,2}|`{1,3})[^*_~`]*$/)
          ) {
            return (
              <span className="whitespace-pre-wrap" {...props}>
                {children}
              </span>
            );
          }
          return (
            <p className="mb-4 last:mb-0" {...props}>
              {children}
            </p>
          );
        }
      : markdownComponents.p,
  };

  return (
    <article className="prose prose-slate dark:prose-invert max-w-none">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={components}
        // Handle incomplete markdown patterns gracefully
        skipHtml={false}
        unwrapDisallowed={false}
      >
        {displayContent}
      </Markdown>
    </article>
  );
});
