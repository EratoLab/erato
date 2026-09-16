import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useState } from "react";

import { useSidecarIndexing } from "@/hooks/useSidecarIndexing";
import {
  effectiveMailboxes,
  mailboxCoverage,
  orderedMailboxes,
} from "@/lib/desktopSidecar/indexingConfiguration";
import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import { Button } from "../Controls/Button";
import { Input } from "../Input/Input";
import { EntityRow } from "../Settings/EntityRow";
import { ArrowUpIcon, ComputerIcon } from "../icons";

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
  const { data, isPending, error, save, saving, saveError, supported } =
    useSidecarIndexing();
  const [parallelism, setParallelism] = useState<string | null>(null);
  const [throttle, setThrottle] = useState<string | null>(null);
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
  const ordered = orderedMailboxes(mailboxes, configuration);
  const overrides = effectiveMailboxes(configuration);
  const move = (index: number, direction: number) => {
    const entries = [...ordered];
    [entries[index], entries[index + direction]] = [
      entries[index + direction],
      entries[index],
    ];
    // Keep disconnected mailbox overrides; assign explicit priorities to visible entries.
    const visible = new Set(entries.map((entry) => entry.id.toLowerCase()));
    save({
      indexing_mailboxes: [
        ...overrides.filter(
          (entry) => !visible.has(entry.mailbox_id.toLowerCase()),
        ),
        ...entries.map((entry, priority) => ({
          ...overrides.find(
            (override) =>
              override.mailbox_id.toLowerCase() === entry.id.toLowerCase(),
          ),
          mailbox_id: entry.id,
          enabled: entry.enabled,
          priority,
        })),
      ],
    });
  };
  const formatCount = (value: number | null) =>
    value === null ? "—" : value.toLocaleString();
  const sum = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a + b;
  const validLimit = (value: string) =>
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0;
  const parallelismValue =
    parallelism ?? String(status.effectiveConfiguration.parallelism);
  const throttleValue =
    throttle ?? String(status.effectiveConfiguration.documentsPerMinute);

  return (
    <div className="max-h-96 space-y-3 overflow-y-auto">
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
          const emails = mailboxCoverage(status, mailbox.id, "email");
          const attachments = mailboxCoverage(status, mailbox.id, "file");
          return (
            <li key={mailbox.id} className="flex items-start gap-2">
              <div className="flex flex-col">
                <Button
                  variant="icon-only"
                  disabled={saving || index === 0}
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
                <Button
                  variant="icon-only"
                  disabled={saving || index === ordered.length - 1}
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
              </div>
              <div className="min-w-0 flex-1 text-xs text-theme-fg-secondary">
                <label className="flex items-center gap-2 text-sm text-theme-fg-primary">
                  <input
                    type="checkbox"
                    checked={mailbox.enabled}
                    disabled={saving}
                    aria-label={i18n._({
                      id: "sidecar.indexing.enable",
                      message: "Enable indexing for {mailbox}",
                      values: {
                        mailbox: mailbox.emailAddress ?? mailbox.displayName,
                      },
                    })}
                    onChange={(event) =>
                      save({
                        indexing_mailboxes: [
                          ...overrides.filter(
                            (entry) =>
                              entry.mailbox_id.toLowerCase() !==
                              mailbox.id.toLowerCase(),
                          ),
                          {
                            ...overrides.find(
                              (entry) =>
                                entry.mailbox_id.toLowerCase() ===
                                mailbox.id.toLowerCase(),
                            ),
                            mailbox_id: mailbox.id,
                            enabled: event.target.checked,
                            priority: mailbox.priority,
                          },
                        ],
                      })
                    }
                  />
                  <span className="break-all">
                    {mailbox.emailAddress ?? mailbox.displayName}
                  </span>
                </label>
                <p>
                  {i18n._({
                    id: "sidecar.indexing.emails",
                    message: "{indexed} / {total} emails indexed",
                    values: {
                      indexed: formatCount(emails.indexed),
                      total: formatCount(emails.total),
                    },
                  })}
                </p>
                <p>
                  {i18n._({
                    id: "sidecar.indexing.attachments",
                    message: "{indexed} / {total} attachments indexed",
                    values: {
                      indexed: formatCount(attachments.indexed),
                      total: formatCount(attachments.total),
                    },
                  })}
                </p>
                <p>
                  {i18n._({
                    id: "sidecar.indexing.documents",
                    message: "{indexed} / {total} documents indexed",
                    values: {
                      indexed: formatCount(
                        sum(emails.indexed, attachments.indexed),
                      ),
                      total: formatCount(sum(emails.total, attachments.total)),
                    },
                  })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "sidecar.indexing.knownTotals",
          message:
            "Totals reflect discovered items. A dash means statistics are not available yet.",
        })}
      </p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validLimit(parallelismValue) || !validLimit(throttleValue))
            return;
          save({
            indexing_parallelism: Number(parallelismValue),
            indexing_documents_per_minute: Number(throttleValue),
          });
        }}
      >
        <label className="block text-sm">
          {t({
            id: "sidecar.indexing.parallelism",
            message: "Indexing parallelism",
          })}
          <Input
            type="number"
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            step={1}
            required
            value={parallelismValue}
            disabled={saving}
            onChange={(event) => setParallelism(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t({
            id: "sidecar.indexing.throttle",
            message: "Documents per minute",
          })}
          <Input
            type="number"
            min={1}
            max={Number.MAX_SAFE_INTEGER}
            step={1}
            required
            value={throttleValue}
            disabled={saving}
            onChange={(event) => setThrottle(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          loading={saving}
          disabled={!validLimit(parallelismValue) || !validLimit(throttleValue)}
        >
          {t({
            id: "sidecar.indexing.save",
            message: "Save indexing settings",
          })}
        </Button>
      </form>
    </div>
  );
}
