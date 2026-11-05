import { Alert, Button } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";

/** What the page posts to the host once React has mounted the window. */
export const READY_ACTION = "ready";

export const readyMessage = (version: string): string =>
  JSON.stringify({ action: READY_ACTION, version });

interface SmokeWindowProps {
  /** The active catalog, shown so a wrong host locale is visible at a glance. */
  locale: string;
  /** The version the host embeds, when it says so; shown next to the bundle's own. */
  hostVersion?: string;
}

/**
 * Proves the build chain: a kit Alert and Button, a translated string and
 * the ready message the sidecar's smoke mode waits for. It is the only
 * window until the review window moves onto this bundle.
 */
export function SmokeWindow({ locale, hostVersion }: SmokeWindowProps) {
  const [clicks, setClicks] = useState(0);
  const version = __DESKTOP_UI_VERSION__;

  useEffect(() => {
    window.ipc?.postMessage(readyMessage(version));
  }, [version]);

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-theme-bg-primary p-6 text-theme-fg-primary">
      <Alert type="info" role="status">
        {t({
          id: "desktopUi.smoke.loaded",
          message: "The desktop UI bundle loaded inside the sidecar window.",
        })}
      </Alert>
      <div>
        <Button variant="primary" onClick={() => setClicks((n) => n + 1)}>
          {t({ id: "desktopUi.smoke.button", message: "Count a click" })}
        </Button>
      </div>
      <p className="text-sm text-theme-fg-secondary" data-testid="smoke-clicks">
        <Trans id="desktopUi.smoke.clicks">Clicks: {clicks}</Trans>
      </p>
      <p className="text-sm text-theme-fg-muted" data-testid="smoke-version">
        <Trans id="desktopUi.smoke.version">
          Bundle {version} · locale {locale}
        </Trans>
        {hostVersion ? (
          <>
            {" · "}
            <Trans id="desktopUi.smoke.hostVersion">
              host expects {hostVersion}
            </Trans>
          </>
        ) : null}
      </p>
    </main>
  );
}
