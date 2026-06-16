/**
 * CloudNavigationBreadcrumb component
 *
 * Shows current path with clickable segments for navigation
 */

import { t } from "@lingui/core/macro";
import { memo } from "react";

import { Button } from "../Controls/Button";
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
          {t({
            id: "cloudNavigationBreadcrumb.selectDrive",
            message: "Select a drive to browse files",
          })}
        </div>
      );
    }

    return (
      <nav
        className={`flex items-center gap-1 text-sm ${className}`}
        aria-label={t({
          id: "cloudNavigationBreadcrumb.ariaLabel",
          message: "Breadcrumb navigation",
        })}
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
                <Button
                  variant="link"
                  onClick={() => onNavigate(segment.id)}
                  aria-label={t({
                    id: "cloudNavigationBreadcrumb.navigateToParent",
                    message: "Navigate to parent",
                  })}
                >
                  {segment.name}
                </Button>
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
