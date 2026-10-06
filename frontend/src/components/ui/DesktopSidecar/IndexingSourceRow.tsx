import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { Button } from "../Controls/Button";
import { DisclosureChevron } from "../Controls/DisclosureChevron";
import { Tooltip } from "../Controls/Tooltip";
import { SettledInfoPill } from "../Trace/steps/ToolStatusPill";
import { ArrowUpIcon, ChatBubbleIcon, ComputerIcon, MailIcon } from "../icons";

import type { mailboxIndexingSummary } from "@/lib/desktopSidecar/indexingConfiguration";
import type { IndexingEntry } from "@/lib/desktopSidecar/indexingSources";

export function IndexingSourceRow({
  entry,
  summary,
  now,
  busy,
  canMoveUp,
  canMoveDown,
  onMove,
  onToggle,
}: {
  entry: IndexingEntry;
  summary: ReturnType<typeof mailboxIndexingSummary>;
  now: number;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: number) => void;
  onToggle: (enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const entryName = (entry: IndexingEntry) => {
    const name =
      entry.name ??
      (entry.product === "teams"
        ? t({
            id: "sidecar.indexing.teamsCache",
            message: "Microsoft Teams local cache",
          })
        : t({
            id: "sidecar.indexing.localSource",
            message: "Local data source",
          }));
    return entry.number === undefined
      ? name
      : i18n._({
          id: "sidecar.indexing.numberedSource",
          message: "{name} ({number})",
          values: { name, number: i18n.number(entry.number) },
        });
  };
  const name = entryName(entry);
  const missingCount = summary.missingFromLocalCache ?? 0;
  const seconds =
    summary.lastScan === null
      ? null
      : Math.max(0, Math.floor((now - summary.lastScan) / 1000));
  const relative =
    seconds === null
      ? null
      : new Intl.RelativeTimeFormat(i18n.locale, {
          style: "short",
        }).format(
          -(seconds < 60
            ? seconds
            : seconds < 3600
              ? Math.floor(seconds / 60)
              : Math.floor(seconds / 3600)),
          seconds < 60 ? "second" : seconds < 3600 ? "minute" : "hour",
        );
  const labels = {
    disabled: t({
      id: "sidecar.indexing.status.disabled",
      message: "Disabled",
    }),
    scanFailed: t({
      id: "sidecar.indexing.status.scanFailed",
      message: "Scan failed",
    }),
    sourceUnavailable: t({
      id: "sidecar.indexing.status.sourceUnavailable",
      message: "Source unavailable",
    }),
    indexingUnavailable: t({
      id: "sidecar.indexing.status.indexingUnavailable",
      message: "Indexing unavailable",
    }),
    partial: t({
      id: "sidecar.indexing.status.partial",
      message: "Partially indexed",
    }),
    complete: t({
      id: "sidecar.indexing.status.complete",
      message: "Indexing complete",
    }),
    stopped: t({ id: "sidecar.indexing.status.stopped", message: "Stopped" }),
    scanning: t({
      id: "sidecar.indexing.status.scanning",
      message: "Scanning",
    }),
    indexing: t({
      id: "sidecar.indexing.status.indexing",
      message: "Indexing",
    }),
    waiting: t({ id: "sidecar.indexing.status.waiting", message: "Waiting" }),
    current: t({
      id: "sidecar.indexing.status.current",
      message: "Up-to-date",
    }),
    unavailable: t({
      id: "sidecar.indexing.status.unavailable",
      message: "Status unavailable",
    }),
  };
  /* eslint-disable lingui/no-unlocalized-strings -- Internal indexing status keys. */
  const warning = [
    "scanFailed",
    "sourceUnavailable",
    "indexingUnavailable",
    "partial",
  ].includes(summary.state);
  /* eslint-enable lingui/no-unlocalized-strings */
  const productLabel =
    entry.product === "teams"
      ? t({ id: "sidecar.indexing.source.teams", message: "Teams" })
      : entry.product === "outlook"
        ? t({ id: "sidecar.indexing.source.outlook", message: "Outlook" })
        : t({
            id: "sidecar.indexing.localSource",
            message: "Local data source",
          });
  return (
    <li className="space-y-3 py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={i18n._({
            id: "sidecar.indexing.sourceDetails",
            message: "Details for {source}",
            values: { source: name },
          })}
          onClick={() => setExpanded((value) => !value)}
          className="theme-transition focus-ring-tight flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left"
        >
          <DisclosureChevron open={expanded} size="md" className="mt-0.5" />
          <span className="min-w-0 flex-1 space-y-1">
            <span
              dir="auto"
              className="block break-words text-sm font-medium text-theme-fg-primary [overflow-wrap:anywhere] [unicode-bidi:isolate]"
            >
              {name}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-theme-fg-secondary">
              <span className="inline-flex items-center gap-1">
                {entry.product === "teams" ? (
                  <ChatBubbleIcon className="size-3" />
                ) : entry.product === "outlook" ? (
                  <MailIcon className="size-3" />
                ) : (
                  <ComputerIcon className="size-3" />
                )}
                {productLabel}
              </span>
              {entry.account?.email && (
                <span
                  dir="auto"
                  className="min-w-0 break-words [overflow-wrap:anywhere] [unicode-bidi:isolate]"
                >
                  {entry.account.email}
                </span>
              )}
              {entry.account?.guest && (
                <SettledInfoPill
                  label={t({
                    id: "sidecar.indexing.teamsGuest",
                    message: "Guest",
                  })}
                  toneClassName="bg-theme-bg-tertiary text-theme-fg-secondary"
                />
              )}
              <SettledInfoPill
                label={labels[summary.state]}
                toneClassName={
                  warning
                    ? "bg-theme-warning-bg text-theme-warning-fg"
                    : "bg-theme-bg-tertiary text-theme-fg-secondary"
                }
              />
            </span>
          </span>
        </button>
        <input
          type="checkbox"
          checked={entry.enabled}
          disabled={busy || !entry.editable}
          className="mt-1 size-4 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={i18n._({
            id: "sidecar.indexing.enable",
            message: "Enable indexing for {mailbox}",
            values: { mailbox: name },
          })}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </div>
      {expanded && (
        <div
          id={detailsId}
          className="space-y-2 pl-6 text-xs text-theme-fg-secondary"
        >
          <p>
            {summary.total === null ||
            summary.indexed === null ||
            (summary.total > 0 && summary.percentage === null)
              ? t({
                  id: "sidecar.indexing.progressUnavailable",
                  message: "Indexing progress unavailable",
                })
              : summary.total === 0
                ? t({
                    id: "sidecar.indexing.noDocuments",
                    message: "No documents discovered yet",
                  })
                : i18n._({
                    id: "sidecar.indexing.progress",
                    message:
                      "{indexed} of {total} documents indexed ({percentage}%)",
                    values: {
                      indexed: i18n.number(summary.indexed),
                      percentage: i18n.number(summary.percentage ?? 0),
                      total: i18n.number(summary.total),
                    },
                  })}
          </p>
          {missingCount > 0 && (
            <p>
              {t({
                id: "sidecar.indexing.missingFromLocalCache",
                message: plural(missingCount, {
                  one: "# document is unavailable in the local cache.",
                  other: "# documents are unavailable in the local cache.",
                }),
              })}
            </p>
          )}
          <p>
            {relative === null
              ? t({
                  id: "sidecar.indexing.noScan",
                  message: "No successful scan yet",
                })
              : i18n._({
                  id: "sidecar.indexing.lastScan",
                  message: "Last successful scan {time}",
                  values: { time: relative },
                })}
          </p>
          {!entry.editable && (
            <p>
              {t({
                id: "sidecar.indexing.sourceUpgrade",
                message:
                  "Update the desktop sidecar to change indexing for this source.",
              })}
            </p>
          )}
          {summary.terminal && (
            <p
              className={
                summary.hasUnindexable
                  ? "text-theme-warning-fg"
                  : "text-theme-fg-secondary"
              }
            >
              {summary.hasUnindexable
                ? t({
                    id: "sidecar.indexing.terminal",
                    message:
                      "Some documents are empty or could not be indexed, so coverage is below 100%.",
                  })
                : t({
                    id: "sidecar.indexing.emptyDocuments",
                    message:
                      "Empty documents contain no searchable text, so coverage is below 100%.",
                  })}
            </p>
          )}
          {entry.editable && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span>
                {t({
                  id: "sidecar.indexing.priority",
                  message: "Indexing priority",
                })}
              </span>
              <Tooltip
                content={t({
                  id: "sidecar.indexing.increasePriority",
                  message: "Increase priority",
                })}
              >
                <Button
                  variant="icon-only"
                  disabled={busy || !canMoveUp}
                  onClick={() => onMove(-1)}
                  aria-label={i18n._({
                    id: "sidecar.indexing.moveUp",
                    message: "Increase priority for {mailbox}",
                    values: { mailbox: name },
                  })}
                  icon={<ArrowUpIcon className="size-4" />}
                />
              </Tooltip>
              <Tooltip
                content={t({
                  id: "sidecar.indexing.decreasePriority",
                  message: "Decrease priority",
                })}
              >
                <Button
                  variant="icon-only"
                  disabled={busy || !canMoveDown}
                  onClick={() => onMove(1)}
                  aria-label={i18n._({
                    id: "sidecar.indexing.moveDown",
                    message: "Decrease priority for {mailbox}",
                    values: { mailbox: name },
                  })}
                  icon={<ArrowUpIcon className="size-4 rotate-180" />}
                />
              </Tooltip>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
