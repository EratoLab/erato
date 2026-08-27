import { t } from "@lingui/core/macro";
import { useLayoutEffect, useRef, useState } from "react";

import { DisclosureChevron } from "../Controls/DisclosureChevron";

import type React from "react";

export interface CollapsibleCodeBlockProps {
  /** Total lines in the block, used to say how much is hidden. */
  lineCount: number;
  /**
   * Suppresses clamping. Set while the block is still streaming: the height
   * changes on every chunk, so a cap would fight the content instead of
   * settling it.
   */
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Caps a long code block and offers to reveal the rest.
 *
 * The opposite default to an image, which is too small and grows: code arrives
 * too tall and shrinks. Deliberately not `Collapse` — that toggles fully
 * hidden against fully shown, whereas this clamps to a readable height and
 * keeps the first lines visible.
 *
 * There is no gradient fade: the block's background comes from the Prism
 * theme, so a fade would have to guess at a colour it does not own. The footer
 * states the hidden line count instead, which also says how much is missing
 * rather than merely that something is.
 */
export const CollapsibleCodeBlock: React.FC<CollapsibleCodeBlockProps> = ({
  lineCount,
  disabled = false,
  children,
}) => {
  const clipperRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const clipper = clipperRef.current;
    if (!clipper || disabled) {
      setOverflows(false);
      return;
    }

    // Only meaningful while clamped — once expanded the element is exactly as
    // tall as its content, so the last collapsed measurement stands.
    if (expanded) {
      return;
    }

    const measure = () => {
      setOverflows(clipper.scrollHeight > clipper.clientHeight + 1);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(clipper);
    return () => observer.disconnect();
  }, [disabled, expanded, children]);

  // The cap applies whenever collapsed, not only once overflow is known —
  // otherwise the measurement is circular, since an uncapped element can never
  // report that it exceeds the cap. A block shorter than the cap is unaffected;
  // it simply never reports overflow and never grows a toggle.
  const clamped = !expanded && !disabled;

  return (
    <>
      <div
        ref={clipperRef}
        className={clamped ? "overflow-hidden" : undefined}
        style={
          clamped
            ? {
                maxHeight:
                  "var(--theme-layout-code-block-collapsed-max-height)",
              }
            : undefined
        }
      >
        {children}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1 border-t border-theme-border py-1.5 text-xs text-theme-fg-muted hover:text-theme-fg-primary"
        >
          <DisclosureChevron open={expanded} />
          {expanded ? t`Show less` : t`Show all ${lineCount} lines`}
        </button>
      )}
    </>
  );
};
