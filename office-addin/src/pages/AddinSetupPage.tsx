import { useEffect, useState } from "react";

const INTEGRATED_APPS_URL =
  "https://admin.cloud.microsoft/?#/Settings/IntegratedApps";

function getManifestUrl(): string {
  return new URL("manifest.xml", window.location.href).toString();
}

export function AddinSetupPage() {
  const [manifestXml, setManifestXml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
            : "Failed to load manifest",
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
          <p className="office-setup-eyebrow">Office Add-in Setup</p>
          <h1 className="office-setup-title">Upload the generated manifest</h1>
          <p className="office-setup-copy">
            Download the XML below as <code>manifest.xml</code>, then upload it
            in Microsoft 365 admin center under Integrated Apps.
          </p>
        </div>

        <ol className="office-setup-steps">
          <li>Review the generated manifest XML below.</li>
          <li>
            Download it as <code>manifest.xml</code>.
          </li>
          <li>
            Open{" "}
            <a
              href={INTEGRATED_APPS_URL}
              target="_blank"
              rel="noreferrer"
              className="office-setup-link"
            >
              Integrated Apps
            </a>{" "}
            and upload the downloaded file there.
          </li>
        </ol>

        <div className="office-setup-actions">
          <button
            type="button"
            onClick={handleDownload}
            disabled={isLoading || !manifestXml}
            className="office-setup-button"
          >
            Download manifest.xml
          </button>
          <a
            href={INTEGRATED_APPS_URL}
            target="_blank"
            rel="noreferrer"
            className="office-setup-button office-setup-button--secondary"
          >
            Open Integrated Apps
          </a>
        </div>

        {error ? (
          <p className="office-status office-status--error">{error}</p>
        ) : null}

        <label
          className="office-setup-preview-label"
          htmlFor="manifest-preview"
        >
          Manifest preview
        </label>
        <textarea
          id="manifest-preview"
          className="office-setup-preview"
          readOnly
          value={isLoading ? "Loading manifest..." : manifestXml}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
