import { t } from "@lingui/core/macro";
import { useId, useLayoutEffect, useRef } from "react";

import { CloseIcon, ResolvedIcon } from "@/components/ui/icons";

import { useLiveAnnouncement } from "./ComposerContext/useLiveAnnouncement";
import { getFacetDisplayName } from "./facetDisplayName";

import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ComposerToolChipsProps {
  /** The selected tools, in the order the server lists them. */
  facets: FacetInfo[];
  onDeselect: (facetId: string) => void;
  /** Nothing can be deselected: the assistant sets the tools, or the composer is busy. */
  locked?: boolean;
  /** Why the chips are locked, when there is a reason to give. */
  lockReason?: string;
  /** Takes focus once the last chip has gone: where a tool is added back. */
  onFocusAfterLast?: () => void;
}

const deselectLabel = (facetDisplayName: string) =>
  t({
    id: "chat.facetSelector.deselectFacet.title",
    message: `Deselect ${facetDisplayName}`,
  });

/**
 * The selected tools as chips next to "+", each one button that deselects
 * it. The live region stays mounted while the host renders the row, even with
 * no tool selected, so the announcement after the last chip is still read.
 */
export const ComposerToolChips = ({
  facets,
  onDeselect,
  locked = false,
  lockReason,
  onFocusAfterLast,
}: ComposerToolChipsProps) => {
  const [announcement, announce] = useLiveAnnouncement();
  const lockId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const focusIndexRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const index = focusIndexRef.current;
    if (index === null) {
      return;
    }
    focusIndexRef.current = null;
    const chips = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-ui="composer-tool-chip"]',
      ) ?? [],
    );
    // The chip that took this one's place, else the one before it.
    const target = Math.min(index, chips.length - 1);
    if (target >= 0) {
      chips[target].focus();
    } else {
      onFocusAfterLast?.();
    }
  }, [facets, onFocusAfterLast]);

  const deselect = (facet: FacetInfo, index: number) => {
    if (locked) {
      return;
    }
    focusIndexRef.current = index;
    onDeselect(facet.id);
    const name = getFacetDisplayName(facet);
    announce(
      t({
        id: "chat.toolChips.announce.deselected",
        message: `${name} deselected.`,
      }),
    );
  };

  const describedBy = locked && lockReason ? lockId : undefined;

  return (
    <>
      {facets.length > 0 ? (
        <div
          ref={groupRef}
          role="group"
          aria-label={t({
            id: "chat.toolChips.label",
            message: "Selected tools",
          })}
          data-ui="composer-tool-chips"
          className="ms-[var(--theme-spacing-control-gap)] inline-flex min-w-0 max-w-full flex-wrap items-center gap-[var(--theme-spacing-control-gap)]"
        >
          {facets.map((facet, index) => {
            const name = getFacetDisplayName(facet);
            const label = deselectLabel(name);
            return (
              <button
                key={facet.id}
                type="button"
                data-ui="composer-tool-chip"
                data-facet-id={facet.id}
                data-testid={`selected-facet-${facet.id}`}
                data-locked={locked ? "true" : undefined}
                aria-label={label}
                aria-disabled={locked || undefined}
                aria-describedby={describedBy}
                title={locked && lockReason ? lockReason : label}
                onClick={() => deselect(facet, index)}
                className="inline-flex h-7 min-w-0 max-w-[min(180px,100%)] items-center gap-[5px] rounded-[var(--theme-radius-control)] border border-transparent bg-theme-bg-secondary pl-2 pr-1.5 text-xs font-medium text-theme-fg-secondary hover:bg-theme-bg-hover hover:text-theme-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-theme-bg-secondary aria-disabled:hover:text-theme-fg-secondary"
              >
                <span aria-hidden="true" className="inline-flex shrink-0">
                  <ResolvedIcon iconId={facet.icon} className="size-[15px]" />
                </span>
                <span data-ui="composer-tool-chip-label" className="truncate">
                  {name}
                </span>
                <span
                  aria-hidden="true"
                  className="inline-flex shrink-0 opacity-70"
                >
                  <CloseIcon className="size-[13px]" />
                </span>
              </button>
            );
          })}
          {describedBy ? (
            <span id={lockId} className="sr-only">
              {lockReason}
            </span>
          ) : null}
        </div>
      ) : null}
      <span
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-ui="composer-tool-live"
      >
        {announcement}
      </span>
    </>
  );
};
