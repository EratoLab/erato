import { t } from "@lingui/core/macro";
import DOMPurify from "dompurify";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { Button } from "@/components/ui/Controls/Button";
import { CheckIcon, CodeIcon, CopyIcon } from "@/components/ui/icons";

import { SyntaxHighlightedCode } from "./SyntaxHighlightedCode";

interface MermaidBlockProps {
  content: string;
  isStreaming: boolean;
}

interface RenderedDiagram {
  svg: string;
  bindFunctions?: (element: Element) => void;
}

const sanitizeMermaidSvg = (svg: string): string =>
  DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // eslint-disable-next-line lingui/no-unlocalized-strings
    FORBID_TAGS: ["script", "foreignObject"],
    FORBID_ATTR: [
      "onerror",
      "onload",
      "onclick",
      "onmouseover",
      "onfocus",
      "href",
      "xlink:href",
    ],
  });

const normalizeMermaidId = (id: string): string =>
  `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

/** Renders a Mermaid fence with a local diagram/code toggle. */
export function MermaidBlock({ content, isStreaming }: MermaidBlockProps) {
  const { effectiveTheme } = useTheme();
  const generatedId = useId();
  const diagramId = normalizeMermaidId(generatedId);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [showCode, setShowCode] = useState(isStreaming);
  const [renderedDiagram, setRenderedDiagram] =
    useState<RenderedDiagram | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setShowCode(isStreaming);
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming || showCode) {
      return;
    }

    let cancelled = false;
    setRenderedDiagram(null);
    setRenderError(false);

    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // Keep labels in the sanitized SVG instead of rendering them as
          // foreignObject HTML nodes, which DOMPurify intentionally removes.
          htmlLabels: false,
          theme: effectiveTheme === "dark" ? "dark" : "default",
          suppressErrorRendering: true,
        });
        return mermaid.render(diagramId, content);
      })
      .then(({ svg, bindFunctions }) => {
        if (cancelled) {
          return;
        }
        setRenderedDiagram({ svg: sanitizeMermaidSvg(svg), bindFunctions });
      })
      .catch(() => {
        if (!cancelled) {
          setRenderError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content, diagramId, effectiveTheme, isStreaming, showCode]);

  useEffect(() => {
    if (renderedDiagram && diagramRef.current) {
      renderedDiagram.bindFunctions?.(diagramRef.current);
    }
  }, [renderedDiagram]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(content)
      .then(() => setCopied(true))
      .catch(() => {});
  }, [content]);

  const codeView = isStreaming || showCode || !renderedDiagram;
  const toggleLabel = codeView
    ? t({
        id: "chat.message.mermaid.showDiagram",
        message: "Show diagram",
      })
    : t({ id: "chat.message.mermaid.showCode", message: "Show code" });

  return (
    <div className="group relative my-4 overflow-hidden rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <Button
          onClick={() => setShowCode((current) => !current)}
          variant="icon-only"
          icon={<CodeIcon />}
          size="sm"
          disabled={isStreaming || !renderedDiagram}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-pressed={codeView}
          className={codeView ? "text-theme-fg-accent" : ""}
        />
        <Button
          onClick={handleCopy}
          variant="icon-only"
          icon={
            copied ? (
              <CheckIcon className="text-theme-success-fg" />
            ) : (
              <CopyIcon />
            )
          }
          size="sm"
          aria-label={
            copied
              ? t({ id: "chat.message.code.copied", message: "Copied" })
              : t({ id: "chat.message.code.copy", message: "Copy code" })
          }
          title={
            copied
              ? t({ id: "chat.message.code.copied", message: "Copied" })
              : t({ id: "chat.message.code.copy", message: "Copy code" })
          }
        />
      </div>

      {codeView ? (
        <div className="overflow-x-auto pt-2">
          <SyntaxHighlightedCode code={content} language="mermaid" />
          {renderError && (
            <p className="px-3 pb-3 text-xs text-theme-fg-muted" role="status">
              {t({
                id: "chat.message.mermaid.renderError",
                message:
                  "This diagram could not be rendered. Showing code instead.",
              })}
            </p>
          )}
        </div>
      ) : (
        <div
          ref={diagramRef}
          className="overflow-x-auto p-4 pt-12 [&_svg]:mx-auto [&_svg]:max-w-full"
          role="img"
          aria-label={t({
            id: "chat.message.mermaid.diagram",
            message: "Mermaid diagram",
          })}
          // Mermaid is configured with strict security and the SVG is sanitized
          // before it reaches the DOM.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderedDiagram.svg }}
        />
      )}
    </div>
  );
}
