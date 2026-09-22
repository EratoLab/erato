import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useEffect, useId, useState } from "react";

import { useSidecarIndexing } from "@/hooks/useSidecarIndexing";
import {
  effectiveMailboxes,
  indexingMailboxId,
  mailboxIndexingSummary,
  orderedMailboxes,
} from "@/lib/desktopSidecar/indexingConfiguration";
import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import { Button } from "../Controls/Button";
import { Tooltip } from "../Controls/Tooltip";
import { Input } from "../Input/Input";
import { EntityRow } from "../Settings/EntityRow";
import { ArrowUpIcon, ComputerIcon, MailIcon, Trash } from "../icons";

export function SidecarIndexingCard() {
  const { client, snapshot } = useDesktopSidecar();
  if (snapshot.state !== "ready" || !client?.supports("indexing.status.v1"))
    return null;
  return (
    <EntityRow
      icon={<ComputerIcon className="size-4" />}
      name={t({ id: "sidecar.indexing.title", message: "Mailbox indexing" })}
      caption={t({
        id: "sidecar.indexing.caption",
        message: "Local search on this device",
      })}
    >
      <SidecarIndexingControls />
    </EntityRow>
  );
}

export function SidecarIndexingControls() {
  const {
    data,
    isPending,
    error,
    save,
    saving,
    saveError,
    supported,
    reset,
    resetSupported,
    resetting,
    resetError,
    resetSucceeded,
  } = useSidecarIndexing();
  const [parallelism, setParallelism] = useState<string | null>(null);
  const [throttle, setThrottle] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<
    typeof effectiveMailboxes
  > | null>(null);
  const [now, setNow] = useState(Date.now);
  const parallelismId = useId();
  const parallelismHelpId = useId();
  const throttleId = useId();
  const throttleHelpId = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!supported)
    return (
      <p>
        {t({
          id: "sidecar.indexing.upgrade",
          message: "Update the desktop sidecar to configure indexing.",
        })}
      </p>
    );
  if (isPending)
    return (
      <p>
        {t({
          id: "sidecar.indexing.loading",
          message: "Loading indexing statistics…",
        })}
      </p>
    );
  if (error)
    return (
      <p role="alert">
        {t({
          id: "sidecar.indexing.loadError",
          message: "Could not load indexing statistics. Retrying…",
        })}
      </p>
    );
  const { status, mailboxes } = data;
  const configuration = status.configuration;
  if (!configuration)
    return (
      <p>
        {t({
          id: "sidecar.indexing.upgrade",
          message: "Update the desktop sidecar to configure indexing.",
        })}
      </p>
    );
  const busy = saving || resetting || status.resetInProgress === true;
  const persisted = orderedMailboxes(mailboxes, configuration);
  const overrides = draft ?? effectiveMailboxes(configuration);
  const ordered = orderedMailboxes(mailboxes, {
    ...configuration,
    user_configuration: {
      ...configuration.user_configuration,
      indexing_mailboxes: overrides,
    },
  });
  const move = (index: number, direction: number) => {
    const entries = [...ordered];
    [entries[index], entries[index + direction]] = [
      entries[index + direction],
      entries[index],
    ];
    const visible = new Set(
      entries.map((entry) => indexingMailboxId(entry.id)),
    );
    setDraft([
      ...overrides.filter(
        (entry) => !visible.has(indexingMailboxId(entry.mailbox_id)),
      ),
      ...entries.map((entry, priority) => ({
        ...overrides.find(
          (override) =>
            indexingMailboxId(override.mailbox_id) ===
            indexingMailboxId(entry.id),
        ),
        mailbox_id: indexingMailboxId(entry.id),
        enabled: entry.enabled,
        priority,
      })),
    ]);
  };
  const validLimit = (value: string) =>
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0;
  const parallelismValue =
    parallelism ?? String(status.effectiveConfiguration.parallelism);
  const throttleValue =
    throttle ?? String(status.effectiveConfiguration.documentsPerMinute);
  const persistDraft = async () => {
    try {
      await save({
        ...(draft === null ? {} : { indexing_mailboxes: draft }),
        indexing_parallelism: Number(parallelismValue),
        indexing_documents_per_minute: Number(throttleValue),
      });
      setDraft(null);
      setParallelism(null);
      setThrottle(null);
    } catch {
      /* Retain the draft; the mutation exposes the error above. */
    }
  };
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
  return (
    <div className="space-y-4">
      {saveError && (
        <p role="alert" className="text-theme-error-fg">
          {t({
            id: "sidecar.indexing.saveError",
            message: "Could not save indexing settings. Please try again.",
          })}
        </p>
      )}
      {ordered.length === 0 && (
        <p>
          {t({
            id: "sidecar.indexing.empty",
            message: "No local mailboxes found.",
          })}
        </p>
      )}
      <ul className="space-y-3">
        {ordered.map((mailbox, index) => {
          const mailboxId = indexingMailboxId(mailbox.id);
          const summary = mailboxIndexingSummary(
            status,
            mailbox.id,
            persisted.find((entry) => entry.id === mailbox.id)?.enabled ?? true,
          );
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
          return (
            <li key={mailbox.id} className="flex items-start gap-2">
              <div className="flex flex-col">
                <Tooltip
                  content={t({
                    id: "sidecar.indexing.increasePriority",
                    message: "Increase priority",
                  })}
                >
                  <Button
                    variant="icon-only"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={i18n._({
                      id: "sidecar.indexing.moveUp",
                      message: "Increase priority for {mailbox}",
                      values: {
                        mailbox: mailbox.emailAddress ?? mailbox.displayName,
                      },
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
                    disabled={busy || index === ordered.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={i18n._({
                      id: "sidecar.indexing.moveDown",
                      message: "Decrease priority for {mailbox}",
                      values: {
                        mailbox: mailbox.emailAddress ?? mailbox.displayName,
                      },
                    })}
                    icon={<ArrowUpIcon className="size-4 rotate-180" />}
                  />
                </Tooltip>
              </div>
              <div className="min-w-0 flex-1 space-y-1 text-xs text-theme-fg-secondary">
                <label className="flex items-center gap-2 text-sm text-theme-fg-primary">
                  <input
                    type="checkbox"
                    checked={mailbox.enabled}
                    disabled={busy}
                    aria-label={i18n._({
                      id: "sidecar.indexing.enable",
                      message: "Enable indexing for {mailbox}",
                      values: {
                        mailbox: mailbox.emailAddress ?? mailbox.displayName,
                      },
                    })}
                    onChange={(event) =>
                      setDraft([
                        ...overrides.filter(
                          (entry) =>
                            indexingMailboxId(entry.mailbox_id) !== mailboxId,
                        ),
                        {
                          ...overrides.find(
                            (entry) =>
                              indexingMailboxId(entry.mailbox_id) === mailboxId,
                          ),
                          mailbox_id: mailboxId,
                          enabled: event.target.checked,
                          priority: mailbox.priority,
                        },
                      ])
                    }
                  />
                  <span className="break-all">
                    {mailbox.emailAddress ?? mailbox.displayName}
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <MailIcon className="size-3" />
                    {t({
                      id: "sidecar.indexing.source.outlook",
                      message: "Outlook",
                    })}
                  </span>
                  <span
                    className={`rounded border border-theme-border px-1.5 py-0.5 ${["scanFailed", "sourceUnavailable", "indexingUnavailable", "partial"].includes(summary.state) ? "text-theme-warning-fg" : "text-theme-fg-secondary"}`}
                  >
                    {labels[summary.state]}
                  </span>
                </div>
                <p>
                  {summary.total === null || summary.indexed === null
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
                          message: "{percentage}% of {total} documents indexed",
                          values: {
                            percentage: i18n.number(summary.percentage ?? 0),
                            total: i18n.number(summary.total),
                          },
                        })}
                </p>
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
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "sidecar.indexing.discoveredTotals",
          message:
            "Totals reflect discovered documents and may grow while scanning.",
        })}
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            busy ||
            !validLimit(parallelismValue) ||
            !validLimit(throttleValue)
          )
            return;
          void persistDraft();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={parallelismId} className="text-sm">
              {t({
                id: "sidecar.indexing.parallelism",
                message: "Indexing parallelism",
              })}
            </label>
            <p
              id={parallelismHelpId}
              className="text-xs text-theme-fg-secondary"
            >
              {t({
                id: "sidecar.indexing.parallelismHelp",
                message:
                  "Maximum number of documents processed at the same time.",
              })}
            </p>
          </div>
          <div className="w-24 shrink-0">
            <Input
              id={parallelismId}
              aria-describedby={parallelismHelpId}
              type="number"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              required
              value={parallelismValue}
              disabled={busy}
              onChange={(event) => setParallelism(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={throttleId} className="text-sm">
              {t({
                id: "sidecar.indexing.throttle",
                message: "Documents per minute",
              })}
            </label>
            <p id={throttleHelpId} className="text-xs text-theme-fg-secondary">
              {t({
                id: "sidecar.indexing.throttleHelp",
                message:
                  "Maximum number of documents that can start processing per minute.",
              })}
            </p>
          </div>
          <div className="w-24 shrink-0">
            <Input
              id={throttleId}
              aria-describedby={throttleHelpId}
              type="number"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              required
              value={throttleValue}
              disabled={busy}
              onChange={(event) => setThrottle(event.target.value)}
            />
          </div>
        </div>
        {(draft !== null || parallelism !== null || throttle !== null) && (
          <p role="status" className="text-xs text-theme-fg-secondary">
            {t({ id: "sidecar.indexing.unsaved", message: "Unsaved changes" })}
          </p>
        )}
        <Button
          type="submit"
          variant="secondary"
          loading={saving}
          disabled={
            busy || !validLimit(parallelismValue) || !validLimit(throttleValue)
          }
        >
          {t({
            id: "sidecar.indexing.save",
            message: "Save indexing settings",
          })}
        </Button>
      </form>
      {resetSupported && (
        <Button
          variant="danger"
          icon={<Trash className="size-4" />}
          disabled={busy}
          loading={resetting}
          confirmAction
          confirmTitle={t({
            id: "sidecar.indexing.reset",
            message: "Reset sidecar indices",
          })}
          confirmMessage={t({
            id: "sidecar.indexing.resetConfirm",
            message:
              "Clear all local search indices? Original emails, attachments and settings are kept. Indexing stays stopped until resumed or the sidecar is restarted.",
          })}
          onClick={() => reset()}
        >
          {t({
            id: "sidecar.indexing.reset",
            message: "Reset sidecar indices",
          })}
        </Button>
      )}
      {resetError && (
        <p role="alert" className="text-theme-error-fg">
          {t({
            id: "sidecar.indexing.resetError",
            message:
              "Could not confirm the reset completed. Check the status or try again.",
          })}
        </p>
      )}
      {resetSucceeded && (
        <p role="status">
          {t({
            id: "sidecar.indexing.resetSuccess",
            message: "Local search indices cleared. Indexing is stopped.",
          })}
        </p>
      )}
    </div>
  );
}
