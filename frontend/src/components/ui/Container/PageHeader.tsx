import clsx from "clsx";

import { usePageAlignment } from "@/hooks/ui";

import type React from "react";

export interface PageHeaderProps {
  /** Main heading text */
  title: string;
  /** Optional subtitle/description text */
  subtitle?: string;
  /** Optional children to render below title/subtitle (e.g., search input) */
  children?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
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
  className,
}) => {
  const { containerClasses, textAlignment, horizontalPadding } =
    usePageAlignment("headers");

  return (
    <div
      className={clsx(
        "flex flex-col border-b border-theme-border bg-theme-bg-primary py-8",
        horizontalPadding,
        className,
      )}
    >
      <div className={clsx("w-full", containerClasses)}>
        <h1
          className={clsx(
            "mb-6 text-2xl font-semibold text-theme-fg-primary",
            textAlignment,
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p className={clsx("mb-6 text-theme-fg-secondary", textAlignment)}>
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
