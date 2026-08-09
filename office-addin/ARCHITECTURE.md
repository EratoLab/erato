# Office add-in architecture

One host-neutral core drives the whole add-in chat experience; each Microsoft
host (Outlook and Teams today; Word, Excel, PowerPoint later) is a thin
composition root that injects host behavior through a fixed set of seams.
Adding a host is meant to be mechanical: compose the core with host providers,
implement the seams listed below, and never modify the core itself.

## Layers

- `src/core` — host-neutral and self-contained. An eslint zones fence bans
  every import that escapes it (see Boundary enforcement). `core/auth` holds
  the neutral auth contract (`AuthSource.ts`: `AuthSource`, `BootstrapToken`,
  `InteractionRequiredError`) plus the oauth2-proxy session logic
  (`oauth2ProxySession.ts`).
- `src/outlook` — the Outlook composition: `OutlookApp.tsx` (root),
  `OutlookAddinSessionController.tsx`, `OutlookAddinChat.tsx` (the Outlook
  chat host), `installOutlookComponentRegistrations.ts`, and all Outlook-only
  code in `components/`, `hooks/`, `providers/`, `utils/`, `sessionPolicy/`.
- `src/teams` — the Teams personal tab composition, a peer of `src/outlook`:
  `TeamsApp.tsx` (root, served at `/office-addin/teams`), `teamsSession.ts`,
  `providers/` (the TeamsJS lifecycle, theme and auth roots) and
  `auth/isTeamsNestedAppAuthSupported.ts`. `@microsoft/teams-js` is imported
  here and nowhere else.
- The shared Office.js ring — stays in `src/providers`, `src/hooks`,
  `src/utils`: `OfficeProvider`, `OfficeThemeProvider`, `useOfficeTheme`,
  `utils/officeTheme/`, `officeAsync.ts`, the drag-drop broker
  (`officeDragAndDropBroker.ts` + `useOfficeDragAndDrop.ts`), and
  `detectExchangeOnPrem.ts`. This ring is office.js-generic and is planned to
  become `src/office` when the second Office.js host (Word/Excel) arrives.
  `detectExchangeOnPrem` is mailbox-flavored; at that point it should be
  injected into `OfficeProvider` rather than imported by it.
- `src/auth` — the MSAL/NAA auth sources (`entraAuthSource.ts`,
  `EntraNaaAuthSource.ts`, `isNestedAppAuthSupported.ts`,
  `UnsupportedAuthSource.ts`), consumed by host auth roots.

## The six host seams

1. **Host component slot** — `AddinChatCore` (`src/core/AddinChatCore.tsx`)
   takes `Host?: ComponentType<AddinChatHostProps>`. The host component
   receives the full `AddinChatController` and typically renders
   `AddinChatCoreView` around host UI. Default: a built-in neutral host.
2. **Session controller strategy** — `AddinChatProviderCore`
   (`src/core/AddinChatProviderCore.tsx`) takes
   `SessionController?: ComponentType<AddinSessionControllerProps>`, which
   yields an `AddinSessionController`. The default
   `NeutralAddinSessionController` has no anchor policy and persists under
   isolated storage (`erato.addin.neutral.currentChat.v1`). Outlook supplies
   `OutlookAddinSessionController` (mail-item anchor + session policy); Teams
   supplies `createNeutralAddinSessionController` bound to
   `erato.addin.teams.currentChat.v1`, so its selection is independent of both.
3. **Auth** — a host auth provider mounts `SessionAuthProvider`
   (`src/core/SessionAuthProvider.tsx`) with an `AuthSource`; `AuthGate` reads
   only the `SessionAuthCore` fields. The NAA source
   (`createEntraNaaAuthSource`) is host-portable: Outlook injects a
   mailbox-aware `LoginHintResolver`, other hosts inject a mailbox-less one.
4. **Settings contribution** — `AddinSettingsDialogCore`
   (`src/core/AddinSettingsDialogCore.tsx`) takes
   `hostContribution?: AddinSettingsHostContribution` (tab label, heading,
   description, content, optional system description and appearance notice).
   No contribution means no host tab.
5. **Component registry** — hosts assign `componentRegistry` overrides at
   host-module eval: `src/outlook/OutlookApp.tsx` calls
   `installOutlookComponentRegistrations()` at module scope, before React
   renders. The registry is a mutable global, so exactly one host per loaded
   document — contributions stay route-local because only the matched lazy
   route module is evaluated. Teams installs none. Component-kit registrations
   are re-applied at the entry point via `applyComponentKitRegistrations()` in
   `src/main.tsx`.
6. **Platform identifier** — stamped explicitly per host, never inferred from
   a host SDK: the `platform` prop on `AddinChatProviderCore` flows into
   messaging and is sent as the `X-Erato-Platform` request header. Values:
   `web` (shared-frontend default), `outlook`, `teams`, `addin-neutral`
   (`NeutralAddinChatPage` default), future `word`/`excel`.

## Boundary enforcement (`eslint.config.mjs`)

- Core fence — an `import/no-restricted-paths` zone: `src/core/**` may not
  import anything under `src/` outside `./core`. Backed by
  `no-restricted-globals` for `Office`/`OfficeRuntime` and a name-based
  `no-restricted-imports` denylist (`**/OfficeProvider`, `**/Outlook*`,
  `**/outlook/**`, `**/sessionPolicy/**`, `**/useOutlook*`, `**/Teams*`,
  `**/teams/**`, `@microsoft/teams-js`).
- Host peer fence — `src/outlook/**` and `src/teams/**` may not import each
  other: one host SDK and one set of registry overrides per document. The
  Teams block also carries the `Office`/`OfficeRuntime` global ban.
- Residue-ring guard — `src/hooks`, `src/providers`, `src/utils`, `src/auth`
  may not import `**/outlook/**` or `**/teams/**` (test mocks excepted):
  shared code must not depend on a host module; move it out or invert the
  dependency.
- Characterization tests —
  `src/core/__tests__/NeutralAddinChatPage.test.tsx` renders the full neutral
  page with the `Office` global deleted and asserts no office.js CDN script
  (`appsforoffice.microsoft.com`) is appended;
  `src/teams/__tests__/TeamsApp.test.tsx` makes the same assertions for the
  Teams route and pins its storage key, registry emptiness and MSAL ordering;
  `src/core/__tests__/AddinSettingsDialogCore.test.tsx` asserts the settings
  core shows no host tab without a contribution.

## Feature config

`FeatureConfigProvider` nesting REPLACES: a nested provider rebuilds its
config from the environment and never reads the parent provider. Hosts that
need overrides must spread `SHARED_ADDIN_FEATURE_CONFIG` (exported from
`src/core/SharedAddinShell.tsx`) into their own provider — see
`OutlookFeatureConfig` in `src/outlook/OutlookApp.tsx`. Never add host- or
feature-specific overrides inline in `SharedAddinShell`.

## Conventions

- Storage keys — new keys use `erato.addin.<host>.*` (e.g.
  `erato.addin.neutral.currentChat.v1`). Existing `erato.outlookAddin.*` and
  `erato.officeAddin.*` keys stay as-is; renaming discards user state.
- Lingui ids — ids are stable contracts (translations and component kits key
  on them). When host copy diverges, split ids per host
  (`officeAddin.settings.appearance.system.description.neutral` vs
  `….outlook`) rather than mutating a shared id.

## Landmines

- office.js nullifies `history.pushState`/`replaceState` on load (office-js
  #429/#1344). The add-in therefore intentionally performs zero router
  navigation. A host route that must navigate has to keep office.js off that
  route or save/restore the history functions around SDK load.
- Only one host SDK per loaded document: host SDKs patch globals, and the
  component registry holds exactly one host's overrides.

## The Teams host

`TeamsApp.tsx` composes outside-in: `SharedAddinShell` → `TeamsProvider` →
`TeamsThemeProvider` → `TeamsAuthProvider` → `AuthGate` →
`NeutralAddinChatPage` with `platform="teams"` and the Teams session
controller. It loads no office.js, so unlike the Outlook route it is free to
use the router.

- `TeamsProvider` owns the TeamsJS lifecycle and nothing else: `app.initialize`,
  `app.getContext`, the single-slot `app.registerOnThemeChangeHandler`,
  and `app.notifySuccess`/`notifyFailure`. It gates children on the handshake,
  which is what orders TeamsJS before MSAL — MSAL reads the NAA bridge exactly
  once and otherwise degrades to a non-nested client for the life of the page,
  silently. Only the handshake is fatal; a rejected `notifySuccess` is logged,
  never surfaced, because the tab is already usable by then.
- `isTeamsNestedAppAuthSupported` reads the `nestedAppAuthBridge` TeamsJS
  installs. `src/auth/isNestedAppAuthSupported.ts` cannot be reused: it is
  Office-gated, and `Office` does not exist in a tab. `TeamsAuthProvider` probes
  it per source rebuild rather than caching a verdict, so the `AuthGate` retry
  re-runs mode detection. TeamsJS skips its default bridge injection in a nested
  iframe, so the absent-bridge case is logged with the host identity.
- Auth is NAA-only, reusing `createEntraNaaAuthSource` and
  `SessionAuthProvider` unchanged, with the login hint from the Teams context.
  There is no Exchange or oauth2-proxy fallback on this route. The Entra app
  registration needs the SPA redirect URI `brk-multihub://<origin>` (origin
  only, no path).
- Serving: `frame-ancestors` for the Teams and Microsoft 365 hosts is emitted
  by `build_content_security_policy` in
  `backend/erato/src/frontend_environment.rs` whenever the add-in integration
  is enabled; deployments needing more origins still use
  `frontend.extra_frame_ancestors`. Emit no `X-Frame-Options` — any value a
  modern browser understands overrides the CSP and blanks the tab.
- Not shipped: production manifest distribution (`manifests/manifest.json` is
  the local unified package), Graph access, and Teams-specific chat surfaces.
