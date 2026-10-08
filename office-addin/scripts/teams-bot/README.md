# Teams bot setup helper

The customer entry point is `/office-addin/setup` → **Teams**: **Open Azure Cloud
Shell**, **Copy command**, and **View script**. The page fills the deployment's
public application IDs, tenant, connection name and messaging endpoint from
`/office-addin/teams/bot-setup.json`, and asks for the subscription and, to create
a bot, its resource group and name. It never collects credentials.

The canonical helper is `site/public/setup/teams/1.1.0/EratoTeamsSetup.ps1`.
The site publishes it at the same versioned path on `https://erato.chat`.
`release.json` pins its SHA-256 checksum. The setup page displays this exact source
inline, and every generated command checks the downloaded bytes before execution.
Customers paste the command into Cloud Shell PowerShell; they do not download a
bundle to their machine or upload files.

- Default: read-only checks of the Azure Bot, SSO configuration and consent.
- `-WhatIf`: preview every change: bot creation or endpoint/channel correction,
  Entra additions, OAuth connection creation or repair, and consent.
- `-Apply`: display the target and plan and use PowerShell confirmation before
  writes. `-Apply -WhatIf` also performs no writes.
- `-Json`: sanitized report; no token or secret values.
- `-SkipConsent`: leave tenant-wide consent to a separate process; the report
  links the admin consent page.

Version 1.1.0 finds the Azure Bot for `BotAppId` or, with `-ResourceGroup` and
`-BotName`, creates it: single-tenant with the existing app registration, Free
(F0), `global`, registering `Microsoft.BotService` first when needed. It sets the
messaging endpoint (`-MessagingEndpoint`, default `<BaseUrl>/api/integrations/ms_teams/messages`)
and enables the Teams channel on an existing bot, but never changes a bot of
another tenant, type or app registration. A failed consent grant (missing Entra
role) keeps the other changes and reports the admin consent link.

The helper supports single-tenant bots in public Azure with the global Bot
Framework token service. It preserves existing scopes, redirects, permissions,
credentials and bot identity, and refuses conflicting OAuth connections. Erato
itself needs no change afterwards; the Teams package upload remains a customer
step. Local execution requires PowerShell 7.2+ and Azure CLI; Cloud Shell is the
default.

The resource URI ends in `botid-<BotAppId>`, including when `AuthAppId` belongs
to a separate authentication registration. Version 1.0.1 corrects the previous
authentication-ID default and rejects that mismatch before contacting Azure.
For a connection configured by the old helper, it can repair only that URI when
the authentication app, tenant, provider, and required scopes already match.
The repair retains the existing credential and old Entra URIs, rechecks the
result, and makes no further changes on a second run. Other conflicts still
require administrator review.

## Validation

From the repository root:

```sh
pwsh -NoLogo -NoProfile -File office-addin/scripts/teams-bot/Test-EratoTeamsSetup.ps1
cd office-addin
pnpm exec vitest run src/pages/__tests__/teamsBotSetup.test.ts src/pages/__tests__/AddinSetupPage.test.tsx
```

The offline PowerShell tests mock Azure CLI and exercise the real request/merge
and apply logic, including private temporary request files. No account or Pester
installation is needed. The add-in tests verify command quoting, pinned bytes,
integrity failure, input validation and clipboard fallback. CI runs both suites
on an Ubuntu runner with PowerShell installed.

## Publishing

Build and publish the documentation site **before** releasing the new setup UI.
Verify the public `.ps1` URL returns the checksum in `release.json`; a missing
release or mismatch stops the command before script execution.

After publication, keep each version directory unchanged and available for older
Erato deployments. A helper update gets a new directory/version and checksum;
update the imports in `src/pages/teamsBotSetup.ts` to reference that release.
Never replace a published file in place. `.gitattributes` preserves LF endings
so the checksum is reproducible. During development, calculate the digest with
`Get-FileHash <script> -Algorithm SHA256` and update `release.json`; tests reject
a stale checksum.

Customer instructions: `site/content/docs/integrations/ms_teams.mdx`.
