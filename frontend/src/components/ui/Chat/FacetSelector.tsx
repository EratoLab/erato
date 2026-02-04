import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";

import { DropdownMenu } from "../Controls/DropdownMenu";
import { ResolvedIcon, ToolsIcon } from "../icons";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface FacetSelectorProps {
  facets: FacetInfo[];
  selectedFacetIds: string[];
  onSelectionChange: (selectedFacetIds: string[]) => void;
  onlySingleFacet: boolean;
  showFacetIndicatorWithDisplayName: boolean;
  disabled?: boolean;
  className?: string;
}

function getFacetDisplayName(facet: FacetInfo): string {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Translation key is dynamic by facet ID
  const translationId = `facets.${facet.id}.display_name`;
  // eslint-disable-next-line lingui/no-single-variables-to-translate
  const translatedName = t({ id: translationId, message: "" });
  if (translatedName && translatedName !== translationId) {
    return translatedName;
  }
  return facet.display_name;
}

export const FacetSelector = ({
  facets,
  selectedFacetIds,
  onSelectionChange,
  onlySingleFacet,
  showFacetIndicatorWithDisplayName,
  disabled = false,
  className = "",
}: FacetSelectorProps) => {
  // Keep this! Meant as placeholder for docs.
  const _facetDisplayNameMarker = t`facets.<facet-id>.displayName`;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const selectedFacetIdsSet = useMemo(
    () => new Set(selectedFacetIds),
    [selectedFacetIds],
  );

  const selectedFacets = useMemo(() => {
    return facets.filter((facet) => selectedFacetIdsSet.has(facet.id));
  }, [facets, selectedFacetIdsSet]);

  const toggleFacetSelection = useCallback(
    (facetId: string) => {
      if (disabled) {
        return;
      }

      if (selectedFacetIdsSet.has(facetId)) {
        onSelectionChange(selectedFacetIds.filter((id) => id !== facetId));
        return;
      }

      if (onlySingleFacet) {
        onSelectionChange([facetId]);
        return;
      }

      const nextSelectedFacetIdsSet = new Set(selectedFacetIds);
      nextSelectedFacetIdsSet.add(facetId);

      // Keep output in backend-provided facet order.
      onSelectionChange(
        facets
          .map((facet) => facet.id)
          .filter((id) => nextSelectedFacetIdsSet.has(id)),
      );
    },
    [
      disabled,
      facets,
      onSelectionChange,
      onlySingleFacet,
      selectedFacetIds,
      selectedFacetIdsSet,
    ],
  );

  const dropdownItems: DropdownMenuItem[] = useMemo(() => {
    return facets.map((facet) => {
      return {
        label: getFacetDisplayName(facet),
        icon: <ResolvedIcon iconId={facet.icon} className="size-4" />,
        onClick: () => toggleFacetSelection(facet.id),
        checked: selectedFacetIdsSet.has(facet.id),
      };
    });
  }, [facets, selectedFacetIdsSet, toggleFacetSelection]);

  if (facets.length === 0) {
    return null;
  }

  return (
    <div
      className={clsx(
        "flex items-center gap-1",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <div className={clsx(disabled && "pointer-events-none")}>
        <DropdownMenu
          items={dropdownItems}
          align="right"
          onOpenChange={setIsDropdownOpen}
          matchContentWidth
          noWrapItems
          triggerIcon={
            <div className="flex items-center gap-1 px-2">
              <ToolsIcon className="size-4" />
              <span className="text-sm font-medium">{t`Tools`}</span>
              <svg
                className={clsx(
                  "size-3 shrink-0 text-[var(--theme-fg-secondary)] transition-transform duration-200",
                  isDropdownOpen && "rotate-180",
                )}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          }
          id="facet-selector-dropdown"
        />
      </div>

      <div className="flex items-center gap-1">
        {selectedFacets.map((facet) => {
          const facetDisplayName = getFacetDisplayName(facet);

          return (
            <Button
              key={facet.id}
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => toggleFacetSelection(facet.id)}
              icon={<ResolvedIcon iconId={facet.icon} className="size-4" />}
              data-testid={`selected-facet-${facet.id}`}
              aria-label={t({
                id: "chat.facetSelector.deselectFacet.title",
                message: `Deselect ${facetDisplayName}`,
              })}
              title={t({
                id: "chat.facetSelector.deselectFacet.title",
                message: `Deselect ${facetDisplayName}`,
              })}
              className={clsx(
                "max-w-[180px] border border-theme-border px-2",
                showFacetIndicatorWithDisplayName && "gap-1",
              )}
            >
              {showFacetIndicatorWithDisplayName && (
                <span className="truncate text-xs font-medium">
                  {facetDisplayName}
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
};
