import { useTheme } from "@/components/providers/ThemeProvider";

import type { PageAlignment, PageMaxWidth } from "@/utils/themeUtils";

/**
 * Page type options for alignment configuration
 */
export type PageType = "assistants" | "search" | "headers";

/**
 * Return type for usePageAlignment hook
 */
export interface PageAlignmentResult {
  /** Current alignment setting */
  alignment: PageAlignment;
  /** Current max-width setting */
  maxWidth: PageMaxWidth;
  /** Max-width class only (max-w-4xl, max-w-2xl, etc.) */
  maxWidthClass: string;
  /** Container classes: max-width + always centered with mx-auto */
  containerClasses: string;
  /** Text alignment class (text-left, text-center, text-right) */
  textAlignment: string;
  /** Flex alignment class for cross-axis (items-start, items-center, items-end) */
  flexAlignment: string;
  /** Flex justify class for main-axis (justify-start, justify-center, justify-end) */
  justifyAlignment: string;
  /** Horizontal padding class - consistent px-6 */
  horizontalPadding: string;
}

/**
 * Hook to get page alignment configuration from theme
 *
 * Provides alignment settings and utility classes for positioning
 * page content based on theme configuration.
 *
 * The container is always centered (mx-auto) - alignment settings only affect
 * content alignment WITHIN the container, not the container's position.
 *
 * @param pageType - The type of page ('assistants', 'search', or 'headers')
 * @returns Alignment configuration and utility classes
 *
 * @example
 * ```tsx
 * const { containerClasses, textAlignment } = usePageAlignment('assistants');
 * return (
 *   <div className={containerClasses}>
 *     <h1 className={textAlignment}>Title</h1>
 *   </div>
 * );
 * ```
 */
export function usePageAlignment(pageType: PageType): PageAlignmentResult {
  const { customThemeConfig } = useTheme();

  // Get configuration for this page type
  const config = customThemeConfig?.layout?.pages?.[pageType];

  // Default alignment and maxWidth based on page type
  const alignment = config?.alignment ?? "center";
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const maxWidth = config?.maxWidth ?? (pageType === "headers" ? "2xl" : "4xl");

  // Generate max-width class only
  const getMaxWidthClass = (): string => {
    return `max-w-${maxWidth}`;
  };

  // Generate container classes: max-width + always centered
  // The container is always centered - alignment only affects content within
  const getContainerClasses = (): string => {
    return `max-w-${maxWidth} mx-auto`;
  };

  // Generate text alignment class for headers and text content
  const getTextAlignment = (): string => {
    return alignment === "center"
      ? "text-center"
      : alignment === "right"
        ? "text-right"
        : "text-left";
  };

  // Generate flex alignment class for flex containers (cross-axis)
  const getFlexAlignment = (): string => {
    return alignment === "center"
      ? "items-center"
      : alignment === "right"
        ? "items-end"
        : "items-start";
  };

  // Generate flex justify class for main-axis
  const getJustifyAlignment = (): string => {
    return alignment === "center"
      ? "justify-center"
      : alignment === "right"
        ? "justify-end"
        : "justify-start";
  };

  // Consistent horizontal padding
  const getHorizontalPadding = (): string => {
    return "px-6";
  };

  return {
    alignment,
    maxWidth,
    maxWidthClass: getMaxWidthClass(),
    containerClasses: getContainerClasses(),
    textAlignment: getTextAlignment(),
    flexAlignment: getFlexAlignment(),
    justifyAlignment: getJustifyAlignment(),
    horizontalPadding: getHorizontalPadding(),
  };
}
