import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";

import { DropdownMenu } from "../Controls/DropdownMenu";
import { AtSignIcon, ChevronDownIcon, ResolvedIcon, ToolsIcon } from "../icons";

import type { AddMenuSection } from "./ChatInputAddMenu";
import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface FacetSelectorProps {
  facets: FacetInfo[];
  selectedFacetIds: string[];
  onSelectionChange: (selectedFacetIds: string[]) => void;
  onlySingleFacet: boolean;
  showFacetIndicatorWithDisplayName: boolean;
  /**
   * Extra group appended below the tools — the same section the mobile "+"
   * menu renders, so both hosts offer identical assistant rows.
   */
  assistantSection?: AddMenuSection;
  /** Disable the whole control (composer lock). */
  disabled?: boolean;
  /**
   * Extra gate for the facet rows alone (enforced facet settings). The
   * assistants group stays live: a chat whose tools are locked may still
   * delegate.
   */
  toolsDisabled?: boolean;
  className?: string;
}

export function getFacetDisplayName(facet: FacetInfo): string {
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
  assistantSection,
  disabled = false,
  toolsDisabled = false,
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
      if (disabled || toolsDisabled) {
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
      toolsDisabled,
      facets,
      onSelectionChange,
      onlySingleFacet,
      selectedFacetIds,
      selectedFacetIdsSet,
    ],
  );

  const dropdownItems: DropdownMenuItem[] = useMemo(() => {
    const facetItems = facets.map((facet) => {
      return {
        id: facet.id,
        label: getFacetDisplayName(facet),
        icon: <ResolvedIcon iconId={facet.icon} className="size-4" />,
        onClick: () => toggleFacetSelection(facet.id),
        checked: selectedFacetIdsSet.has(facet.id),
        disabled: toolsDisabled,
      };
    });

    if (!assistantSection) {
      return facetItems;
    }

    // The group label is only worth a row when there is something above it to
    // separate the assistants from.
    return [
      ...facetItems,
      ...assistantSection.items.map((item, index) => ({
        id: item.id,
        label: item.label,
        onClick: item.onSelect,
        disabled: item.disabled,
        closesImmediately: item.closesImmediately,
        sectionHeader:
          index === 0 && facetItems.length > 0
            ? assistantSection.header
            : undefined,
      })),
    ];
  }, [
    assistantSection,
    facets,
    selectedFacetIdsSet,
    toggleFacetSelection,
    toolsDisabled,
  ]);

  if (facets.length === 0 && !assistantSection) {
    return null;
  }

  // Without facets the control carries assistants alone, so the trigger has to
  // say so — the delegation surface must stay reachable on a facet-less deployment.
  const isAssistantsOnly = facets.length === 0;
  // Locked tools leave the menu worth opening only for the assistants; with no
  // assistants group every row is dead, so the trigger goes inert instead.
  const isMenuInert = disabled || (toolsDisabled && !assistantSection);

  return (
    <div
      className={clsx(
        "flex items-center gap-1",
        isMenuInert && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <div className={clsx(isMenuInert && "pointer-events-none")}>
        <DropdownMenu
          items={dropdownItems}
          align="right"
          onOpenChange={setIsDropdownOpen}
          matchContentWidth
          noWrapItems
          triggerIcon={
            <div className="flex items-center gap-1 px-2">
              {isAssistantsOnly ? (
                <AtSignIcon className="size-4" />
              ) : (
                <ToolsIcon className="size-4" />
              )}
              <span className="text-sm font-medium">
                {isAssistantsOnly
                  ? t({
                      id: "chatInput.mentions.sectionHeader",
                      message: "Assistants",
                    })
                  : t`Tools`}
              </span>
              <ChevronDownIcon
                className={clsx(
                  "size-3 shrink-0 text-[var(--theme-fg-secondary)] transition-transform duration-200",
                  isDropdownOpen && "rotate-180",
                )}
              />
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
              disabled={disabled || toolsDisabled}
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
                "max-w-[180px] border border-transparent bg-theme-bg-secondary px-2 hover:bg-theme-bg-hover",
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
