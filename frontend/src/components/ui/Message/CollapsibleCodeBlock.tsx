import { t } from "@lingui/core/macro";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "../Controls/Button";
import { CollapseVerticalIcon, ExpandVerticalIcon } from "../icons";

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
  /**
   * Box styling — background, border, radius — hoisted off the code so this
   * element paints it. See `useCodeBlockSurfaceStyle`.
   */
  surfaceStyle?: React.CSSProperties;
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
 * The clip and the block's surface are the same element, so the corners stay
 * rounded whether or not the content is cut. That also puts the toggle inside
 * the box rather than under it, where a footer would have squared off the
 * bottom two corners.
 */
export const CollapsibleCodeBlock: React.FC<CollapsibleCodeBlockProps> = ({
  lineCount,
  disabled = false,
  surfaceStyle,
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
    <div className="relative">
      <div
        ref={clipperRef}
        className="overflow-hidden"
        style={{
          ...surfaceStyle,
          ...(clamped
            ? {
                maxHeight:
                  "var(--theme-layout-code-block-collapsed-max-height)",
              }
            : null),
        }}
      >
        {children}
      </div>
      {overflows && (
        <Button
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          icon={
            expanded ? (
              <CollapseVerticalIcon className="size-4" />
            ) : (
              <ExpandVerticalIcon className="size-4" />
            )
          }
          className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 shadow-sm"
        >
          {expanded ? t`Show less` : t`Show all ${lineCount} lines`}
        </Button>
      )}
    </div>
  );
};
