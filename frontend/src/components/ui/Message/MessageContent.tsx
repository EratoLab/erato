import { t } from "@lingui/core/macro";
import clsx from "clsx";
import React, { memo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import remarkGfm from "remark-gfm";

import { useTheme } from "@/components/providers/ThemeProvider";
import {
  Trace,
  durationFromTracePartsOrLegacyMessageTimestamps,
  groupIntoTraceClusters,
} from "@/components/ui/Trace";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import {
  DEFAULT_DARK_CODE_HIGHLIGHT_PRESET,
  DEFAULT_LIGHT_CODE_HIGHLIGHT_PRESET,
  resolvePrismCodeTheme,
} from "@/config/codeHighlightThemes";
import { useOptionalTranslation } from "@/hooks/i18n";
import { useTraceFeature } from "@/providers/FeatureConfigProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import { EratoEmailSuggestion } from "./EratoEmailSuggestion";
import { ImageContentDisplay } from "./ImageContentDisplay";

import type {
  ContentPart,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";
import type { OutlookArtifact } from "@/utils/adapters/messageAdapter";
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
  /** Preserve soft markdown line breaks as visual line breaks. */
  preserveSoftLineBreaks?: boolean;
  /**
   * Message-level timestamps used to compute the trace cluster's "Thought
   * for X" cold-load summary. Both should be ISO-8601; either may be missing.
   */
  createdAt?: string;
  updatedAt?: string;
  /** When true, the cold-load trace pill flips to "Stopped after X". */
  hasError?: boolean;
  /**
   * Present when this assistant message was generated under an Outlook action
   * facet. When set, a fenced block is treated as the email insert/replace
   * artifact regardless of the exact language tag (newer models drift it), and
   * a `rewrite_selection` response with no fence at all falls back to rendering
   * the whole body as the artifact. Absent on the web app, so behavior there is
   * unchanged. See {@link OutlookArtifact}.
   */
  outlookArtifact?: OutlookArtifact;
}

/**
 * Tags newer models drift to when they drop the `erato-email` convention.
 * Only consulted when an Outlook facet produced the message (see
 * {@link OutlookArtifactContext}), so generic chat code blocks are never
 * hijacked. HTML-vs-text is then taken from the facet's `body_format`, not the
 * tag (the `-html` suffix is exactly what the model keeps normalizing away).
 */
const DRIFTED_EMAIL_TAGS = new Set([
  "",
  "email",
  "erato",
  "erato-email-text",
  "text",
  "plaintext",
  "plain",
  "html",
]);

function classifyEratoEmailBlock(
  language: string,
  artifact: OutlookArtifact | null,
): { isEmail: boolean; isHtml: boolean } {
  // Canonical tags always render as the artifact — back-compat for both web and
  // addin, independent of any facet context.
  if (language === "erato-email") {
    return { isEmail: true, isHtml: false };
  }
  if (language === "erato-email-html") {
    return { isEmail: true, isHtml: true };
  }
  // Only when we KNOW a facet produced this message do we accept drifted tags,
  // and we trust the facet's body_format over the (unreliable) tag.
  if (artifact && DRIFTED_EMAIL_TAGS.has(language.toLowerCase())) {
    return { isEmail: true, isHtml: artifact.bodyFormat === "html" };
  }
  return { isEmail: false, isHtml: false };
}

function containsMarkdownFence(text: string): boolean {
  return /^[^\S\n]*```/m.test(text);
}

const OutlookArtifactContext = React.createContext<OutlookArtifact | null>(
  null,
);

/**
 * The Outlook artifact hint for the message currently being rendered, or null
 * outside an Outlook-facet message. Exposed so registry overrides (e.g. the
 * add-in's erato-email renderer) can read facet metadata such as the allowed
 * and proposed client actions without new props on every code block.
 */
export function useOutlookArtifact(): OutlookArtifact | null {
  return React.useContext(OutlookArtifactContext);
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

function isEratoEmailCodeChild(
  children: React.ReactNode,
  artifact: OutlookArtifact | null,
): boolean {
  const child = React.Children.only(children) as React.ReactElement<{
    className?: string;
  }>;
  const cls = child.props.className ?? "";
  const match = /language-([\w-]+)/.exec(cls);
  const language = match ? match[1] : "";
  return classifyEratoEmailBlock(language, artifact).isEmail;
}

function MarkdownPre({
  node: _node,
  className,
  children,
  ...props
}: MarkdownPreProps) {
  const artifact = React.useContext(OutlookArtifactContext);
  const [copied, setCopied] = React.useState(false);

  // Extract the raw code text from the child <code> element so the copy button
  // can access it without needing a separate context or ref strategy.
  let codeContent = "";
  try {
    const child = React.Children.only(children) as React.ReactElement<{
      children?: React.ReactNode;
    }>;
    codeContent = String(child.props.children ?? "").replace(/\n$/, "");
  } catch {
    // Non-standard children structure — leave codeContent empty.
  }

  const handleCopy = React.useCallback(() => {
    void navigator.clipboard
      .writeText(codeContent)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }, [codeContent]);

  // erato-email blocks render a custom component, not a code block —
  // use a plain <div> to avoid inheriting <pre> monospace font and
  // horizontal scroll from message-content-code-block styling.
  try {
    if (isEratoEmailCodeChild(children, artifact)) {
      return (
        <div>
          <BlockCodeContext.Provider value={true}>
            {children}
          </BlockCodeContext.Provider>
        </div>
      );
    }
  } catch {
    // Children structure didn't match — fall through to default <pre>.
  }

  return (
    <div className="group relative my-4">
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
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? t`Copied` : t`Copy code`}
        title={copied ? t`Copied` : t`Copy code`}
        className="absolute right-2 top-2 z-10 flex items-center justify-center rounded border border-theme-border bg-theme-bg-secondary p-1 text-theme-fg-muted opacity-0 transition-opacity hover:bg-theme-bg-tertiary hover:text-theme-fg-primary focus:opacity-100 group-hover:opacity-100"
      >
        {copied ? (
          <CheckIcon className="size-3.5 text-theme-success-fg" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </button>
    </div>
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
  const artifact = React.useContext(OutlookArtifactContext);
  const codeContent = String(children).replace(/\n$/, "");
  const match = /language-([\w-]+)/.exec(className ?? "");
  const language = match ? match[1] : "";
  const emailBlock = classifyEratoEmailBlock(language, artifact);
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

  if (isBlockCode && emailBlock.isEmail) {
    return (
      <EratoEmailSuggestion content={codeContent} isHtml={emailBlock.isHtml} />
    );
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

const ERATO_FILE_URL_REGEX = /erato-file:\/\/[^\s)]+/g;

const isImageFile = (file: FileUploadItem): boolean =>
  // eslint-disable-next-line lingui/no-unlocalized-strings
  file.file_capability.operations.includes("analyze_image") ||
  FileTypeUtil.getFileTypeFromMetadata(
    file.filename,
    file.file_capability.mime_types[0] ?? "",
  ) === "image";

const autolinkEratoFiles = (text: string): string => {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  if (!text.includes("erato-file://")) {
    return text;
  }

  return text.replace(ERATO_FILE_URL_REGEX, (match, offset) => {
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

const isRenderableContentPart = (part: ContentPart): boolean =>
  part.content_type === "text" ||
  part.content_type === "reasoning" ||
  part.content_type === "tool_use" ||
  part.content_type === "image" ||
  part.content_type === "image_file_pointer";

const contentPartToImage = (
  part: ContentPart,
  index: number,
): UiImagePart | null => {
  if (part.content_type === "image") {
    return {
      type: "image",
      src: `data:image/png;base64,${part.base64_data}`,
      id: `image-base64-${index}`,
    };
  }

  if (part.content_type === "image_file_pointer") {
    return {
      type: "image",
      src: part.preview_url ?? part.download_url ?? "",
      id: part.file_upload_id,
      fileUploadId: part.file_upload_id,
    };
  }

  return null;
};

const MARKDOWN_IMAGE_STYLE = {
  maxWidth: "var(--theme-layout-chat-image-preview-max-width)",
  maxHeight: "var(--theme-layout-chat-image-preview-max-height)",
} as const;
const UNRESOLVED_IMAGE_ANCHOR = "#unresolved-link";

const getEratoFileIdFromUrl = (url: string): string | null => {
  // eslint-disable-next-line lingui/no-unlocalized-strings
  if (!url.startsWith("erato-file://")) {
    return null;
  }

  try {
    const urlObj = new URL(url);
    return urlObj.hostname || urlObj.pathname.replace(/^\/\//, "");
  } catch {
    return null;
  }
};

const extractReferencedEratoFileIds = (text: string): Set<string> => {
  const fileIds = new Set<string>();

  for (const match of text.matchAll(ERATO_FILE_URL_REGEX)) {
    const fileId = getEratoFileIdFromUrl(match[0]);
    if (fileId) {
      fileIds.add(fileId);
    }
  }

  return fileIds;
};

export const MessageContent = memo(function MessageContent({
  content,
  messageId,
  isStreaming = false,
  showRaw = false,
  onImageClick,
  filesById = {},
  onFileLinkPreview,
  preserveSoftLineBreaks = false,
  createdAt,
  updatedAt,
  hasError = false,
  outlookArtifact,
}: MessageContentProps) {
  const imageAdvisory = useOptionalTranslation("chat.message.image_advisory");
  const { maskReasoningText } = useTraceFeature();

  const generatedImageFileIds = React.useMemo(() => {
    const fileIds = new Set<string>();

    content.forEach((part) => {
      if (part.content_type === "image_file_pointer") {
        fileIds.add(part.file_upload_id);
      }
    });

    return fileIds;
  }, [content]);

  const textReferencedEratoFileIds = React.useMemo(() => {
    const fileIds = new Set<string>();

    content.forEach((part) => {
      if (part.content_type !== "text") {
        return;
      }

      extractReferencedEratoFileIds(part.text).forEach((fileId) => {
        fileIds.add(fileId);
      });
    });

    return fileIds;
  }, [content]);

  const resolveEratoFileLink = React.useCallback(
    (
      url: string,
    ): { previewFile: FileUploadItem; resolvedHref: string } | null => {
      const fileId = getEratoFileIdFromUrl(url);
      if (!fileId) {
        return null;
      }

      try {
        const urlObj = new URL(url);
        if (!(fileId in filesById)) {
          return null;
        }
        const file = filesById[fileId];
        const isUnavailableMissingPermissions =
          file.file_contents_unavailable_missing_permissions;
        const previewUrl = getPreviewUrl(file);

        if (!previewUrl && !isUnavailableMissingPermissions) {
          return null;
        }

        let pageParam = urlObj.searchParams.get("page");
        if (!pageParam && urlObj.hash) {
          const hashMatch = urlObj.hash.match(/^#page=(\d+)$/);
          if (hashMatch) {
            pageParam = hashMatch[1];
          }
        }

        const resolvedHref =
          pageParam && previewUrl
            ? `${previewUrl}#page=${pageParam}`
            : (previewUrl ?? "#");

        return {
          resolvedHref,
          previewFile:
            pageParam && file.filename.toLowerCase().endsWith(".pdf")
              ? {
                  ...file,
                  preview_url: resolvedHref,
                }
              : file,
        };
      } catch (error) {
        console.warn("Failed to parse erato-file:// URL:", url, error);
        return null;
      }
    },
    [filesById],
  );

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
    img({ src, alt, node: _node, ...props }) {
      const resolvedEratoFile = src ? resolveEratoFileLink(src) : null;
      const isEratoFileImageUrl =
        // eslint-disable-next-line lingui/no-unlocalized-strings
        typeof src === "string" ? src.startsWith("erato-file://") : false;
      const isEratoFileImage =
        resolvedEratoFile && isImageFile(resolvedEratoFile.previewFile);
      const unresolvedSrc =
        isEratoFileImageUrl && !resolvedEratoFile
          ? `${src}${UNRESOLVED_IMAGE_ANCHOR}`
          : src;
      const resolvedSrc =
        resolvedEratoFile?.resolvedHref ?? unresolvedSrc ?? "";

      if (!isEratoFileImage) {
        if (resolvedEratoFile) {
          // Preserve link resolution for known non-image attachments.
          return (
            <a
              href={resolvedSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-fg-accent underline hover:opacity-80"
              onClick={(event) => {
                if (!onFileLinkPreview) {
                  return;
                }

                event.preventDefault();
                onFileLinkPreview(resolvedEratoFile.previewFile);
              }}
            >
              {typeof alt === "string" ? alt : t`Image`}
            </a>
          );
        }

        if (isEratoFileImageUrl) {
          return (
            <a
              href={unresolvedSrc ?? UNRESOLVED_IMAGE_ANCHOR}
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-fg-accent underline hover:opacity-80"
            >
              {typeof alt === "string" ? alt : t`Image`}
            </a>
          );
        }

        return (
          <img
            src={resolvedSrc}
            alt={typeof alt === "string" ? alt : ""}
            loading="lazy"
            {...props}
          />
        );
      }

      const imagePart: UiImagePart = {
        type: "image" as const,
        src: resolvedSrc,
        id: resolvedEratoFile.previewFile.id,
        fileUploadId: resolvedEratoFile.previewFile.id,
      };
      const shouldShowInlineImageAdvisory =
        !!imageAdvisory &&
        !!imagePart.fileUploadId &&
        generatedImageFileIds.has(imagePart.fileUploadId);

      const imageElement = (
        <img
          src={resolvedSrc}
          alt={typeof alt === "string" ? alt : ""}
          loading="lazy"
          className="w-full rounded-lg border object-contain [border-color:var(--theme-border-media)]"
          style={MARKDOWN_IMAGE_STYLE}
          {...props}
        />
      );

      const advisoryElement = shouldShowInlineImageAdvisory ? (
        <span className="mt-2 block text-xs text-theme-fg-muted">
          {imageAdvisory}
        </span>
      ) : null;

      if (onImageClick) {
        return (
          <>
            <button
              type="button"
              className={clsx(
                "block w-full cursor-pointer border-0 bg-transparent p-0",
                shouldShowInlineImageAdvisory ? "mt-4" : "my-4",
              )}
              onClick={() =>
                onImageClick({
                  ...imagePart,
                  src: imagePart.src,
                })
              }
            >
              {imageElement}
            </button>
            {advisoryElement}
          </>
        );
      }

      return (
        <>
          {imageElement}
          {advisoryElement}
        </>
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

  const renderMarkdown = (text: string) => {
    const linkedTextContent = autolinkEratoFiles(text);

    return (
      <OutlookArtifactContext.Provider value={outlookArtifact ?? null}>
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
          {linkedTextContent}
        </Markdown>
      </OutlookArtifactContext.Provider>
    );
  };

  // Whole-body fallback: a `"body"`-mode facet response whose email the model
  // emitted with NO fence at all (common with newer models) — there's no code
  // block for the tolerant tag-matching to catch, so treat the message text
  // itself as the insert/replace artifact. Gated to completed messages and to
  // `renderMode === "body"`: `"suggestions"` facets (review/critique) are
  // feedback, not a single drop-in body, so they keep normal markdown. The
  // producer (add-in AddinChat) decides whether an ambient-reply facet's plain
  // answer should card and stamps the verdict as `shouldRenderEmailCard`;
  // absent (web app, or a facet that always cards) is treated as `true`. This
  // single field is the source of truth shared with the add-in renderer — see
  // {@link OutlookArtifact.shouldRenderEmailCard}.
  const textForArtifact = React.useMemo(
    () =>
      content
        .filter((part) => part.content_type === "text")
        .map((part) => part.text)
        .join("\n\n"),
    [content],
  );
  const wholeBodyArtifact =
    outlookArtifact?.renderMode === "body" &&
    !isStreaming &&
    !showRaw &&
    textForArtifact.trim().length > 0 &&
    !containsMarkdownFence(textForArtifact) &&
    (outlookArtifact.shouldRenderEmailCard ?? true)
      ? outlookArtifact
      : null;

  // Index of the first text part — the single anchor at which the whole-body
  // artifact is rendered, so a multi-part body becomes one artifact rather than
  // one per text part (each with its own insert/copy UI).
  const firstTextPartIndex = React.useMemo(
    () => content.findIndex((part) => part.content_type === "text"),
    [content],
  );

  const lastRenderableIndex = React.useMemo(() => {
    for (let index = content.length - 1; index >= 0; index--) {
      if (isRenderableContentPart(content[index])) {
        return index;
      }
    }

    return -1;
  }, [content]);

  const clusters = React.useMemo(
    () => groupIntoTraceClusters(content),
    [content],
  );

  const traceDurationMs = React.useMemo(
    () =>
      durationFromTracePartsOrLegacyMessageTimestamps(
        content,
        createdAt,
        updatedAt,
      ),
    [content, createdAt, updatedAt],
  );

  // If showing raw, just show text-like content without rendering markdown.
  // When reasoning text is masked, omit reasoning parts from raw display too.
  if (showRaw) {
    const rawText = content
      .flatMap((part): string[] => {
        if (part.content_type === "text") return [part.text];
        if (!maskReasoningText && part.content_type === "reasoning")
          return [part.text ?? ""];
        return [];
      })
      .join("\n\n");

    return (
      <article className="max-w-none font-sans text-base">
        <pre className="message-content-raw-block whitespace-pre-wrap">
          <code>{rawText}</code>
        </pre>
      </article>
    );
  }

  return (
    <article
      className={clsx(
        "max-w-none font-sans text-base",
        preserveSoftLineBreaks && "whitespace-pre-wrap",
      )}
    >
      {clusters.map((cluster) => {
        if (cluster.kind === "trace") {
          // The trace block is the "current writer" while no later renderable
          // (text/image) content exists below it.
          const lastTracePartIndex =
            cluster.startIndex + cluster.parts.length - 1;
          const hasLaterContent = content
            .slice(lastTracePartIndex + 1)
            .some(isRenderableContentPart);

          return (
            <Trace
              key={`trace-${cluster.startIndex}`}
              parts={cluster.parts}
              isStreaming={!!isStreaming}
              hasLaterContent={hasLaterContent}
              renderMarkdown={renderMarkdown}
              durationMs={traceDurationMs}
              hasError={hasError}
            />
          );
        }

        const { part, index } = cluster;
        const isLastRenderablePart = index === lastRenderableIndex;

        if (part.content_type === "text") {
          if (wholeBodyArtifact) {
            // One artifact for the whole message: render it at the first text
            // part from the joined body, and drop the remaining text parts so a
            // multi-part response doesn't fragment into duplicate insert/copy
            // cards. (For a single text part `textForArtifact` is that part.)
            if (index !== firstTextPartIndex) {
              return null;
            }
            return (
              <EratoEmailSuggestion
                key={`email-body-${index}`}
                content={textForArtifact}
                isHtml={wholeBodyArtifact.bodyFormat === "html"}
              />
            );
          }

          const displayText =
            isStreaming && isLastRenderablePart && !part.text.endsWith("\n")
              ? part.text + "▊"
              : part.text;

          return (
            <React.Fragment key={`text-${index}`}>
              {renderMarkdown(displayText)}
            </React.Fragment>
          );
        }

        const image = contentPartToImage(part, index);
        if (image) {
          if (
            part.content_type === "image_file_pointer" &&
            textReferencedEratoFileIds.has(part.file_upload_id)
          ) {
            return null;
          }

          return (
            <React.Fragment key={`image-${index}`}>
              <ImageContentDisplay
                images={[image]}
                onImageClick={onImageClick}
              />
              {imageAdvisory && (
                <p className="mt-2 text-xs text-theme-fg-muted">
                  {imageAdvisory}
                </p>
              )}
            </React.Fragment>
          );
        }

        return null;
      })}
    </article>
  );
});
