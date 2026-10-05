import { I18nProvider } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";

import {
  TEAMS_BOT_MESSAGES_PATH,
  createTeamsSetupCommand,
  teamsHelperRelease,
  teamsHelperSource,
  validBotName,
  validGuid,
  proposedSsoResource,
  readTeamsBotSetup,
  readTeamsBotSetupInfo,
  validConnectionName,
  validResourceGroupName,
} from "./teamsBotSetup";

import type { TeamsBotSetup, TeamsBotSetupInfo } from "./teamsBotSetup";

const INTEGRATED_APPS_URL =
  "https://admin.cloud.microsoft/?#/Settings/IntegratedApps";
const EXCHANGE_ADDIN_DOCS_URL =
  "https://learn.microsoft.com/en-us/exchange/install-or-remove-outlook-add-ins-2013-help";
const EXCHANGE_LIMIT_ACCESS_DOCS_URL =
  "https://learn.microsoft.com/en-us/exchange/manage-user-access-to-add-ins-2013-help#use-the-exchange-management-shell-to-limit-add-in-availability-to-specific-users";
const SHAREPOINT_CATALOG_DOCS_URL =
  "https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-task-pane-and-content-add-ins-to-an-add-in-catalog";
const TEAMS_BOT_DOCS_URL = "https://erato.chat/docs/integrations/ms_teams";

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
  const [teamsBot, setTeamsBot] = useState<TeamsBotSetup | null>(null);
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
        setTeamsBot(null);

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
          const parsed: unknown = JSON.parse(manifest);
          setManifestJson(JSON.stringify(parsed, null, 2));
          setTeamsBot(readTeamsBotSetup(parsed));
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
          <TeamsInstructions bot={teamsBot} />
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

function TeamsInstructions({ bot }: { bot: TeamsBotSetup | null }) {
  return (
    <>
      <TeamsAppInstructions />
      {bot ? <TeamsBotInstructions bot={bot} /> : null}
    </>
  );
}

function TeamsAppInstructions() {
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

function useTeamsBotSetupInfo() {
  const [info, setInfo] = useState<TeamsBotSetupInfo | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsRefreshing(true);
    try {
      const response = await window.fetch(
        new URL("teams/bot-setup.json", window.location.href).toString(),
        { signal, cache: "no-store" },
      );
      // Older deployments have no setup endpoint: keep the manual inputs.
      const next = response.ok
        ? readTeamsBotSetupInfo(JSON.parse(await response.text()))
        : null;
      if (!signal?.aborted) setInfo(next);
    } catch {
      if (!signal?.aborted) setInfo(null);
    } finally {
      if (!signal?.aborted) setIsRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const abortController = new AbortController();
    void refresh(abortController.signal);
    return () => abortController.abort();
  }, [refresh]);
  return { info, isRefreshing, refresh };
}

function TeamsBotInstructions({ bot }: { bot: TeamsBotSetup }) {
  const { info, isRefreshing, refresh } = useTeamsBotSetupInfo();
  const [showScript, setShowScript] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [resourceGroup, setResourceGroup] = useState("");
  const [botName, setBotName] = useState("");
  const [currentConnection, setCurrentConnection] = useState("graph");
  const [ssoConnection, setSsoConnection] = useState("graph-sso");
  // Prefill what the deployment already knows, without overwriting edits.
  useEffect(() => {
    if (!info) return;
    setTenantId((value) => value || info.tenantId);
    setSsoConnection((value) =>
      value === "graph-sso" ? info.connectionName : value,
    );
  }, [info]);
  const messagingEndpoint =
    info?.messagingEndpoint ?? window.location.origin + TEAMS_BOT_MESSAGES_PATH;
  const validNames =
    validConnectionName(currentConnection) &&
    validConnectionName(ssoConnection);
  const separateConnection =
    currentConnection.toLowerCase() !== ssoConnection.toLowerCase();
  const validIdentity =
    !!bot.authAppId && validGuid(bot.authAppId) && validGuid(bot.botId);
  const botTargetEntered = !!resourceGroup || !!botName;
  const validBotTarget =
    !botTargetEntered ||
    (validResourceGroupName(resourceGroup) && validBotName(botName));
  const ready =
    validIdentity &&
    validGuid(tenantId) &&
    validGuid(subscriptionId) &&
    validNames &&
    validBotTarget;
  const ssoResource = proposedSsoResource(bot, window.location.origin);
  // Erato derives these values itself; only a different choice here needs a
  // configuration change on the Erato side.
  const eratoSettingsDiffer =
    !info ||
    info.connectionName !== ssoConnection ||
    (info.ssoResource !== null && info.ssoResource !== ssoResource);
  const config = `# Merge into [integrations.ms_office.teams.bot]
oauth_connection_name = ${JSON.stringify(ssoConnection)}
sso_app_id = ${JSON.stringify(bot.authAppId ?? "<authentication app ID>")}
sso_resource = ${JSON.stringify(ssoResource)}`;
  const command = (mode: "check" | "preview" | "apply") =>
    ready && (mode === "check" || separateConnection)
      ? createTeamsSetupCommand(
          bot,
          window.location.origin,
          tenantId,
          subscriptionId,
          currentConnection,
          ssoConnection,
          mode,
          {
            // Validated when read; otherwise the helper derives it from BaseUrl.
            messagingEndpoint: info?.messagingEndpoint,
            ...(botTargetEntered ? { resourceGroup, botName } : {}),
          },
        )
      : "";

  return (
    <section className="office-setup-section">
      <h2 className="office-setup-subtitle">
        <Trans id="officeAddin.teams.bot.setup.title">Teams bot</Trans>
      </h2>
      <p className="office-setup-copy">
        <Trans id="officeAddin.teams.bot.setup.guidedIntro">
          Set up the bot with your own admin account in Azure Cloud Shell. One
          command creates or updates the Azure Bot, its Teams channel, single
          sign-on and the OAuth connection. Erato needs no further changes.
        </Trans>
      </p>
      <p className="office-setup-copy">
        <Trans id="officeAddin.teams.bot.setup.cloudStatus">
          Azure settings have not been checked. The first command checks them
          without making changes.
        </Trans>
      </p>
      {!validIdentity && (
        <p role="alert">
          <Trans id="officeAddin.teams.bot.setup.invalidIdentity">
            This Teams package is missing valid application IDs. Ask your Erato
            administrator to configure the bot and add-in authentication first.
          </Trans>
        </p>
      )}
      <TeamsBotPrerequisites
        messagingEndpoint={messagingEndpoint}
        configured={info?.messagingEndpointConfigured ?? false}
      />
      <ol className="office-setup-steps">
        <li>
          <strong>
            <Trans id="officeAddin.teams.bot.setup.targetTitle">
              Choose the Azure tenant and subscription
            </Trans>
          </strong>
          <p>
            <Trans id="officeAddin.teams.bot.setup.tenantSubscriptionHelp">
              The tenant is this deployment’s Microsoft 365 tenant. Find the
              subscription ID on the subscription’s Overview page in Azure
              Portal.
            </Trans>
          </p>
          <div className="office-setup-targets">
            <label className="office-setup-field" htmlFor="teams-tenant-id">
              <Trans id="officeAddin.teams.bot.setup.tenantId">Tenant ID</Trans>
              <input
                id="teams-tenant-id"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value.trim())}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!tenantId && !validGuid(tenantId)}
              />
            </label>
            <label
              className="office-setup-field"
              htmlFor="teams-subscription-id"
            >
              <Trans id="officeAddin.teams.bot.setup.subscriptionId">
                Subscription ID
              </Trans>
              <input
                id="teams-subscription-id"
                value={subscriptionId}
                onChange={(event) =>
                  setSubscriptionId(event.target.value.trim())
                }
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!subscriptionId && !validGuid(subscriptionId)}
              />
            </label>
          </div>
          {((tenantId && !validGuid(tenantId)) ||
            (subscriptionId && !validGuid(subscriptionId))) && (
            <p role="alert">
              <Trans id="officeAddin.teams.bot.setup.invalidTarget">
                Enter complete IDs in the form
                xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.
              </Trans>
            </p>
          )}
          <p>
            <Trans id="officeAddin.teams.bot.setup.botTargetHelp">
              To create the Azure Bot, enter an existing resource group and a
              name for the new bot. Leave both empty if a bot for this
              deployment already exists in the subscription.
            </Trans>
          </p>
          <div className="office-setup-targets">
            <label
              className="office-setup-field"
              htmlFor="teams-resource-group"
            >
              <Trans id="officeAddin.teams.bot.setup.resourceGroup">
                Resource group
              </Trans>
              <input
                id="teams-resource-group"
                value={resourceGroup}
                onChange={(event) =>
                  setResourceGroup(event.target.value.trim())
                }
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!validBotTarget}
              />
            </label>
            <label className="office-setup-field" htmlFor="teams-bot-name">
              <Trans id="officeAddin.teams.bot.setup.botName">Bot name</Trans>
              <input
                id="teams-bot-name"
                value={botName}
                onChange={(event) => setBotName(event.target.value.trim())}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!validBotTarget}
              />
            </label>
          </div>
          {!validBotTarget && (
            <p role="alert">
              <Trans id="officeAddin.teams.bot.setup.invalidBotTarget">
                Enter both a resource group and a bot name. Bot names use 2–63
                letters, digits, dots, hyphens or underscores.
              </Trans>
            </p>
          )}
          <details className="office-setup-helper">
            <summary>
              <Trans id="officeAddin.teams.bot.setup.permissionsTitle">
                Permissions and changes to review
              </Trans>
            </summary>
            <p>
              <Trans id="officeAddin.teams.bot.setup.guidedPermissionsHelp">
                Checking requires read access to the subscription’s Azure Bots,
                the Entra app and consent records. Applying requires permission
                to create or update the Azure Bot in the resource group, to
                update the app and add a credential, and, for tenant-wide
                consent, the Cloud Application Administrator role.
              </Trans>
            </p>
            <p>
              <Trans id="officeAddin.teams.bot.setup.guidedChangesHelp">
                Setup creates a free single-tenant Azure Bot for the existing
                app registration, or updates the endpoint and Teams channel of
                the existing one. It extends the app with Teams SSO settings and
                delegated Microsoft Graph permissions, creates a separate OAuth
                connection with a dedicated credential valid for up to one year,
                and grants tenant-wide consent. Existing bot identity,
                redirects, permissions and credentials are preserved.
              </Trans>
            </p>
            <p>
              <Trans id="officeAddin.teams.bot.setup.dataPermissions">
                The delegated permissions cover the signed-in user’s profile,
                group membership, files, sites, chats and channel messages.
                Review the exact permissions in the preview before applying.
              </Trans>
            </p>
            <p>
              <Trans id="officeAddin.teams.bot.setup.cloudSupport">
                The helper supports public Azure and the global Bot Framework
                token service.
              </Trans>
            </p>
          </details>
          <details className="office-setup-helper">
            <summary>
              <Trans id="officeAddin.teams.bot.setup.deploymentDetails">
                Deployment details and connection names
              </Trans>
            </summary>
            <p>{window.location.origin}</p>
            <p>
              <Trans id="officeAddin.teams.bot.setup.botIdentity">
                Bot messaging app
              </Trans>
            </p>
            <CopyableCodeField content={bot.botId} />
            <p>
              <Trans id="officeAddin.teams.bot.setup.authenticationIdentity">
                Existing authentication app
              </Trans>
            </p>
            <CopyableCodeField content={bot.authAppId ?? ""} />
            <p>
              <Trans id="officeAddin.teams.bot.setup.resourceLabel">
                Application ID URI to configure
              </Trans>
            </p>
            <CopyableCodeField content={ssoResource} />
            <label
              className="office-setup-field"
              htmlFor="teams-current-connection"
            >
              <Trans id="officeAddin.teams.bot.setup.currentConnectionName">
                Current OAuth connection name
              </Trans>
              <input
                id="teams-current-connection"
                value={currentConnection}
                onChange={(event) => setCurrentConnection(event.target.value)}
                maxLength={64}
                spellCheck={false}
              />
            </label>
            <label
              className="office-setup-field"
              htmlFor="teams-sso-connection"
            >
              <Trans id="officeAddin.teams.bot.setup.ssoConnectionName">
                SSO connection name
              </Trans>
              <input
                id="teams-sso-connection"
                value={ssoConnection}
                onChange={(event) => setSsoConnection(event.target.value)}
                maxLength={64}
                spellCheck={false}
              />
            </label>
            <p>
              <Trans id="officeAddin.teams.bot.setup.guidedConnectionHelp">
                The SSO connection name is the one this Erato deployment uses.
                Only an existing bot set up before may have a current connection
                to preserve; check its name in Azure Bot Configuration.
              </Trans>
            </p>
          </details>
          {!validNames && (
            <p role="alert">
              <Trans id="officeAddin.teams.bot.setup.invalidConnections">
                Use connection names with 1–64 letters, digits, underscores or
                hyphens.
              </Trans>
            </p>
          )}
          {validNames && !separateConnection && (
            <p role="status">
              <Trans id="officeAddin.teams.bot.setup.currentConnectionCheck">
                The check can use the current connection. Choose a different
                name to preview or apply a new SSO setup.
              </Trans>
            </p>
          )}
        </li>
        <li>
          <strong>
            <Trans id="officeAddin.teams.bot.setup.checkTitle">
              Open Cloud Shell and check setup
            </Trans>
          </strong>
          <p>
            <Trans id="officeAddin.teams.bot.setup.checkHelp">
              Choose PowerShell in Cloud Shell and sign in to the tenant above.
              Copy the command, paste it into Cloud Shell and press Enter. It
              downloads a fixed version from Erato, verifies its SHA-256
              checksum and runs a read-only check.
            </Trans>
          </p>
          <div className="office-setup-actions">
            <a
              href="https://shell.azure.com/powershell"
              target="_blank"
              rel="noreferrer"
              className="office-setup-button office-setup-button--secondary"
            >
              <Trans id="officeAddin.teams.bot.setup.openCloudShell">
                Open Azure Cloud Shell
              </Trans>
            </a>
            <button
              type="button"
              onClick={() => setShowScript(!showScript)}
              aria-expanded={showScript}
              aria-controls="teams-helper-source"
              className="office-setup-button office-setup-button--secondary"
            >
              <Trans id="officeAddin.teams.bot.setup.viewScript">
                View script
              </Trans>
            </button>
          </div>
          {showScript && (
            <div id="teams-helper-source">
              <p>
                SHA-256:{" "}
                <code className="office-setup-checksum">
                  {teamsHelperRelease.sha256}
                </code>
              </p>
              <textarea
                className="office-setup-command-preview"
                aria-label={t({
                  id: "officeAddin.teams.bot.setup.sourceLabel",
                  message: "PowerShell source",
                })}
                readOnly
                value={teamsHelperSource}
                rows={16}
                spellCheck={false}
              />
            </div>
          )}
          <TeamsSetupCommand
            primary
            command={command("check")}
            label={t({
              id: "officeAddin.teams.bot.setup.copyCommand",
              message: "Copy command",
            })}
          />
          <p className="office-setup-copy">
            <Trans id="officeAddin.teams.bot.setup.helperVersion">
              PowerShell helper version {teamsHelperRelease.version}. No local
              installation or file upload is needed.
            </Trans>
          </p>
          {(!validGuid(tenantId) || !validGuid(subscriptionId)) && (
            <p>
              <Trans id="officeAddin.teams.bot.setup.enterTarget">
                Enter valid tenant and subscription IDs above to enable the
                commands.
              </Trans>
            </p>
          )}
        </li>
        <li>
          <strong>
            <Trans id="officeAddin.teams.bot.setup.reviewTitle">
              Review the results and apply when ready
            </Trans>
          </strong>
          <p>
            <Trans id="officeAddin.teams.bot.setup.resultsHelp">
              PASS means the Azure setting is present. MISSING means setup is
              still needed. If the check stops because access is denied or the
              tenant is wrong, resolve that first.
            </Trans>
          </p>
          <details className="office-setup-helper">
            <summary>
              <Trans id="officeAddin.teams.bot.setup.previewApplyTitle">
                Preview and apply changes
              </Trans>
            </summary>
            <p>
              <Trans id="officeAddin.teams.bot.setup.previewHelp">
                Preview the exact proposed changes. This command uses -WhatIf
                and does not change Azure.
              </Trans>
            </p>
            <TeamsSetupCommand
              command={command("preview")}
              label={t({
                id: "officeAddin.teams.bot.setup.copyPreview",
                message: "Copy preview command",
              })}
            />
            <p>
              <Trans id="officeAddin.teams.bot.setup.applyHelp">
                After reviewing the preview, run the apply command. Cloud Shell
                will show the target and changes and ask for confirmation before
                making them.
              </Trans>
            </p>
            <TeamsSetupCommand
              command={command("apply")}
              label={t({
                id: "officeAddin.teams.bot.setup.copyApply",
                message: "Copy apply command",
              })}
            />
            <p>
              <Trans id="officeAddin.teams.bot.setup.applyResult">
                The helper reports applied changes and remaining steps. Record
                the credential expiry for renewal. If it stops after a partial
                change, inspect the reported state before retrying.
              </Trans>
            </p>
          </details>
        </li>
        <li>
          <strong>
            <Trans id="officeAddin.teams.bot.setup.uploadTitle">
              Upload the Teams package and test
            </Trans>
          </strong>
          <p>
            <Trans id="officeAddin.teams.bot.setup.uploadHelp">
              Download the Teams package below and upload it in the Teams admin
              center, as an update if the Erato app is already installed.
              Install or pin it with an app setup policy so people need not
              accept the update. Then send the bot a message in Teams.
            </Trans>
          </p>
          {info && (
            <TeamsBotStatus
              info={info}
              isRefreshing={isRefreshing}
              onRefresh={() => void refresh()}
            />
          )}
          {eratoSettingsDiffer && (
            <details className="office-setup-helper">
              <summary>
                <Trans id="officeAddin.teams.bot.setup.deploymentSettings">
                  Settings for your Erato administrator
                </Trans>
              </summary>
              <p>
                <Trans id="officeAddin.teams.bot.setup.settingsDifferHelp">
                  Erato uses different values than the ones chosen here. Before
                  testing, your Erato administrator must apply these settings
                  and deploy.
                </Trans>
              </p>
              <CopyableCodeField content={config} />
            </details>
          )}
          <p>
            <Trans id="officeAddin.teams.bot.setup.finalCheck">
              Test a personal bot chat in Teams desktop and web, then the Teams
              tab and other Office add-ins. Azure checks alone do not verify the
              installed Teams package or successful sign-in. Tenant consent and
              Conditional Access can still require interaction.
            </Trans>
          </p>
        </li>
      </ol>
      <p className="office-setup-copy">
        <a
          href={TEAMS_BOT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="office-setup-link"
        >
          <Trans id="officeAddin.teams.bot.setup.manualGuide">
            Manual setup and troubleshooting guide
          </Trans>
        </a>
      </p>
    </section>
  );
}

function TeamsBotPrerequisites({
  messagingEndpoint,
  configured,
}: {
  messagingEndpoint: string;
  configured: boolean;
}) {
  return (
    <div className="office-setup-prerequisites">
      <h3 className="office-setup-subtitle">
        <Trans id="officeAddin.teams.bot.setup.prerequisitesTitle">
          Before you start
        </Trans>
      </h3>
      <ul>
        <li>
          <Trans id="officeAddin.teams.bot.setup.publicEndpoint">
            Microsoft’s cloud delivers every Teams message to the messaging
            endpoint below, so it must be reachable from the internet over HTTPS
            with a certificate from a publicly trusted CA. For an internal-only
            deployment, publish only this path, for example through a reverse
            proxy, a web application firewall or Azure Application Gateway.
            Erato verifies Microsoft’s signature on every message.
          </Trans>
          <CopyableCodeField content={messagingEndpoint} />
          {!configured && (
            <p>
              <Trans id="officeAddin.teams.bot.setup.endpointFromPage">
                This is the address this page was opened at. If Azure cannot
                reach it, ask your Erato administrator to configure the public
                messaging endpoint.
              </Trans>
            </p>
          )}
        </li>
        <li>
          <Trans id="officeAddin.teams.bot.setup.adminRoles">
            Admin roles: permission to create resources in the bot’s resource
            group (and to register the Microsoft.BotService provider if the
            subscription never used it), Cloud Application Administrator for the
            app registration and consent, and Teams Administrator for the
            package upload.
          </Trans>
        </li>
        <li>
          <Trans id="officeAddin.teams.bot.setup.outboundAccess">
            Outbound HTTPS from Erato to login.microsoftonline.com,
            login.botframework.com, *.botframework.com and
            smba.trafficmanager.net.
          </Trans>
        </li>
      </ul>
    </div>
  );
}

function TeamsBotStatus({
  info,
  isRefreshing,
  onRefresh,
}: {
  info: TeamsBotSetupInfo;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const { activityReceived, credential } = info.status;
  return (
    <div className="office-setup-bot-status" aria-live="polite">
      <strong>
        <Trans id="officeAddin.teams.bot.setup.statusTitle">
          What Erato has seen since its last start
        </Trans>
      </strong>
      <ul>
        <li>
          {activityReceived ? (
            <Trans id="officeAddin.teams.bot.setup.statusReceived">
              A Teams message from this tenant arrived.
            </Trans>
          ) : (
            <Trans id="officeAddin.teams.bot.setup.statusNotReceived">
              No Teams message has arrived yet. Check the messaging endpoint and
              the Teams channel if a message was sent.
            </Trans>
          )}
        </li>
        <li>
          {credential === "accepted" ? (
            <Trans id="officeAddin.teams.bot.setup.statusCredentialAccepted">
              Entra accepted Erato’s bot credential.
            </Trans>
          ) : credential === "rejected" ? (
            <Trans id="officeAddin.teams.bot.setup.statusCredentialRejected">
              Entra rejected Erato’s bot credential. Ask your Erato
              administrator to check the bot’s app password.
            </Trans>
          ) : (
            <Trans id="officeAddin.teams.bot.setup.statusCredentialUnknown">
              Erato has not replied yet, so its bot credential is untested.
            </Trans>
          )}
        </li>
      </ul>
      <button
        type="button"
        className="office-setup-button office-setup-button--secondary"
        disabled={isRefreshing}
        onClick={onRefresh}
      >
        <Trans id="officeAddin.teams.bot.setup.refreshStatus">
          Refresh status
        </Trans>
      </button>
    </div>
  );
}

function TeamsSetupCommand({
  command,
  label,
  primary = false,
}: {
  command: string;
  label: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [command]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }
  return (
    <div className="office-setup-command">
      <button
        type="button"
        className={`office-setup-button${primary ? "" : " office-setup-button--secondary"}`}
        disabled={!command}
        onClick={() => void copy()}
      >
        {copied
          ? t({ id: "officeAddin.setup.copied", message: "Copied!" })
          : label}
      </button>
      {command && (
        <details className="office-setup-helper" open={copyFailed || undefined}>
          <summary>
            <Trans id="officeAddin.teams.bot.setup.viewCommand">
              View command
            </Trans>
          </summary>
          <textarea
            className="office-setup-command-preview"
            readOnly
            value={command}
            aria-label={label}
            rows={12}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
      )}
      {copyFailed && (
        <p role="status">
          <Trans id="officeAddin.teams.bot.setup.clipboardHelp">
            Clipboard access is unavailable. Select and copy the command above.
          </Trans>
        </p>
      )}
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
