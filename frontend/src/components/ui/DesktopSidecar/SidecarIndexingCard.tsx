import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useEffect, useId, useState } from "react";

import { useSidecarIndexing } from "@/hooks/useSidecarIndexing";
import {
  mailboxIndexingSummary,
  sourceIndexingSummary,
} from "@/lib/desktopSidecar/indexingConfiguration";
import {
  indexingEntries,
  indexingEntryPatch,
} from "@/lib/desktopSidecar/indexingSources";
import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import { IndexingSourceRow } from "./IndexingSourceRow";
import { SidecarMaintenance } from "./SidecarMaintenance";
import { Button } from "../Controls/Button";
import { Input } from "../Input/Input";
import { EntityRow } from "../Settings/EntityRow";
import { SettingsDisclosure } from "../Settings/SettingsDisclosure";
import { ComputerIcon } from "../icons";

import type { SidecarConfiguration } from "@erato/desktop-sidecar-protocol";
import type { ReactNode } from "react";

export function SidecarIndexingCard() {
  const { client, snapshot } = useDesktopSidecar();
  if (snapshot.state !== "ready" || !client?.supports("indexing.status.v1"))
    return null;
  return (
    <EntityRow
      icon={<ComputerIcon className="size-4" />}
      name={t({ id: "sidecar.indexing.title", message: "Local indexing" })}
      caption={t({
        id: "sidecar.indexing.caption",
        message: "Local search on this device",
      })}
    >
      <SidecarIndexingControls />
    </EntityRow>
  );
}

export function SidecarIndexingControls({
  connectionActions,
}: {
  connectionActions?: ReactNode;
}) {
  const indexing = useSidecarIndexing();
  return (
    <div className="space-y-6">
      <SidecarIndexingSettings indexing={indexing} />
      <SidecarMaintenance indexing={indexing}>
        {connectionActions}
      </SidecarMaintenance>
    </div>
  );
}

function SidecarIndexingSettings({
  indexing,
}: {
  indexing: ReturnType<typeof useSidecarIndexing>;
}) {
  const {
    data,
    isPending,
    error,
    save,
    saving,
    saveError,
    supported,
    resetting,
  } = indexing;
  const [parallelism, setParallelism] = useState<string | null>(null);
  const [throttle, setThrottle] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<SidecarConfiguration> | null>(
    null,
  );
  const [now, setNow] = useState(Date.now);
  const indexingTitleId = useId();
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
  const { status, mailboxes, sources } = data;
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
  const persisted = indexingEntries(mailboxes, sources, configuration);
  const draftConfiguration = {
    ...configuration,
    user_configuration: { ...configuration.user_configuration, ...draft },
  };
  const ordered = indexingEntries(mailboxes, sources, draftConfiguration);
  const move = (index: number, direction: number) => {
    const entries = [...ordered];
    [entries[index], entries[index + direction]] = [
      entries[index + direction],
      entries[index],
    ];
    setDraft({
      ...draft,
      ...indexingEntryPatch(
        draftConfiguration,
        entries.map((entry, priority) => ({ ...entry, priority })),
      ),
    });
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
        ...draft,
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
  const hasChanges =
    draft !== null || parallelism !== null || throttle !== null;
  const enabledCount = ordered.filter((entry) => entry.enabled).length;
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
      <form
        aria-labelledby={indexingTitleId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            busy ||
            !hasChanges ||
            !validLimit(parallelismValue) ||
            !validLimit(throttleValue)
          )
            return;
          void persistDraft();
        }}
      >
        <div className="space-y-1">
          <h3
            id={indexingTitleId}
            className="text-sm font-medium text-theme-fg-primary"
          >
            {t({ id: "sidecar.indexing.title", message: "Local indexing" })}
          </h3>
          <p className="text-xs text-theme-fg-secondary">
            {t({
              id: "sidecar.indexing.description",
              message:
                "Choose what is indexed for local search. Changes take effect when you save.",
            })}
          </p>
        </div>
        <SettingsDisclosure
          title={t({ id: "sidecar.indexing.sources", message: "Sources" })}
          count={ordered.length}
          description={i18n._({
            id: "sidecar.indexing.enabledSources",
            message: "{enabled} enabled",
            values: { enabled: i18n.number(enabledCount) },
          })}
        >
          <p className="text-xs text-theme-fg-secondary">
            {t({
              id: "sidecar.indexing.sourcesHelp",
              message:
                "Enable sources for indexing. Expand a source to see progress and change its priority.",
            })}
          </p>
          {ordered.length === 0 && (
            <p className="text-xs text-theme-fg-secondary">
              {t({
                id: "sidecar.indexing.empty",
                message: "No local sources found.",
              })}
            </p>
          )}
          <ul className="divide-y divide-theme-border">
            {ordered.map((entry, index) => {
              const enabled =
                persisted.find(
                  (item) => item.id === entry.id && item.scope === entry.scope,
                )?.enabled ?? true;
              const summary =
                entry.scope === "source"
                  ? sourceIndexingSummary(
                      status,
                      entry.id,
                      entry.product,
                      enabled,
                    )
                  : mailboxIndexingSummary(status, entry.id, enabled);
              return (
                <IndexingSourceRow
                  key={`${entry.scope}:${entry.id}`}
                  entry={entry}
                  summary={summary}
                  now={now}
                  busy={busy}
                  canMoveUp={index > 0 && ordered[index - 1].editable}
                  canMoveDown={
                    index < ordered.length - 1 && ordered[index + 1].editable
                  }
                  onMove={(direction) => move(index, direction)}
                  onToggle={(enabled) =>
                    setDraft({
                      ...draft,
                      ...indexingEntryPatch(draftConfiguration, [
                        { ...entry, enabled },
                      ]),
                    })
                  }
                />
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
          {ordered.some((entry) => entry.product === "teams") && (
            <p className="text-xs text-theme-fg-secondary">
              {t({
                id: "sidecar.indexing.teamsScope",
                message:
                  "Teams status and settings apply to each local cache. Accounts sharing a cache are combined.",
              })}
            </p>
          )}
        </SettingsDisclosure>
        <SettingsDisclosure
          title={t({ id: "sidecar.indexing.speed", message: "Indexing speed" })}
          description={t({
            id: "sidecar.indexing.speedHelp",
            message: "Control how much work the sidecar processes at once.",
          })}
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
              <p
                id={throttleHelpId}
                className="text-xs text-theme-fg-secondary"
              >
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
        </SettingsDisclosure>
        {hasChanges && (
          <p role="status" className="text-xs text-theme-fg-secondary">
            {t({ id: "sidecar.indexing.unsaved", message: "Unsaved changes" })}
          </p>
        )}
        <Button
          type="submit"
          variant="secondary"
          loading={saving}
          disabled={
            busy ||
            !hasChanges ||
            !validLimit(parallelismValue) ||
            !validLimit(throttleValue)
          }
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
