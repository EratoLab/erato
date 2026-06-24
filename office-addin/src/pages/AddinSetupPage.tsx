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

type OfficeProduct = "outlook" | "excel" | "powerpoint";
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
  { id: "excel", label: "Excel", selectable: false },
  { id: "powerpoint", label: "PowerPoint", selectable: false },
];

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

function getManifestUrl(exchangeSetup: ExchangeSetup): string {
  const selectedSetup =
    EXCHANGE_SETUP_OPTIONS.find((option) => option.id === exchangeSetup) ??
    EXCHANGE_SETUP_OPTIONS[0];
  return new URL(selectedSetup.manifestPath, window.location.href).toString();
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
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const spaRedirectUri = getSpaRedirectUri();

  useEffect(() => {
    const abortController = new AbortController();

    async function loadManifest() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await window.fetch(
          getManifestUrl(selectedExchangeSetup),
          {
            signal: abortController.signal,
          },
        );

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
  }, [selectedExchangeSetup]);

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
            {selectedExchangeSetup === "exchange-online" ? (
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

        {selectedExchangeSetup === "exchange-online" ? (
          <ExchangeOnlineInstructions spaRedirectUri={spaRedirectUri} />
        ) : (
          <ExchangeServerInstructions />
        )}

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
          {selectedExchangeSetup === "exchange-online" ? (
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
