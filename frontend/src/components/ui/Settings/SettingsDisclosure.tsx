import { useId, useState } from "react";

import { CountBadge } from "../Controls/CountBadge";
import { DisclosureChevron } from "../Controls/DisclosureChevron";

import type { ReactNode } from "react";

/** A settings subsection using the same disclosure idiom as the tool roster.
 * Controls live in the body, outside the disclosure button. Closed bodies leave
 * the accessibility tree; callers own drafts that must survive collapsing.
 */
export function SettingsDisclosure({
  title,
  description,
  count,
  defaultExpanded = false,
  headingLevel = 4,
  children,
}: {
  title: string;
  description?: string;
  count?: number;
  defaultExpanded?: boolean;
  headingLevel?: 3 | 4;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headingId = useId();
  const bodyId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="space-y-1">
        <Heading id={headingId}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((value) => !value)}
            className="theme-transition focus-ring-tight flex min-w-0 items-center gap-2 rounded-sm text-left text-sm font-medium text-theme-fg-primary"
          >
            <DisclosureChevron open={expanded} size="md" />
            <span>{title}</span>
            {count !== undefined && (
              <CountBadge variant="count" aria-hidden={false}>
                {count}
              </CountBadge>
            )}
          </button>
        </Heading>
        {description && (
          <p className="pl-6 text-xs text-theme-fg-secondary">{description}</p>
        )}
      </div>
      {expanded && (
        <div id={bodyId} className="space-y-3 pl-6">
          {children}
        </div>
      )}
    </section>
  );
}
