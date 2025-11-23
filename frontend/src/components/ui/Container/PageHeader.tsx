import clsx from "clsx";

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
 * Provides a centered header with title, optional subtitle, and custom content.
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
  return (
    <div
      className={clsx(
        "flex flex-col items-center border-b border-theme-border bg-theme-bg-primary px-4 py-8",
        className,
      )}
    >
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-center text-2xl font-semibold text-theme-fg-primary">
          {title}
        </h1>
        {subtitle && (
          <p className="mb-6 text-center text-theme-fg-secondary">{subtitle}</p>
        )}
        {children}
      </div>
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
PageHeader.displayName = "PageHeader";
