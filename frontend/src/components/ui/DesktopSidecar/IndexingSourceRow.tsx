import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { Button } from "../Controls/Button";
import { DisclosureChevron } from "../Controls/DisclosureChevron";
import { Tooltip } from "../Controls/Tooltip";
import { SettledInfoPill } from "../Trace/steps/ToolStatusPill";
import { ArrowUpIcon, ChatBubbleIcon, ComputerIcon, MailIcon } from "../icons";

import type { IndexingSummary } from "@/lib/desktopSidecar/indexingConfiguration";
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
  summary: IndexingSummary;
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
  const seconds =
    summary.observedAt === null
      ? null
      : Math.max(0, Math.floor((now - summary.observedAt) / 1000));
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
              : seconds < 86400
                ? Math.floor(seconds / 3600)
                : Math.floor(seconds / 86400)),
          seconds < 60
            ? "second"
            : seconds < 3600
              ? "minute"
              : seconds < 86400
                ? "hour"
                : "day",
        );
  const day = (at: number) =>
    i18n.date(at, { day: "numeric", month: "short", year: "numeric" });
  const rangeLabel = () => {
    const range = summary.range;
    if (range === null) return null;
    if (range.kind === "notScanned")
      return t({
        id: "sidecar.indexing.range.notScanned",
        message: "Not scanned yet",
      });
    if (range.kind === "nothingSearchable")
      return t({
        id: "sidecar.indexing.range.nothingSearchable",
        message: "Nothing searchable yet",
      });
    const end = range.through ?? summary.observedAt;
    if (end === null) return null;
    // Mail earlier on the day of an exclusive start is not guaranteed, so
    // start at the next full day unless the range ends before it.
    const nextDay = new Date(range.from);
    nextDay.setHours(24, 0, 0, 0);
    const from = day(
      range.fromInclusive ? range.from : Math.min(nextDay.getTime(), end),
    );
    if (range.through !== null)
      return i18n._({
        id: "sidecar.indexing.range.newerPending",
        message:
          "Indexed {from} to {through} · newest items still being indexed",
        values: { from, through: day(range.through) },
      });
    return new Date(end).toDateString() === new Date(now).toDateString()
      ? i18n._({
          id: "sidecar.indexing.range.toToday",
          message: "Indexed {from} to today",
          values: { from },
        })
      : i18n._({
          id: "sidecar.indexing.range.toDate",
          message: "Indexed {from} to {to}",
          values: { from, to: day(end) },
        });
  };
  const rangeText = rangeLabel();
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
    stopped: t({ id: "sidecar.indexing.status.stopped", message: "Stopped" }),
    scanning: t({
      id: "sidecar.indexing.status.scanning",
      message: "Scanning",
    }),
    indexing: t({
      id: "sidecar.indexing.status.indexing",
      message: "Indexing",
    }),
    notScanned: t({
      id: "sidecar.indexing.status.notScanned",
      message: "Not scanned yet",
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
              {entry.workAccount && (
                <SettledInfoPill
                  label={t({
                    id: "sidecar.indexing.workAccount",
                    message: "Work account",
                  })}
                />
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
            {rangeText && (
              <span className="block text-xs text-theme-fg-secondary">
                {rangeText}
              </span>
            )}
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
          {summary.range?.kind === "indexed" && summary.range.olderPending && (
            <p>
              {t({
                id: "sidecar.indexing.olderPending",
                message: "Older items are still being indexed",
              })}
            </p>
          )}
          {relative !== null && (
            <p>
              {i18n._({
                id: "sidecar.indexing.checked",
                message: "Checked {time}",
                values: { time: relative },
              })}
            </p>
          )}
          {!entry.editable && (
            <p>
              {t({
                id: "sidecar.indexing.sourceUpgrade",
                message:
                  "Update the desktop sidecar to change indexing for this source.",
              })}
            </p>
          )}
          {summary.notices.unreadable && (
            <p className="text-theme-warning-fg">
              {t({
                id: "sidecar.indexing.unreadable",
                message: "Some items couldn't be read",
              })}
            </p>
          )}
          {summary.notices.notStoredLocally && (
            <p>
              {t({
                id: "sidecar.indexing.notStoredLocally",
                message: "Some items aren't stored on this device",
              })}
            </p>
          )}
          {summary.notices.cachedOnly && (
            <p>
              {entry.product === "teams"
                ? t({
                    id: "sidecar.indexing.teamsRecentChats",
                    message:
                      "Teams keeps only recently opened chats on this device",
                  })
                : t({
                    id: "sidecar.indexing.cachedOnly",
                    message: "Only items cached on this device can be indexed",
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
