import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";

const INTEGRATED_APPS_URL =
  "https://admin.cloud.microsoft/?#/Settings/IntegratedApps";

function getManifestUrl(): string {
  return new URL("manifest.xml", window.location.href).toString();
}

function getSpaRedirectUri(): string {
  return `brk-multihub://${window.location.host}`;
}

export function AddinSetupPage() {
  const [manifestXml, setManifestXml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const spaRedirectUri = getSpaRedirectUri();

  useEffect(() => {
    const abortController = new AbortController();

    async function loadManifest() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await window.fetch(getManifestUrl(), {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to load manifest (${response.status})`);
        }

        setManifestXml(await response.text());
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : t({
                id: "officeAddin.setup.loadManifestFailed",
                message: "Failed to load manifest",
              }),
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadManifest();

    return () => {
      abortController.abort();
    };
  }, []);

  function handleDownload() {
    const blob = new Blob([manifestXml], { type: "application/xml" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "manifest.xml";
    link.click();

    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="office-setup-page">
      <div className="office-setup-card">
        <div className="office-setup-header">
          <p className="office-setup-eyebrow">
            <Trans id="officeAddin.setup.eyebrow">Office Add-in Setup</Trans>
          </p>
          <h1 className="office-setup-title">
            <Trans id="officeAddin.setup.title">
              Upload the generated manifest
            </Trans>
          </h1>
          <p className="office-setup-copy">
            <Trans id="officeAddin.setup.copy">
              Download the XML below as <code>manifest.xml</code>, then upload
              it in Microsoft 365 admin center under Integrated Apps.
            </Trans>
          </p>
        </div>

        <ol className="office-setup-steps">
          <li>
            <Trans id="officeAddin.setup.redirectUriInstruction">
              In the Entra ID app registration, add the SPA redirect URI:
            </Trans>
            <CopyableCodeField content={spaRedirectUri} />
          </li>
          <li>
            <Trans id="officeAddin.setup.reviewManifest">
              Review the generated manifest XML below.
            </Trans>
          </li>
          <li>
            <Trans id="officeAddin.setup.downloadManifest">
              Download it as <code>manifest.xml</code>.
            </Trans>
          </li>
          <li>
            Open{" "}
            <a
              href={INTEGRATED_APPS_URL}
              target="_blank"
              rel="noreferrer"
              className="office-setup-link"
            >
              <Trans id="officeAddin.setup.integratedAppsLink">
                Integrated Apps
              </Trans>
            </a>{" "}
            <Trans id="officeAddin.setup.uploadInstruction">
              and upload the downloaded file there.
            </Trans>
          </li>
        </ol>

        <div className="office-setup-actions">
          <button
            type="button"
            onClick={handleDownload}
            disabled={isLoading || !manifestXml}
            className="office-setup-button"
          >
            <Trans id="officeAddin.setup.downloadButton">
              Download manifest.xml
            </Trans>
          </button>
          <a
            href={INTEGRATED_APPS_URL}
            target="_blank"
            rel="noreferrer"
            className="office-setup-button office-setup-button--secondary"
          >
            <Trans id="officeAddin.setup.openIntegratedApps">
              Open Integrated Apps
            </Trans>
          </a>
        </div>

        {error ? (
          <p className="office-status office-status--error">{error}</p>
        ) : null}

        <label
          className="office-setup-preview-label"
          htmlFor="manifest-preview"
        >
          <Trans id="officeAddin.setup.manifestPreview">Manifest preview</Trans>
        </label>
        <textarea
          id="manifest-preview"
          className="office-setup-preview"
          readOnly
          value={
            isLoading
              ? t({
                  id: "officeAddin.setup.loadingManifest",
                  message: "Loading manifest...",
                })
              : manifestXml
          }
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function CopyableCodeField({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // ignore clipboard errors
      });
  }, [content]);

  return (
    <div className="office-setup-code-field">
      <div className="office-setup-code-value">{content}</div>
      <div className="office-setup-code-actions">
        <button
          type="button"
          onClick={handleCopy}
          className="office-setup-code-button"
        >
          {copied
            ? t({
                id: "officeAddin.setup.copied",
                message: "Copied!",
              })
            : t({
                id: "officeAddin.setup.copyButton",
                message: "Copy",
              })}
        </button>
      </div>
    </div>
  );
}
