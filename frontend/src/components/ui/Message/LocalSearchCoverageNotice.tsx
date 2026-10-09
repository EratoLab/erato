import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import clsx from "clsx";
import { useId, useMemo, useState } from "react";

import { numberedLabel } from "@/lib/desktopSidecar/chatTools";
import { summarizeLocalSearchCoverage } from "@/lib/desktopSidecar/searchCoverage";

import { Button } from "../Controls/Button";
import { InfoIcon, WarningIcon } from "../icons";

import type { SearchCoverageSource } from "@/lib/desktopSidecar/searchCoverage";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const formatDay = (iso: string) => i18n.date(iso, { dateStyle: "medium" });
// The model passes date filters as UTC instants, so a requested start is a UTC day.
const formatUtcDay = (iso: string) =>
  i18n.date(iso, { dateStyle: "medium", timeZone: "UTC" });

function sourcePeriod(coverage: SearchCoverageSource): string {
  const source = numberedLabel(coverage);
  if (coverage.from === null) {
    return t({
      id: "chat.message.localSearchCoverage.sourceUnavailable",
      message: `${source}: not searchable yet`,
    });
  }
  const from = formatDay(coverage.from);
  if (coverage.to === null) {
    return t({
      id: "chat.message.localSearchCoverage.sourceSince",
      message: `${source}: since ${from}`,
    });
  }
  const to = formatDay(coverage.to);
  return t({
    id: "chat.message.localSearchCoverage.sourceRange",
    message: `${source}: ${from} – ${to}`,
  });
}

/**
 * Footnote under a reply that searched the desktop sidecar's local index,
 * stating the period that search could see. It reads only the stored tool
 * results, so it renders the same while streaming, after a reload and on
 * shared links.
 */
export function LocalSearchCoverageNotice({
  content,
}: {
  content: readonly ContentPart[];
}) {
  const summary = useMemo(
    () => summarizeLocalSearchCoverage(content),
    [content],
  );
  const [expanded, setExpanded] = useState(false);
  const moreId = useId();
  if (!summary) return null;

  if (summary.status === "unknown") {
    return (
      <div
        role="note"
        data-testid="local-search-coverage-notice"
        className="mt-2 flex items-start gap-2 text-xs text-theme-fg-muted"
      >
        <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {t({
            id: "chat.message.localSearchCoverage.unknown",
            message: "Searched on this device. The searched period is unknown.",
          })}
        </span>
      </div>
    );
  }

  const warning = summary.requestedFrom !== null;
  // The source that triggered the warning leads, so the visible period explains it.
  const sources = [...summary.sources].sort(
    (a, b) =>
      Number(b.requestedFromBeforeCoverage) -
      Number(a.requestedFromBeforeCoverage),
  );
  const first = sources.at(0);
  const more = sources.slice(1);
  const requested =
    summary.requestedFrom && formatUtcDay(summary.requestedFrom);
  const partialCache = (kind: string) =>
    sources.filter(
      (source) => source.partialCache && source.kinds.includes(kind),
    ).length;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Protocol document kind.
  const partialTeams = partialCache("teams_message") > 0;
  const partialMailboxes = partialCache("email");
  const Icon = warning ? WarningIcon : InfoIcon;
  const source = first ? sourcePeriod(first) : "";
  const count = more.length;

  return (
    <div
      role="note"
      data-testid="local-search-coverage-notice"
      data-tone={warning ? "warning" : "info"}
      className={clsx(
        "mt-2 flex items-start gap-2 text-xs",
        warning ? "text-theme-warning-fg" : "text-theme-fg-muted",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {first
              ? t({
                  id: "chat.message.localSearchCoverage.searched",
                  message: `Searched on this device: ${source}`,
                })
              : t({
                  id: "chat.message.localSearchCoverage.noSources",
                  message:
                    "Searched on this device: no indexed source matched this search.",
                })}
          </span>
          {count > 0 && (
            <Button
              type="button"
              variant="link"
              size="sm"
              aria-expanded={expanded}
              aria-controls={moreId}
              onClick={() => setExpanded((value) => !value)}
            >
              {t({
                id: "chat.message.localSearchCoverage.more",
                message: plural(count, {
                  one: "and # more",
                  other: "and # more",
                }),
              })}
            </Button>
          )}
        </div>
        {count > 0 && (
          <ul id={moreId} hidden={!expanded}>
            {more.map((item) => (
              <li key={item.sourceId}>{sourcePeriod(item)}</li>
            ))}
          </ul>
        )}
        {requested && (
          <span>
            {t({
              id: "chat.message.localSearchCoverage.requestedBefore",
              message: `The search asked for items from ${requested}, but the searched period starts later.`,
            })}
          </span>
        )}
        {partialMailboxes > 0 && (
          <span>
            {t({
              id: "chat.message.localSearchCoverage.partialMailboxCache",
              message: plural(partialMailboxes, {
                one: "This mailbox keeps only part of its mail on this device, so older emails may be missing.",
                other:
                  "These mailboxes keep only part of their mail on this device, so older emails may be missing.",
              }),
            })}
          </span>
        )}
        {partialTeams && (
          <span>
            {t({
              id: "chat.message.localSearchCoverage.partialCache",
              message:
                "Teams keeps only part of its history on this device, so older messages may be missing.",
            })}
          </span>
        )}
      </div>
    </div>
  );
}
