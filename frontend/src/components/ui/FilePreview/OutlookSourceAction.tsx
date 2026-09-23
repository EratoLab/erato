import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import {
  Button,
  controlSurfaceClassName,
} from "@/components/ui/Controls/Button";
import { detectDesktopSidecarClientPlatform } from "@/lib/desktopSidecarPlatform";
import {
  outlookSidecarUri,
  outlookSourceReferences,
} from "@/lib/outlookNavigation";
import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";
import { useOutlookSourceNavigator } from "@/providers/OutlookSourceNavigationProvider";

import type { OutlookFileProvenance } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export function OutlookSourceAction({
  provenance,
}: {
  provenance?: OutlookFileProvenance;
}) {
  const navigator = useOutlookSourceNavigator();
  const { snapshot } = useDesktopSidecar();
  const [selected, setSelected] = useState(0);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const selectId = useId();
  const references = outlookSourceReferences(provenance);
  const reference = references.at(selected) ?? references.at(0);
  if (!reference) return null;
  const office = navigator?.canOpen(reference) ? navigator : null;
  const platform = detectDesktopSidecarClientPlatform(
    window.navigator.userAgent,
    window.navigator.platform,
  );
  const uri = outlookSidecarUri(reference, snapshot, platform.os);

  return (
    <div className="flex flex-col items-center gap-2">
      {references.length > 1 && (
        <>
          <label
            htmlFor={selectId}
            className="text-sm"
          >{t`Source email`}</label>
          <select
            id={selectId}
            value={selected}
            disabled={opening}
            onChange={(event) => {
              setSelected(Number(event.target.value));
              setFailed(false);
            }}
            className="rounded border border-theme-border bg-theme-bg-primary p-2 text-sm text-theme-fg-primary"
          >
            {references.map((source, index) => (
              <option key={index} value={index}>
                {t({
                  message: "Email {number}",
                  values: { number: index + 1 },
                })}
                {source.mailbox?.emailAddress
                  ? ` · ${source.mailbox.emailAddress}`
                  : ""}
              </option>
            ))}
          </select>
        </>
      )}
      {office ? (
        <Button
          variant="secondary"
          loading={opening}
          onClick={() => {
            setFailed(false);
            setOpening(true);
            void office
              .open(reference)
              .catch(() => setFailed(true))
              .finally(() => setOpening(false));
          }}
        >{t`Open in Outlook`}</Button>
      ) : uri ? (
        <a
          href={uri}
          target="_blank"
          rel="noopener noreferrer"
          className={controlSurfaceClassName()}
        >{t`Open in Outlook`}</a>
      ) : (
        <p className="text-sm text-theme-fg-secondary">{t`Opening this source email is unavailable on this device.`}</p>
      )}
      {failed && (
        <p
          role="alert"
          className="text-sm text-theme-error-fg"
        >{t`Outlook could not open this email. It may have been moved, deleted, or be unavailable in this mailbox.`}</p>
      )}
    </div>
  );
}
