import clsx from "clsx";
import { useId, useRef } from "react";

import type { KeyboardEvent, ReactNode } from "react";

/**
 * Anatomy. `rail` is a bare strip of tabs — the settings dialogs' tab rails
 * and the markdown/preview switch. `segmented` is the bordered inset track of
 * `SegmentedControl`: its tabs sit inside a padded frame and take a corner
 * derived from the frame's, so the two stay concentric at any theme radius.
 */
export type TabRailVariant = "rail" | "segmented";

/**
 * Announced on the rail as `aria-orientation`. The layout direction is the
 * caller's, through `className`: the preferences rail announces `vertical`
 * but lays itself out horizontally below `md`, so TabRail never writes a
 * `flex-col` of its own.
 */
export type TabRailOrientation = "horizontal" | "vertical";

/**
 * Which arrow pairs walk the strip. Defaults to the orientation. A rail that
 * announces one orientation but lays itself out along the other axis at some
 * width passes `both`, so the keys match what the user sees at every width.
 */
export type TabRailArrowKeys = "horizontal" | "vertical" | "both";

export interface TabRailAttention {
  /** Read out after the label; the dot carries no meaning on its own. */
  label: string;
  /** Text colour class the dot picks up through `bg-current`. */
  toneClassName?: string;
  /** Whether the dot pulses, for a state that is still moving. */
  pulse?: boolean;
}

export interface TabRailOption<T extends string> {
  /** The value for this option */
  value: T;
  /** The display label */
  label: string;
  /** Optional icon to show before the label; hidden from assistive tech. */
  icon?: ReactNode;
  /**
   * Status dot after the label. Kept apart from `icon`, which is aria-hidden
   * and therefore cannot carry a state a user needs to know about.
   */
  attention?: TabRailAttention;
  /** Whether this option is disabled */
  disabled?: boolean;
  /**
   * `aria-controls` target. Omitted, the tab claims no panel. MAY repeat
   * across options: the markdown/preview strip points both tabs at one panel.
   */
  panelId?: string;
  /**
   * Caller-supplied tab id, because every tabpanel labels itself with
   * `aria-labelledby={tabId}`. Defaults to `${useId()}-tab-${index}`.
   */
  id?: string;
}

export interface TabRailProps<T extends string> {
  options: TabRailOption<T>[];
  /** Never normalised: a value matching no option selects nothing. */
  value: T;
  onChange: (value: T) => void;
  /** Default `rail`. */
  variant?: TabRailVariant;
  /** Default `horizontal`; emitted as `aria-orientation` and `data-orientation`. */
  orientation?: TabRailOrientation;
  /** Default: the orientation. */
  arrowKeys?: TabRailArrowKeys;
  /** Disables the whole strip. */
  disabled?: boolean;
  /**
   * Extra classes on the rail element. The caller owns flex-direction and
   * overflow (`md:flex-col`, `overflow-x-auto`, `flex-wrap`).
   */
  className?: string;
  /**
   * Extra classes on every tab — size padding, `md:w-full`, `font-medium`.
   * Utilities here are emitted after `@layer components`, so a padding
   * utility wins over the geometry class's token padding.
   */
  tabClassName?: string;
  "aria-label"?: string;
  /** Theme hook. Overrides the family default `tab-rail`. */
  "data-ui"?: string;
}

// Per-variant tab classes, kept so every surface that moved onto TabRail
// stays pixel-identical. The corner and the token padding come from
// `.tab-item-geometry`; nothing here may carry a `rounded-*` utility.
const RAIL_TAB_CLASS =
  "theme-transition flex shrink-0 items-center gap-2 whitespace-nowrap text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus";
const RAIL_TAB_SELECTED_CLASS =
  "bg-theme-bg-selected font-medium text-theme-fg-primary";
const RAIL_TAB_UNSELECTED_CLASS =
  "text-theme-fg-secondary hover:bg-theme-bg-hover";

const SEGMENTED_TAB_CLASS =
  "theme-transition flex items-center gap-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus";
const SEGMENTED_TAB_SELECTED_CLASS =
  "bg-theme-bg-selected text-theme-fg-primary shadow-sm";
const SEGMENTED_TAB_UNSELECTED_CLASS =
  "text-theme-fg-secondary hover:text-theme-fg-primary";

/**
 * Walk `delta` steps at a time from `from`, wrapping at both ends, until an
 * option that can actually be selected turns up. Disabled tabs are stepped
 * over rather than landed on, so an arrow key never parks focus on something
 * that cannot be activated. Returns -1 when no option is selectable.
 *
 * `from` is allowed to sit outside the array so a single walk serves all four
 * keys: Home enters at -1 going forward, End at `length` going backward.
 */
function nextEnabledIndex<T extends string>(
  options: TabRailOption<T>[],
  from: number,
  delta: number,
): number {
  const { length } = options;

  for (let step = 1; step <= length; step++) {
    const index = (((from + delta * step) % length) + length) % length;
    if (!options[index].disabled) {
      return index;
    }
  }

  return -1;
}

/**
 * One controlled tab strip for every tab-shaped surface: the settings rails,
 * the markdown/preview switch and the segmented controls. It owns the ARIA
 * tablist contract, the roving tab stop, automatic activation and the
 * geometry classes a theme retunes through; the caller owns the value, the
 * panels and the layout direction.
 *
 * Tabs are raw `<button role="tab">`, never `Button`: both customer themes'
 * blanket `button[data-geometry=…]` pill rules would sweep every tab in.
 */
export function TabRail<T extends string>({
  options,
  value,
  onChange,
  variant = "rail",
  orientation = "horizontal",
  arrowKeys = orientation,
  disabled = false,
  className,
  tabClassName,
  "aria-label": ariaLabel,
  "data-ui": dataUi,
}: TabRailProps<T>) {
  const groupId = useId();
  // Keyed by option value, not index: both settings dialogs add and remove
  // tabs behind feature flags, and an index-keyed array would point a key
  // press at whichever tab now sits where the removed one did.
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());

  const segmented = variant === "segmented";
  const horizontalKeys = arrowKeys !== "vertical";
  const verticalKeys = arrowKeys !== "horizontal";

  // The roving stop sits on the selected tab. When the value matches no
  // option — a flag just hid the selected tab — the first enabled tab takes
  // it, so the strip stays reachable from the keyboard. The value itself is
  // left alone: the caller owns it.
  const selectedIndex = options.findIndex((option) => option.value === value);
  const stopIndex =
    selectedIndex >= 0
      ? selectedIndex
      : options.findIndex((option) => !option.disabled);

  const focusTab = (option: TabRailOption<T>) => {
    const element = tabRefs.current.get(option.value);
    if (!element) {
      return;
    }

    if (!segmented) {
      // The settings rails scroll (`overflow-x-auto`), and a tab can sit off
      // screen on a narrow dialog; the nearest-edge scroll keeps the moved-to
      // tab in view without yanking the page. The guard stays although the
      // host's test setup stubs scrollIntoView: the add-in suite has its own.
      element.focus({ preventScroll: true });
      if (typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      return;
    }

    element.focus();
  };

  /**
   * Automatic activation: selection and focus move together, which is the
   * promise the roving `tabIndex` already makes. Without this the selected
   * tab is the only tab stop in the group and a keyboard user cannot reach
   * the others at all. Keys the strip does not handle return before
   * `preventDefault`, so the browser keeps them.
   */
  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number;

    switch (event.key) {
      case "ArrowRight":
        if (!horizontalKeys) {
          return;
        }
        nextIndex = nextEnabledIndex(options, index, 1);
        break;
      case "ArrowLeft":
        if (!horizontalKeys) {
          return;
        }
        nextIndex = nextEnabledIndex(options, index, -1);
        break;
      case "ArrowDown":
        if (!verticalKeys) {
          return;
        }
        nextIndex = nextEnabledIndex(options, index, 1);
        break;
      case "ArrowUp":
        if (!verticalKeys) {
          return;
        }
        nextIndex = nextEnabledIndex(options, index, -1);
        break;
      case "Home":
        nextIndex = nextEnabledIndex(options, -1, 1);
        break;
      case "End":
        nextIndex = nextEnabledIndex(options, options.length, -1);
        break;
      default:
        return;
    }

    event.preventDefault();

    if (nextIndex < 0) {
      return;
    }

    const next = options[nextIndex];
    onChange(next.value);
    focusTab(next);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      data-ui={dataUi ?? "tab-rail"}
      data-variant={variant}
      data-orientation={orientation}
      className={clsx(
        "tab-rail-geometry",
        // The segmented track keeps its paint as utilities; its border width,
        // inset and corner come from the track geometry class, which must
        // follow `.tab-rail-geometry` in the stylesheet.
        segmented
          ? "tab-rail-track-geometry inline-flex border-theme-border bg-theme-bg-secondary"
          : "flex",
        // Whole-strip disabled dims the track on the segmented variant and
        // each tab on the rail variant — both are the placements the surfaces
        // had before they moved here, and the two composites differ.
        segmented && disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {options.map((option, index) => {
        const isSelected = value === option.value;
        const isDisabled = disabled || option.disabled;

        return (
          <button
            key={option.value}
            id={option.id ?? `${groupId}-tab-${index}`}
            ref={(element) => {
              if (element) {
                tabRefs.current.set(option.value, element);
              } else {
                tabRefs.current.delete(option.value);
              }
            }}
            type="button"
            role="tab"
            aria-selected={isSelected ? "true" : "false"}
            aria-controls={option.panelId}
            tabIndex={index === stopIndex ? 0 : -1}
            disabled={isDisabled}
            data-ui="tab-rail-tab"
            onClick={() => {
              if (!isDisabled) {
                onChange(option.value);
              }
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={clsx(
              "tab-item-geometry",
              segmented
                ? [
                    SEGMENTED_TAB_CLASS,
                    isSelected
                      ? SEGMENTED_TAB_SELECTED_CLASS
                      : SEGMENTED_TAB_UNSELECTED_CLASS,
                    isDisabled && "cursor-not-allowed",
                  ]
                : [
                    RAIL_TAB_CLASS,
                    isSelected
                      ? RAIL_TAB_SELECTED_CLASS
                      : RAIL_TAB_UNSELECTED_CLASS,
                    // Never on a disabled tab: the stylesheet emits
                    // `cursor-pointer` after `cursor-not-allowed`, so it wins.
                    isDisabled
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer",
                  ],
              tabClassName,
            )}
          >
            {option.icon &&
              (segmented ? (
                <span className="size-4 shrink-0" aria-hidden="true">
                  {option.icon}
                </span>
              ) : (
                <span aria-hidden="true" className="shrink-0">
                  {option.icon}
                </span>
              ))}
            {option.label}
            {option.attention && (
              <span
                className={clsx(
                  "flex shrink-0 items-center",
                  option.attention.toneClassName,
                )}
                data-ui="segmented-control-attention"
                data-testid="segmented-control-attention"
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    "size-2 rounded-full bg-current",
                    option.attention.pulse &&
                      "animate-pulse motion-reduce:animate-none",
                  )}
                />
                <span className="sr-only">{option.attention.label}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
