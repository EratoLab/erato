import clsx from "clsx";

import { usePageAlignment } from "@/hooks/ui";

import type React from "react";

export interface PageHeaderProps {
  /** Main heading text */
  title: string;
  /** Optional subtitle/description; may hold markup such as a bold name */
  subtitle?: React.ReactNode;
  /** Optional children to render below title/subtitle (e.g., search input) */
  children?: React.ReactNode;
  /**
   * Header density. `window` is for a small app window: a smaller heading, no
   * rule below it and the theme's page alignment left out.
   */
  density?: "default" | "compact" | "window";
  /** Additional CSS classes */
  className?: string;
  /** The heading's id, for the regions it names */
  titleId?: string;
  /** The subtitle's id, for regions it describes */
  subtitleId?: string;
  /** Makes the heading a programmatic focus target; it draws no focus ring */
  titleRef?: React.Ref<HTMLHeadingElement>;
}

/**
 * PageHeader component for consistent page headers
 *
 * Provides a header with title, optional subtitle, and custom content.
 * Alignment is controlled by theme configuration.
 * Used across pages like Search, Assistants, etc. for consistent styling.
 *
 * @example
 * ```tsx
 * <PageHeader
 *   title="My Assistants"
 *   subtitle="Create and manage custom assistants"
 * />
 * ```
 *
 * @example
 * ```tsx
 * <PageHeader title="Search Your Chats">
 *   <SearchInput ... />
 * </PageHeader>
 * ```
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  children,
  density = "default",
  className,
  titleId,
  subtitleId,
  titleRef,
}) => {
  const alignment = usePageAlignment("headers");
  const isWindow = density === "window";
  const isCompact = density === "compact";
  const textAlignment = isWindow ? undefined : alignment.textAlignment;

  return (
    <div
      className={clsx(
        "flex flex-none flex-col bg-theme-bg-primary",
        !isWindow && "border-b border-theme-border",
        isWindow && "px-6 pb-3 pt-5",
        !isWindow && (isCompact ? "py-4" : "py-8"),
        !isWindow && alignment.horizontalPadding,
        className,
      )}
      data-ui="page-header"
    >
      <div className={clsx("w-full", !isWindow && alignment.containerClasses)}>
        <h1
          id={titleId}
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          className={clsx(
            "font-semibold text-theme-fg-primary",
            titleRef && "outline-none",
            isWindow ? "mb-1 text-lg" : "text-2xl",
            !isWindow && (isCompact ? "mb-3" : "mb-6"),
            textAlignment,
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            id={subtitleId}
            className={clsx(
              "text-theme-fg-secondary",
              !isWindow && (isCompact ? "mb-4" : "mb-6"),
              textAlignment,
            )}
          >
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
PageHeader.displayName = "PageHeader";
