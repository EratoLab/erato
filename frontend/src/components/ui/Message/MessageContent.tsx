import { t } from "@lingui/core/macro";
import React, { memo, useMemo } from "react";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import { useTheme } from "@/components/providers/ThemeProvider";
import { parseContent } from "@/utils/adapters/contentPartAdapter";

import { ImageContentDisplay } from "./ImageContentDisplay";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";
import type { Components } from "react-markdown";

interface MessageContentProps {
  content: ContentPart[];
  isStreaming?: boolean;
  showRaw?: boolean;
  onImageClick?: (image: UiImagePart) => void;
  /** Map of file IDs to their download URLs for erato-file:// link resolution */
  fileDownloadUrls?: Record<string, string>;
}

const autolinkEratoFiles = (text: string): string => {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  if (!text.includes("erato-file://")) {
    return text;
  }

  const urlRegex = /erato-file:\/\/[^\s)]+/g;

  return text.replace(urlRegex, (match, offset) => {
    const prevChar = text.charAt(offset - 1);
    if (prevChar === "(") {
      return match;
    }
    return `[${t`Link`}](${match})`;
  });
};

export const MessageContent = memo(function MessageContent({
  content,
  isStreaming = false,
  showRaw = false,
  onImageClick,
  fileDownloadUrls = {},
}: MessageContentProps) {
  const { effectiveTheme } = useTheme();
  const isDarkMode = effectiveTheme === "dark";

  // Parse content efficiently in a single pass
  const { text: textContent, images } = parseContent(content);
  const linkedTextContent = autolinkEratoFiles(textContent);

  // For streaming, still show cursor on text
  const displayText =
    isStreaming && !linkedTextContent.endsWith("\n")
      ? linkedTextContent + "▊"
      : linkedTextContent;

  // URL transform function to handle erato-file:// protocol
  const transformUrl = React.useCallback(
    (url: string) => {
      // eslint-disable-next-line lingui/no-unlocalized-strings
      if (url.startsWith("erato-file://")) {
        try {
          // Parse the URL to extract file ID and page parameter
          const urlObj = new URL(url);
          const fileId =
            urlObj.hostname || urlObj.pathname.replace(/^\/\//, "");
          console.log({ fileId });
          console.log({ fileDownloadUrls });

          // Check for page parameter in both query string (?page=N) and hash fragment (#page=N)
          let pageParam = urlObj.searchParams.get("page");
          if (!pageParam && urlObj.hash) {
            // Parse hash fragment for page parameter (e.g., #page=4)
            const hashMatch = urlObj.hash.match(/^#page=(\d+)$/);
            if (hashMatch) {
              pageParam = hashMatch[1];
            }
          }

          // Look up the download URL for this file
          const downloadUrl = fileDownloadUrls[fileId];

          if (downloadUrl) {
            // Construct the final URL with the page parameter
            return pageParam ? `${downloadUrl}#page=${pageParam}` : downloadUrl;
          }

          // If file not found, return a hash to prevent navigation
          return "#file-not-found";
        } catch (error) {
          console.warn("Failed to parse erato-file:// URL:", url, error);
          return "#invalid-url";
        }
      }

      // Return unchanged URL for all other protocols
      return url;
    },
    [fileDownloadUrls],
  );

  // Define custom components for react-markdown
  // Memoize to prevent recreating on every render
  // Must be called before any conditional returns
  const markdownComponents: Partial<Components> = useMemo(
    () => ({
    // Custom code block rendering with syntax highlighting
    // @ts-expect-error - react-markdown types don't expose inline prop
    code({ inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className ?? "");
      const language = match ? match[1] : "";

      if (!inline && language) {
        return (
          <SyntaxHighlighter
            style={isDarkMode ? oneDark : oneLight}
            language={language}
            PreTag="div"
            className="!my-4 rounded-md"
            customStyle={{
              margin: "1rem 0",
              background: "var(--theme-bg-tertiary)",
              fontSize: "0.875rem", // eslint-disable-line lingui/no-unlocalized-strings
            }}
          >
            {String(children).replace(/\n$/, "")}
          </SyntaxHighlighter>
        );
      }

      return (
        <code
          className="rounded-sm bg-theme-bg-tertiary px-1 py-0.5 text-theme-fg-secondary"
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
          className="text-theme-fg-accent underline hover:opacity-80"
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
          <table className="min-w-full divide-y divide-theme-border" {...props}>
            {children}
          </table>
        </div>
      );
    },
    // Table header
    th({ children, ...props }) {
      return (
        <th
          className="bg-theme-bg-secondary px-4 py-2 text-left text-sm font-medium text-theme-fg-primary"
          {...props}
        >
          {children}
        </th>
      );
    },
    // Table cell
    td({ children, ...props }) {
      return (
        <td
          className="border-t border-theme-border px-4 py-2 text-sm text-theme-fg-secondary"
          {...props}
        >
          {children}
        </td>
      );
    },
    // Headers
    h1({ children, ...props }) {
      return (
        <h1
          className="mb-4 mt-6 text-2xl font-bold text-theme-fg-primary"
          {...props}
        >
          {children}
        </h1>
      );
    },
    h2({ children, ...props }) {
      return (
        <h2
          className="mb-3 mt-5 text-xl font-semibold text-theme-fg-primary"
          {...props}
        >
          {children}
        </h2>
      );
    },
    h3({ children, ...props }) {
      return (
        <h3
          className="mb-2 mt-4 text-lg font-semibold text-theme-fg-primary"
          {...props}
        >
          {children}
        </h3>
      );
    },
    // Blockquote
    blockquote({ children, ...props }) {
      return (
        <blockquote
          className="my-4 border-l-4 border-theme-border pl-4 italic text-theme-fg-secondary"
          {...props}
        >
          {children}
        </blockquote>
      );
    },
    // Lists
    ul({ children, ...props }) {
      return (
        <ul className="my-3 list-disc pl-6 text-theme-fg-primary" {...props}>
          {children}
        </ul>
      );
    },
    ol({ children, ...props }) {
      return (
        <ol className="my-3 list-decimal pl-6 text-theme-fg-primary" {...props}>
          {children}
        </ol>
      );
    },
    li({ children, ...props }) {
      return (
        <li className="my-1 text-theme-fg-primary" {...props}>
          {children}
        </li>
      );
    },
    // Horizontal rule
    hr({ ...props }) {
      return <hr className="my-6 border-theme-border" {...props} />;
    },
    // Strong/Bold
    strong({ children, ...props }) {
      return (
        <strong className="font-semibold text-theme-fg-primary" {...props}>
          {children}
        </strong>
      );
    },
    // Emphasis/Italic
    em({ children, ...props }) {
      return (
        <em className="italic" {...props}>
          {children}
        </em>
      );
    },
    // Handle incomplete markdown gracefully
    p({ children, ...props }) {
      return (
        <p className="mb-4 text-theme-fg-primary last:mb-0" {...props}>
          {children}
        </p>
      );
    },
    // Footnote references - render as inline instead of superscript
    sup({ children, ...props }) {
      return (
        <span className="inline" {...props}>
          {children}
        </span>
      );
    },
    // Custom footnotes section with translated heading
    section({ children, node, ...props }) {
      // Check if this is the footnotes section
      // react-markdown may pass data-footnotes in different ways
      const sectionProps = props as Record<string, unknown>;
      const isFootnotes =
        sectionProps["data-footnotes"] === "true" ||
        sectionProps["data-footnotes"] === true ||
        sectionProps["dataFootnotes"] === "true" ||
        sectionProps["dataFootnotes"] === true ||
        // Also check the node properties from the AST
        (node?.properties as Record<string, unknown> | undefined)?.[
          "dataFootnotes"
        ] === true;

      if (isFootnotes) {
        return (
          <section
            className="mt-6 border-t border-theme-border pt-4"
            data-footnotes="true"
          >
            <h2 className="mb-3 text-lg font-semibold text-theme-fg-primary">
              {t`Footnotes`}
            </h2>
            {/* Filter out the auto-generated h2 from children */}
            {React.Children.toArray(children).filter(
              (child) =>
                !React.isValidElement(child) ||
                (child.type !== "h2" &&
                  (child.props as { id?: string }).id !== "footnote-label"),
            )}
          </section>
        );
      }

      return <section {...props}>{children}</section>;
    },
    }),
    [isDarkMode],
  );

  // Create dynamic components based on streaming state
  // Memoize to prevent recreating on every render
  const components: Partial<Components> = useMemo(
    () => ({
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
                <span
                  className="whitespace-pre-wrap text-theme-fg-primary"
                  {...props}
                >
                  {children}
                </span>
              );
            }
            return (
              <p className="mb-4 text-theme-fg-primary last:mb-0" {...props}>
                {children}
              </p>
            );
          }
        : markdownComponents.p,
    }),
    [markdownComponents, isStreaming],
  );

  // If showing raw, just show text (after hooks are called)
  if (showRaw) {
    return (
      <article className="max-w-none">
        <pre className="whitespace-pre-wrap rounded-md bg-theme-bg-tertiary p-4 font-mono text-sm text-theme-fg-primary">
          <code>{displayText}</code>
        </pre>
      </article>
    );
  }

  return (
    <article className="max-w-none">
      {/* Render markdown text */}
      {textContent && (
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={components}
          urlTransform={transformUrl}
          // Handle incomplete markdown patterns gracefully
          skipHtml={false}
          unwrapDisallowed={false}
        >
          {displayText}
        </Markdown>
      )}

      {/* Render images */}
      {images.length > 0 && (
        <ImageContentDisplay images={images} onImageClick={onImageClick} />
      )}
    </article>
  );
});
