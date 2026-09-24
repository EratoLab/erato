import { I18nProvider } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";

const INTEGRATED_APPS_URL =
  "https://admin.cloud.microsoft/?#/Settings/IntegratedApps";
const EXCHANGE_ADDIN_DOCS_URL =
  "https://learn.microsoft.com/en-us/exchange/install-or-remove-outlook-add-ins-2013-help";
const EXCHANGE_LIMIT_ACCESS_DOCS_URL =
  "https://learn.microsoft.com/en-us/exchange/manage-user-access-to-add-ins-2013-help#use-the-exchange-management-shell-to-limit-add-in-availability-to-specific-users";
const SHAREPOINT_CATALOG_DOCS_URL =
  "https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-task-pane-and-content-add-ins-to-an-add-in-catalog";

type OfficeProduct = "outlook" | "teams" | "word" | "excel" | "powerpoint";
type ExchangeSetup = "exchange-online" | "exchange-server";

type ProductOption = {
  id: OfficeProduct;
  label: string;
  selectable: boolean;
};

type ExchangeSetupOption = {
  id: ExchangeSetup;
  label: string;
  manifestPath: string;
};

const PRODUCT_OPTIONS: ProductOption[] = [
  { id: "outlook", label: "Outlook", selectable: true },
  { id: "teams", label: "Teams", selectable: true },
  { id: "word", label: "Word", selectable: true },
  { id: "excel", label: "Excel", selectable: false },
  { id: "powerpoint", label: "PowerPoint", selectable: false },
];

const DOCUMENT_MANIFEST_PATH = "manifest-document.xml";

const EXCHANGE_SETUP_OPTIONS: ExchangeSetupOption[] = [
  {
    id: "exchange-online",
    label: "Exchange Online",
    manifestPath: "manifest.xml",
  },
  {
    id: "exchange-server",
    label: "Exchange Server SE / Exchange Server 2016",
    manifestPath: "manifest-exchange-server.xml",
  },
];

export function AddinSetupRoute() {
  return (
    <I18nProvider>
      <AddinSetupPage />
    </I18nProvider>
  );
}

function getManifestPath(
  product: OfficeProduct,
  exchangeSetup: ExchangeSetup,
): string {
  if (product === "word") {
    return DOCUMENT_MANIFEST_PATH;
  }
  if (product === "teams") {
    return "teams/manifest.json";
  }
  const selectedSetup =
    EXCHANGE_SETUP_OPTIONS.find((option) => option.id === exchangeSetup) ??
    EXCHANGE_SETUP_OPTIONS[0];
  return selectedSetup.manifestPath;
}

/** Both Exchange variants are sideloaded with the filename shown in the instructions. */
function getDownloadFilename(product: OfficeProduct): string {
  if (product === "word") return DOCUMENT_MANIFEST_PATH;
  if (product === "teams") return "erato-teams-app.zip";
  return "manifest.xml";
}

function getManifestUrl(
  product: OfficeProduct,
  exchangeSetup: ExchangeSetup,
): string {
  return new URL(
    getManifestPath(product, exchangeSetup),
    window.location.href,
  ).toString();
}

function getSpaRedirectUri(): string {
  return `brk-multihub://${window.location.host}`;
}

export function AddinSetupPage() {
  const [selectedProduct, setSelectedProduct] =
    useState<OfficeProduct>("outlook");
  const [selectedExchangeSetup, setSelectedExchangeSetup] =
    useState<ExchangeSetup>("exchange-online");
  const [manifestXml, setManifestXml] = useState("");
  const [manifestJson, setManifestJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const spaRedirectUri = getSpaRedirectUri();

  useEffect(() => {
    const abortController = new AbortController();

    async function loadManifest() {
      try {
        setIsLoading(true);
        setError(null);
        setManifestXml("");
        setManifestJson("");

        const response = await window.fetch(
          getManifestUrl(selectedProduct, selectedExchangeSetup),
          {
            signal: abortController.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to load manifest (${response.status})`);
        }

        const manifest = await response.text();
        if (selectedProduct === "teams") {
          setManifestJson(JSON.stringify(JSON.parse(manifest), null, 2));
        } else {
          setManifestXml(manifest);
        }
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
  }, [selectedProduct, selectedExchangeSetup]);

  async function handleDownload() {
    if (selectedProduct === "teams") {
      try {
        setIsDownloading(true);
        setError(null);
        const response = await window.fetch(
          new URL("teams/app-package.zip", window.location.href).toString(),
        );
        if (!response.ok) {
          throw new Error(
            `Failed to download Teams app package (${response.status})`,
          );
        }
        const url = window.URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = getDownloadFilename(selectedProduct);
        link.click();
        window.URL.revokeObjectURL(url);
      } catch (downloadError) {
        setError(
          downloadError instanceof Error
            ? downloadError.message
            : t({
                id: "officeAddin.teams.setup.downloadFailed",
                message: "Failed to download Teams app package",
              }),
        );
      } finally {
        setIsDownloading(false);
      }
      return;
    }
    const blob = new Blob([manifestXml], { type: "application/xml" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = getDownloadFilename(selectedProduct);
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
            {selectedProduct === "teams" ? (
              <Trans id="officeAddin.teams.setup.copy">
                Download the Teams app package ZIP and upload it in Microsoft
                365 admin center under Integrated Apps. The JSON preview is for
                review; upload the ZIP package.
              </Trans>
            ) : selectedProduct === "word" ? (
              <Trans id="officeAddin.word.setup.copy">
                Download the XML below as <code>manifest-document.xml</code>,
                then deploy it through the Integrated apps portal or a
                SharePoint app catalog. This is a second add-in, separate from
                the Outlook one.
              </Trans>
            ) : selectedExchangeSetup === "exchange-online" ? (
              <Trans id="officeAddin.setup.exchangeOnline.copy">
                Download the XML below as <code>manifest.xml</code>, then upload
                it in Microsoft 365 admin center under Integrated Apps.
              </Trans>
            ) : (
              <Trans id="officeAddin.setup.exchangeServer.copy">
                Download the Exchange Server XML below as{" "}
                <code>manifest.xml</code>, then install it in Exchange admin
                center or with Exchange Management Shell.
              </Trans>
            )}
          </p>
        </div>

        <SetupSelectors
          selectedExchangeSetup={selectedExchangeSetup}
          selectedProduct={selectedProduct}
          onSelectExchangeSetup={setSelectedExchangeSetup}
          onSelectProduct={setSelectedProduct}
        />

        {selectedProduct === "teams" ? (
          <TeamsInstructions />
        ) : selectedProduct === "word" ? (
          <WordInstructions spaRedirectUri={spaRedirectUri} />
        ) : selectedExchangeSetup === "exchange-online" ? (
          <ExchangeOnlineInstructions spaRedirectUri={spaRedirectUri} />
        ) : (
          <ExchangeServerInstructions />
        )}

        <div className="office-setup-actions">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={
              isLoading ||
              isDownloading ||
              (selectedProduct === "teams" ? !manifestJson : !manifestXml)
            }
            className="office-setup-button"
          >
            {selectedProduct === "teams" ? (
              <Trans id="officeAddin.teams.setup.downloadButton">
                Download Teams app package
              </Trans>
            ) : selectedProduct === "word" ? (
              <Trans id="officeAddin.word.setup.downloadButton">
                Download manifest-document.xml
              </Trans>
            ) : (
              <Trans id="officeAddin.setup.downloadButton">
                Download manifest.xml
              </Trans>
            )}
          </button>
          {selectedProduct === "teams" ? (
            <a
              href={INTEGRATED_APPS_URL}
              target="_blank"
              rel="noreferrer"
              className="office-setup-button office-setup-button--secondary"
            >
              <Trans id="officeAddin.teams.setup.openIntegratedApps">
                Open Integrated Apps
              </Trans>
            </a>
          ) : selectedProduct === "word" ? (
            <>
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
              <a
                href={SHAREPOINT_CATALOG_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="office-setup-button office-setup-button--secondary"
              >
                <Trans id="officeAddin.word.setup.openCatalogDocs">
                  Open app catalog docs
                </Trans>
              </a>
            </>
          ) : selectedExchangeSetup === "exchange-online" ? (
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
          ) : (
            <>
              <a
                href={EXCHANGE_ADDIN_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="office-setup-button office-setup-button--secondary"
              >
                <Trans id="officeAddin.setup.openExchangeAddinDocs">
                  Open Exchange add-in docs
                </Trans>
              </a>
              <a
                href={EXCHANGE_LIMIT_ACCESS_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="office-setup-button office-setup-button--secondary"
              >
                <Trans id="officeAddin.setup.openExchangeAccessDocs">
                  Limit user access
                </Trans>
              </a>
            </>
          )}
        </div>

        {error ? (
          <p className="office-status office-status--error">{error}</p>
        ) : null}

        <label
          className="office-setup-preview-label"
          htmlFor="manifest-preview"
        >
          {selectedProduct === "teams" ? (
            <Trans id="officeAddin.teams.setup.manifestPreview">
              Teams manifest preview (JSON)
            </Trans>
          ) : (
            <Trans id="officeAddin.setup.manifestPreview">
              Manifest preview
            </Trans>
          )}
        </label>
        <textarea
          id="manifest-preview"
          className="office-setup-preview"
          readOnly
          onCopy={(event) => {
            if (selectedProduct === "teams") event.preventDefault();
          }}
          value={
            isLoading
              ? t({
                  id: "officeAddin.setup.loadingManifest",
                  message: "Loading manifest...",
                })
              : selectedProduct === "teams"
                ? manifestJson
                : manifestXml
          }
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function SetupSelectors({
  selectedExchangeSetup,
  selectedProduct,
  onSelectExchangeSetup,
  onSelectProduct,
}: {
  selectedExchangeSetup: ExchangeSetup;
  selectedProduct: OfficeProduct;
  onSelectExchangeSetup: (setup: ExchangeSetup) => void;
  onSelectProduct: (product: OfficeProduct) => void;
}) {
  const comingSoonLabel = t({
    id: "officeAddin.setup.comingSoon",
    message: "Coming soon",
  });

  return (
    <div className="office-setup-selectors">
      <div className="office-setup-selector-row">
        <div className="office-setup-selector-label">
          <Trans id="officeAddin.setup.productSelectorLabel">Product</Trans>
        </div>
        <div className="office-setup-selector-options">
          {PRODUCT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-disabled={!option.selectable}
              aria-pressed={selectedProduct === option.id}
              className="office-setup-selector-option"
              title={option.selectable ? undefined : comingSoonLabel}
              onClick={() => {
                if (option.selectable) {
                  onSelectProduct(option.id);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {selectedProduct === "outlook" ? (
        <div className="office-setup-selector-row">
          <div className="office-setup-selector-label">
            <Trans id="officeAddin.setup.exchangeSelectorLabel">
              Exchange setup
            </Trans>
          </div>
          <div className="office-setup-selector-options">
            {EXCHANGE_SETUP_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={selectedExchangeSetup === option.id}
                className="office-setup-selector-option"
                onClick={() => onSelectExchangeSetup(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WordInstructions({ spaRedirectUri }: { spaRedirectUri: string }) {
  return (
    <ol className="office-setup-steps">
      <li>
        <Trans id="officeAddin.word.setup.redirectUriInstruction">
          In the Entra ID app registration, add the SPA redirect URI. Word on
          the web will not sign in without it:
        </Trans>
        <CopyableCodeField content={spaRedirectUri} />
      </li>
      <li>
        <Trans id="officeAddin.word.setup.reviewManifest">
          Review the generated document manifest XML below. It is a separate
          add-in from the Outlook one and carries its own id.
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.word.setup.downloadManifest">
          Download it as <code>manifest-document.xml</code>.
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.word.setup.integratedAppsRoute">
          If your users have Exchange Online mailboxes <em>and</em> a
          subscription Office licence, upload it in{" "}
          <a
            href={INTEGRATED_APPS_URL}
            target="_blank"
            rel="noreferrer"
            className="office-setup-link"
          >
            Integrated Apps
          </a>
          .
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.word.setup.catalogRoute">
          For every other combination, upload it to a{" "}
          <a
            href={SHAREPOINT_CATALOG_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="office-setup-link"
          >
            SharePoint app catalog
          </a>
          . Add-ins deployed that way have no ribbon button, so users open Erato
          from the add-ins list; everything is reachable inside the pane.
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.word.setup.macUnsupported">
          Word on Mac is not supported for on-premises mailboxes: the SharePoint
          app catalog does not cover the Mac desktop client. Point those users
          at Word for the web through a SharePoint Online catalog instead.
        </Trans>
      </li>
    </ol>
  );
}

function TeamsInstructions() {
  return (
    <ol className="office-setup-steps">
      <li>
        <Trans id="officeAddin.teams.setup.uploadInstruction">
          Review the rendered Teams manifest JSON below. The package includes
          this manifest and its icons.
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.teams.setup.downloadInstruction">
          Download the ZIP, then in Microsoft 365 admin center open Settings,
          Integrated apps, and choose Upload custom apps. Select Teams app as
          the app type and upload the ZIP.
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.teams.setup.authInstruction">
          Ensure the Entra app registration has the Teams NAA broker redirect
          URI for this deployment: brk-multihub://{window.location.host}
        </Trans>
      </li>
    </ol>
  );
}

function ExchangeOnlineInstructions({
  spaRedirectUri,
}: {
  spaRedirectUri: string;
}) {
  return (
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
        <Trans id="officeAddin.setup.openIntegratedAppsInstruction">
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
        </Trans>
      </li>
    </ol>
  );
}

function ExchangeServerInstructions() {
  return (
    <ol className="office-setup-steps">
      <li>
        <Trans id="officeAddin.setup.exchangeServer.reviewManifest">
          Review the generated Exchange Server manifest XML below.
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.setup.exchangeServer.downloadManifest">
          Download it as <code>manifest.xml</code>.
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.setup.exchangeServer.installInstruction">
          In Exchange admin center, go to organization add-ins, add a custom
          add-in from file, and upload the downloaded manifest. You can also
          install it with Exchange Management Shell.
        </Trans>
      </li>
      <li>
        <Trans id="officeAddin.setup.exchangeServer.docsInstruction">
          Follow Microsoft&apos;s{" "}
          <a
            href={EXCHANGE_ADDIN_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="office-setup-link"
          >
            Exchange add-in installation guide
          </a>
          . To limit availability to specific users, use the{" "}
          <a
            href={EXCHANGE_LIMIT_ACCESS_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="office-setup-link"
          >
            Exchange Management Shell access controls
          </a>
          .
        </Trans>
      </li>
    </ol>
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
