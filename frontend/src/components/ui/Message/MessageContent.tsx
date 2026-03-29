import { t } from "@lingui/core/macro";
import React, { memo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import remarkGfm from "remark-gfm";

import { useTheme } from "@/components/providers/ThemeProvider";
import {
  DEFAULT_DARK_CODE_HIGHLIGHT_PRESET,
  DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET,
  resolvePrismCodeTheme,
} from "@/config/codeHighlightThemes";
import { useOptionalTranslation } from "@/hooks/i18n";
import { parseContent } from "@/utils/adapters/contentPartAdapter";

import { EratoEmailSuggestion } from "./EratoEmailSuggestion";
import { ImageContentDisplay } from "./ImageContentDisplay";

import type {
  ContentPart,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";
import type { Components } from "react-markdown";

interface MessageContentProps {
  content: ContentPart[];
  messageId?: string;
  isStreaming?: boolean;
  showRaw?: boolean;
  onImageClick?: (image: UiImagePart) => void;
  /** Map of file IDs to their metadata for erato-file:// link resolution */
  filesById?: Record<string, FileUploadItem>;
  onFileLinkPreview?: (file: FileUploadItem) => void;
}

const INLINE_CODE_CLASS_NAME =
  "rounded-md border border-theme-code-inline-border bg-theme-code-inline-bg px-1.5 py-0.5 font-mono text-sm text-theme-code-inline-fg";
const BlockCodeContext = React.createContext(false);
const BASE_BLOCK_CODE_CUSTOM_STYLE = {
  margin: 0,
  overflow: "visible",
} as const;

type MarkdownCodeProps = React.ComponentPropsWithoutRef<"code"> & {
  node?: unknown;
};

type MarkdownPreProps = React.ComponentPropsWithoutRef<"pre"> & {
  node?: unknown;
};

function MarkdownPre({
  node: _node,
  className,
  children,
  ...props
}: MarkdownPreProps) {
  return (
    <pre
      className={["message-content-code-block", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <BlockCodeContext.Provider value={true}>
        {children}
      </BlockCodeContext.Provider>
    </pre>
  );
}

function MarkdownCode({
  node: _node,
  className,
  children,
  ...props
}: MarkdownCodeProps) {
  const { effectiveTheme, theme } = useTheme();
  const isBlockCode = React.useContext(BlockCodeContext);
  const codeContent = String(children).replace(/\n$/, "");
  const match = /language-([\w-]+)/.exec(className ?? "");
  const language = match ? match[1] : "";
  const fallbackPreset =
    effectiveTheme === "dark"
      ? DEFAULT_DARK_CODE_HIGHLIGHT_PRESET
      : DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET;
  const syntaxTheme = resolvePrismCodeTheme(
    theme.codeHighlight.preset,
    fallbackPreset,
  );
  const blockCustomStyle = {
    ...BASE_BLOCK_CODE_CUSTOM_STYLE,
    ...theme.codeHighlight.blockStyle,
  };

  if (isBlockCode && language === "erato-email") {
    return <EratoEmailSuggestion content={codeContent} />;
  }

  if (isBlockCode) {
    return (
      <SyntaxHighlighter
        customStyle={blockCustomStyle}
        language={language || undefined}
        PreTag="div"
        style={syntaxTheme}
      >
        {codeContent}
      </SyntaxHighlighter>
    );
  }

  return (
    <code
      className={[INLINE_CODE_CLASS_NAME, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </code>
  );
}

const getPreviewUrl = (
  file: Pick<FileUploadItem, "preview_url">,
): string | undefined =>
  typeof file.preview_url === "string" ? file.preview_url : undefined;

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

const FOOTNOTE_DEFINITION_ID_REGEX = /^(?:user-content-)?fn-(.+)$/;
const FOOTNOTE_REFERENCE_ID_REGEX = /^(?:user-content-)?fnref-(.+)$/;

const rewriteFootnoteValue = (
  value: string | undefined,
  messageId: string | undefined,
): string | undefined => {
  if (!value || !messageId) {
    return value;
  }

  const isHashLink = value.startsWith("#");
  const rawValue = isHashLink ? value.slice(1) : value;

  const definitionMatch = rawValue.match(FOOTNOTE_DEFINITION_ID_REGEX);
  if (definitionMatch) {
    const scopedId = `message-${messageId}-fn-${definitionMatch[1]}`;
    return isHashLink ? `#${scopedId}` : scopedId;
  }

  const referenceMatch = rawValue.match(FOOTNOTE_REFERENCE_ID_REGEX);
  if (referenceMatch) {
    const scopedId = `message-${messageId}-fnref-${referenceMatch[1]}`;
    return isHashLink ? `#${scopedId}` : scopedId;
  }

  return value;
};

export const MessageContent = memo(function MessageContent({
  content,
  messageId,
  isStreaming = false,
  showRaw = false,
  onImageClick,
  filesById = {},
  onFileLinkPreview,
}: MessageContentProps) {
  const imageAdvisory = useOptionalTranslation("chat.message.image_advisory");

  // Parse content efficiently in a single pass
  const { text: textContent, images } = parseContent(content);
  const linkedTextContent = autolinkEratoFiles(textContent);

  // For streaming, still show cursor on text
  const displayText =
    isStreaming && !linkedTextContent.endsWith("\n")
      ? linkedTextContent + "▊"
      : linkedTextContent;

  const resolveEratoFileLink = React.useCallback(
    (
      url: string,
    ): { previewFile: FileUploadItem; resolvedHref: string } | null => {
      // eslint-disable-next-line lingui/no-unlocalized-strings
      if (!url.startsWith("erato-file://")) {
        return null;
      }

      try {
        const urlObj = new URL(url);
        const fileId = urlObj.hostname || urlObj.pathname.replace(/^\/\//, "");
        if (!(fileId in filesById)) {
          return null;
        }
        const file = filesById[fileId];
        const previewUrl = getPreviewUrl(file) ?? file.download_url;

        if (!previewUrl) {
          return null;
        }

        let pageParam = urlObj.searchParams.get("page");
        if (!pageParam && urlObj.hash) {
          const hashMatch = urlObj.hash.match(/^#page=(\d+)$/);
          if (hashMatch) {
            pageParam = hashMatch[1];
          }
        }

        const resolvedHref = pageParam
          ? `${previewUrl}#page=${pageParam}`
          : previewUrl;

        return {
          resolvedHref,
          previewFile:
            pageParam && file.filename.toLowerCase().endsWith(".pdf")
              ? ({
                  ...file,
                  preview_url: resolvedHref,
                } as unknown as FileUploadItem)
              : file,
        };
      } catch (error) {
        console.warn("Failed to parse erato-file:// URL:", url, error);
        return null;
      }
    },
    [filesById],
  );

  // If showing raw, just show text
  if (showRaw) {
    return (
      <article className="max-w-none font-sans text-base">
        <pre className="message-content-raw-block whitespace-pre-wrap">
          <code>{displayText}</code>
        </pre>
      </article>
    );
  }

  // Define custom components for react-markdown
  const markdownComponents: Partial<Components> = {
    pre: MarkdownPre,
    code: MarkdownCode,
    // Ensure links open in new tab
    a({ href, id, children, node: _node, ...props }) {
      const rewrittenHref = rewriteFootnoteValue(href, messageId);
      const rewrittenId = rewriteFootnoteValue(id, messageId);
      const isHashLink = rewrittenHref?.startsWith("#") ?? false;
      const resolvedEratoFile = rewrittenHref
        ? resolveEratoFileLink(rewrittenHref)
        : null;
      const finalHref =
        resolvedEratoFile?.resolvedHref ??
        rewrittenHref ??
        "#missing-link-target";

      return (
        <a
          href={finalHref}
          id={rewrittenId}
          target={isHashLink || resolvedEratoFile ? undefined : "_blank"}
          rel={
            isHashLink || resolvedEratoFile ? undefined : "noopener noreferrer"
          }
          className="text-theme-fg-accent underline hover:opacity-80"
          onClick={(event) => {
            if (!resolvedEratoFile) {
              return;
            }

            event.preventDefault();
            onFileLinkPreview?.(resolvedEratoFile.previewFile);
          }}
          {...props}
        >
          {children}
        </a>
      );
    },
    // Custom table styling
    table({ children, node: _node, ...props }) {
      return (
        <div className="my-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-theme-border" {...props}>
            {children}
          </table>
        </div>
      );
    },
    // Table header
    th({ children, node: _node, ...props }) {
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
    td({ children, node: _node, ...props }) {
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
    h1({ children, node: _node, ...props }) {
      return (
        <h1
          className="mb-4 mt-6 font-heading-bold text-2xl font-bold text-theme-fg-primary"
          {...props}
        >
          {children}
        </h1>
      );
    },
    h2({ children, node: _node, ...props }) {
      return (
        <h2
          className="mb-3 mt-5 font-heading text-xl font-semibold text-theme-fg-primary"
          {...props}
        >
          {children}
        </h2>
      );
    },
    h3({ children, node: _node, ...props }) {
      return (
        <h3
          className="mb-2 mt-4 font-heading text-lg font-semibold text-theme-fg-primary"
          {...props}
        >
          {children}
        </h3>
      );
    },
    // Blockquote
    blockquote({ children, node: _node, ...props }) {
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
    ul({ children, node: _node, ...props }) {
      return (
        <ul className="my-3 list-disc pl-6 text-theme-fg-primary" {...props}>
          {children}
        </ul>
      );
    },
    ol({ children, node: _node, ...props }) {
      return (
        <ol className="my-3 list-decimal pl-6 text-theme-fg-primary" {...props}>
          {children}
        </ol>
      );
    },
    li({ children, id, node: _node, ...props }) {
      return (
        <li
          className="my-1 text-theme-fg-primary"
          id={rewriteFootnoteValue(id, messageId)}
          {...props}
        >
          {children}
        </li>
      );
    },
    // Horizontal rule
    hr({ node: _node, ...props }) {
      return <hr className="my-6 border-theme-border" {...props} />;
    },
    // Strong/Bold
    strong({ children, node: _node, ...props }) {
      return (
        <strong
          className="font-body-semibold font-semibold text-theme-fg-primary"
          {...props}
        >
          {children}
        </strong>
      );
    },
    // Emphasis/Italic
    em({ children, node: _node, ...props }) {
      return (
        <em className="italic" {...props}>
          {children}
        </em>
      );
    },
    // Handle incomplete markdown gracefully
    p({ children, node: _node, ...props }) {
      return (
        <p className="mb-4 text-theme-fg-primary last:mb-0" {...props}>
          {children}
        </p>
      );
    },
    // Footnote references - render as inline instead of superscript
    sup({ children, node: _node, ...props }) {
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
            <h2 className="mb-3 font-heading text-lg font-semibold text-theme-fg-primary">
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
  };

  // Create dynamic components based on streaming state
  const components: Partial<Components> = {
    ...markdownComponents,
    // Override p component for streaming to handle incomplete markdown
    p: isStreaming
      ? ({ children, node: _node, ...props }) => {
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
  };

  return (
    <article className="max-w-none font-sans text-base">
      {/* Render markdown text */}
      {textContent && (
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={components}
          urlTransform={(url) =>
            // eslint-disable-next-line lingui/no-unlocalized-strings
            url.startsWith("erato-file://") ? url : defaultUrlTransform(url)
          }
          // Handle incomplete markdown patterns gracefully
          skipHtml={false}
          unwrapDisallowed={false}
        >
          {displayText}
        </Markdown>
      )}

      {/* Render images */}
      {images.length > 0 && (
        <>
          <ImageContentDisplay images={images} onImageClick={onImageClick} />
          {imageAdvisory && (
            <p className="mt-2 text-xs text-theme-fg-muted">{imageAdvisory}</p>
          )}
        </>
      )}
    </article>
  );
});
