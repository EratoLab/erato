/**
 * CloudNavigationBreadcrumb component
 *
 * Shows current path with clickable segments for navigation
 */

import { t } from "@lingui/core/macro";
import { memo } from "react";

import { ChevronRightIcon } from "../icons";

import type { BreadcrumbSegment } from "@/lib/api/cloudProviders/types";

interface CloudNavigationBreadcrumbProps {
  breadcrumbs: BreadcrumbSegment[];
  onNavigate: (segmentId: string) => void;
  className?: string;
}

export const CloudNavigationBreadcrumb = memo<CloudNavigationBreadcrumbProps>(
  ({ breadcrumbs, onNavigate, className = "" }) => {
    if (breadcrumbs.length === 0) {
      return (
        <div
          className={`flex items-center text-sm text-theme-fg-muted ${className}`}
        >
          {t`Select a drive to browse files`}
        </div>
      );
    }

    return (
      <nav
        className={`flex items-center gap-1 text-sm ${className}`}
        aria-label={t`Breadcrumb navigation`}
      >
        {breadcrumbs.map((segment, index) => {
          const isLast = index === breadcrumbs.length - 1;

          return (
            <div key={segment.id} className="flex items-center gap-1">
              {index > 0 && (
                <ChevronRightIcon className="size-4 text-theme-fg-muted" />
              )}
              {isLast ? (
                <span
                  className="font-medium text-theme-fg-primary"
                  aria-current="page"
                >
                  {segment.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(segment.id)}
                  className="theme-transition text-theme-fg-muted hover:text-theme-fg-primary hover:underline"
                  aria-label={t`Navigate to parent`}
                >
                  {segment.name}
                </button>
              )}
            </div>
          );
        })}
      </nav>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudNavigationBreadcrumb.displayName = "CloudNavigationBreadcrumb";
