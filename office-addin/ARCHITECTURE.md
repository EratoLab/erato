# Office add-in architecture

One host-neutral core drives the whole add-in chat experience; each Microsoft
host (Outlook, Teams and Word today; Excel and PowerPoint later) is a thin
composition root that injects host behavior through a fixed set of seams.
Adding a host is meant to be mechanical: compose the core with host providers,
implement the seams listed below, and never modify the core itself.

## Layers

- `src/core` — host-neutral and self-contained. An eslint zones fence bans
  every import that escapes it (see Boundary enforcement). `core/auth` holds
  the neutral auth contract (`AuthSource.ts`: `AuthSource`, `BootstrapToken`,
  `InteractionRequiredError`) plus the oauth2-proxy session logic
  (`oauth2ProxySession.ts`). `core/clientActions` holds the host-neutral
  client-action primitives — the ask/always/never decision engine with its
  per-host store factory (`clientActionPolicy.ts`), the confirm-card state
  machine and auto-prompt one-shot (`useClientActionConfirmFlow.ts`), the
  settings rows (`ClientActionsSettings.tsx`), the facet lookup
  (`useAvailableActionFacets.ts`), the `propose_client_action` proposal
  validator (`proposedClientAction.ts`) and the fresh-completion tracker. They
  are generic over the action id (`TAction extends string`); each host keeps its
  own action registry and executors and binds them in (Outlook:
  `outlook/utils/outlookClientActions.ts` + the store in
  `outlook/utils/clientActionPolicy.ts`).
- `src/outlook` — the Outlook composition: `OutlookApp.tsx` (root),
  `OutlookAddinSessionController.tsx`, `OutlookAddinChat.tsx` (the Outlook
  chat host), `installOutlookComponentRegistrations.ts`, and all Outlook-only
  code in `components/`, `hooks/`, `providers/`, `utils/`, `sessionPolicy/`.
- `src/teams` — the Teams personal tab composition, a peer of `src/outlook`:
  `TeamsApp.tsx` (root, served at `/office-addin/teams`), `teamsSession.ts`,
  `providers/` (the TeamsJS lifecycle, theme and auth roots) and
  `auth/isTeamsNestedAppAuthSupported.ts`. `@microsoft/teams-js` is imported
  here and nowhere else.
- `src/word` — the Word document task-pane composition, a peer of
  `src/outlook` and `src/teams`: `WordApp.tsx` (root, served at
  `/office-addin/word`), `wordSession.ts`,
  `providers/WordAuthProvider.tsx`, the chat composition
  (`WordAddinChatPage.tsx` → `WordAddinChat.tsx`), the composer
  (`components/WordChatInput.tsx`), the document read path
  (`utils/readWordDocument.ts`, `utils/buildWordDocumentArgs.ts`,
  `utils/wordActionFacet.ts`, `hooks/`) and the write path
  (`utils/wordClientActions.ts` — the action registry —
  `utils/wordEditPlan.ts`, `utils/wordApplyEdits.ts`,
  `utils/wordInsertText.ts`, `utils/wordWriteGate.ts`,
  `components/WordHostCardRenderer.tsx`). Unlike Teams it IS an Office.js host,
  so it consumes `OfficeProvider`, `OfficeThemeProvider` and the shared
  Office.js ring; unlike Outlook it has no mailbox.
- The shared Office.js ring — stays in `src/providers`, `src/hooks`,
  `src/utils`: `OfficeProvider`, `OfficeThemeProvider`, `useOfficeTheme`,
  `utils/officeTheme/`, `officeAsync.ts`, the drag-drop broker
  (`officeDragAndDropBroker.ts` + `useOfficeDragAndDrop.ts`), and
  `detectExchangeOnPrem.ts`. This ring is office.js-generic and is planned to
  become `src/office`. That trigger — the second Office.js host — has now
  fired with `src/word`; the rename and the injection of the mailbox-flavored
  `detectExchangeOnPrem` into `OfficeProvider` are deliberately left to their
  own ticket rather than folded into the Word work.
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
   `erato.addin.teams.currentChat.v1`, so its selection is independent of both;
   Word does the same with `erato.addin.word.currentChat.v1`.
3. **Auth** — a host auth provider mounts `SessionAuthProvider`
   (`src/core/SessionAuthProvider.tsx`) with an `AuthSource`; `AuthGate` reads
   only the `SessionAuthCore` fields. The NAA source
   (`createEntraNaaAuthSource`) is host-portable: Outlook injects a
   mailbox-aware `LoginHintResolver`, other hosts inject a mailbox-less one —
   Word's reads only `Office.auth.getAuthContext()`, with no fallback.
4. **Settings contribution** — `AddinSettingsDialogCore`
   (`src/core/AddinSettingsDialogCore.tsx`) takes
   `hostContribution?: AddinSettingsHostContribution` (tab label, heading,
   description, content, optional system description, appearance notice and
   `serversToolsEntities` — the host's rows in the Servers & Tools pane, e.g.
   Outlook's actions entity wrapping the core `ClientActionsSettings`).
   The four tab fields are optional and the host TAB is gated on `content`,
   not on the contribution existing: Word contributes only
   `serversToolsEntities` (its client-action decision rows) and therefore gets
   the shared pane with no empty "Word" tab of its own.
5. **Component registry** — hosts assign `componentRegistry` overrides at
   host-module eval: `src/outlook/OutlookApp.tsx` calls
   `installOutlookComponentRegistrations()` at module scope, before React
   renders. The registry is a mutable global, so exactly one host per loaded
   document — contributions stay route-local because only the matched lazy
   route module is evaluated. `src/teams/TeamsApp.tsx` mirrors this with
   `installTeamsComponentRegistrations()`, which contributes only
   `ChatAddMenuExtraContent`. `src/word/WordApp.tsx` mirrors it with
   `installWordComponentRegistrations()`, which contributes exactly one slot:
   the generic `HostCardCodeBlock`, inside which Word dispatches on the fence
   tag. The three hosts' slot sets are disjoint.
   Component-kit registrations are re-applied at the entry point via
   `applyComponentKitRegistrations()` in `src/main.tsx`.
6. **Platform identifier** — stamped explicitly per host, never inferred from
   a host SDK: the `platform` prop on `AddinChatProviderCore` flows into
   messaging and is sent as the `X-Erato-Platform` request header. Values:
   `web` (shared-frontend default), `outlook`, `teams`, `word`,
   `addin-neutral` (`NeutralAddinChatPage` default), future `excel`. The
   backend derives the set of KNOWN platforms from the configured
   `action_facets`, so a deployment without Word facets logs
   `warn_unknown_platform` on every Word send — the state `teams` is in today,
   not a defect.

## Boundary enforcement (`eslint.config.mjs`)

- Core fence — an `import/no-restricted-paths` zone: `src/core/**` may not
  import anything under `src/` outside `./core`. Backed by
  `no-restricted-globals` for `Office`/`OfficeRuntime` and a name-based
  `no-restricted-imports` denylist (`**/OfficeProvider`, `**/Outlook*`,
  `**/outlook/**`, `**/sessionPolicy/**`, `**/useOutlook*`, `**/Teams*`,
  `**/teams/**`, `@microsoft/teams-js`, `**/Word*`, `**/word/**`).
- Host peer fence — `src/outlook/**`, `src/teams/**` and `src/word/**` may not
  import each other: one host SDK and one set of registry overrides per
  document. The Teams block ALSO carries the `Office`/`OfficeRuntime` global
  ban and bans `**/OfficeProvider` / `**/OfficeThemeProvider` / `**/useOffice*`;
  the Word block deliberately does neither, because Word IS an Office.js host
  and consumes all three. (The global-ban message therefore names the Office.js
  host compositions generically, not Outlook.)
- Residue-ring guard — `src/hooks`, `src/providers`, `src/utils`, `src/auth`
  may not import `**/outlook/**`, `**/teams/**` or `**/word/**` (test mocks
  excepted): shared code must not depend on a host module; move it out or
  invert the dependency.
- Characterization tests —
  `src/core/__tests__/NeutralAddinChatPage.test.tsx` renders the full neutral
  page with the `Office` global deleted and asserts no office.js CDN script
  (`appsforoffice.microsoft.com`) is appended;
  `src/teams/__tests__/TeamsApp.test.tsx` makes the same assertions for the
  Teams route and pins its storage key, MSAL ordering and the exact registry
  contribution (the add-menu row, and no Outlook renderers);
  `src/word/__tests__/WordApp.test.tsx` pins the Word route's storage key,
  `platform="word"`, that `Office.onReady` is consumed before the auth source
  is built, and that it contributes nothing to the registry;
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
  Client-action decision stores are one key per host
  (`erato.addin.<host>.clientActionDecisions` for new hosts; Outlook keeps
  `erato.outlookAddin.clientActionDecisions`) — two hosts sharing a key would
  each drop the other's entries on read.
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

## The Word host

`WordApp.tsx` composes outside-in: `SharedAddinShell` → `OfficeProvider` →
`WordFeatureConfig` → `OfficeThemeProvider` → `WordAuthProvider` → `AuthGate` →
`WordAddinChatPage` (`ProfileProvider` → `FileCapabilitiesProvider` →
`AddinChatProviderCore platform="word"` → `WordAddinChat` → `AddinChatCore`
with `WordAddinChatHost`). Unlike Teams it loads office.js, so the office-js
history landmine applies: this route performs zero router navigation after
mount.

- The document read path hangs off `WordAddinChatHost`. `WordChatInput` owns
  the include-document chip (React state, keyed by `chatId`, defaulting OFF,
  never persisted — `Office.context.document.settings` would write into the
  .docx). While it is on, every send reads the main story in one `Word.run`,
  renders an ordinal-tagged head window budgeted at 61,440 UTF-8 bytes, and
  attaches `word_document_review` (or `word_compose` for an empty document) —
  but only when `GET /me/facets` advertises it, because an unknown facet id
  hard-400s the send. There is deliberately no fingerprint de-dup: prior-turn
  facet context is stripped from replayed history, so the document must ride
  every turn.
- `useWordDocumentCaptures` pairs each send's ordinal → `uniqueLocalId` map
  with the assistant message that answered it, via a pending ref promoted on a
  fresh completion. `WordWriteProvider` publishes that map, plus the pane's
  current document identity, to the registered card renderer.
- The write path is a REGISTERED client action, not a hard-wired executor.
  `utils/wordClientActions.ts` holds one map keyed by action id
  (`word.apply_edits` on `word_document_review` via the `erato-word-edits`
  fence; `word.insert_at_cursor` on `word_compose` via `erato-word-insert`),
  and membership, the display label, the offerable set, the auto-prompt scope
  and dispatch all derive from it. `buildWordArtifact()` stamps both fence
  tags into `cardFenceLanguages` — without that list the shipped frontend gate
  never fires and both fences render as plain code blocks.
- `word.apply_edits` resolves ordinals against the send-time map (never a text
  search), compares each paragraph's current text to its send-time text by
  exact equality, takes ONE `getOoxml()` snapshot only if something survives,
  and writes in descending ordinal order. Paragraphs that moved are skipped
  and reported; a single Revert restores the snapshot, once. An edit may only
  start and end on an ordinal the send rendered IN FULL (`renderedOrdinals`):
  an empty paragraph keeps its ordinal but renders no line, and the one
  paragraph a degenerate send had to cut is shown only in part — for both, the
  exact-text check compares captured text the model never saw, so it cannot
  catch a drifted ordinal and the rendered set is the gate that does. The
  snapshot is returned even when the write sync is REJECTED, because Office.js
  stops a batch at the first failed command and leaves the earlier ones
  applied; the card then arms Revert and says so. Apply and Revert
  are gated on the send-time document identity matching the pane's, failing
  closed when either is unknown — the same rule
  `core/clientActions/clientActionPolicy.ts` enforces for auto-prompt.

- Manifest: `manifests/manifest-document.xml`, a `TaskPaneApp` declaring
  `<Host Name="Document"/>` and an activation floor of `WordApi 1.7` in its
  top-level `<Requirements>` only. Below the floor the add-in does not appear,
  which is intended. Its `<VersionOverrides>` carries no `Requirements` child,
  which is part of what lets one manifest serve both delivery routes. It is a
  SECOND add-in identity: `[integrations.ms_office.addin.document]` carries its
  own `addin_id` and its own `display_name`/`description`, with every other
  manifest scalar composed from the mail block at render time.
- The manifest name is hardcoded in five places — `router.rs` (constant,
  handler, route, utoipa path), `scripts/copy-runtime-manifest.mjs`,
  `vite.config.ts`'s dev proxy, `scripts/validate-rendered-manifest.mjs`, and
  the generated `backend/generated/openapi.json` (CI-gated by
  `cargo run --bin gen-openapi -- --check`). `public/serve.json` is a sixth
  edit and is RUNTIME load-bearing: `load_rewrites` reads it from the deployed
  bundle to rewrite `/office-addin/word` to `index.html`. Its generator is not
  in CI, so a forgotten regeneration ships a silent production 404.
- Auth is NAA-only. `WordAuthProvider` uses `src/auth/isNestedAppAuthSupported`
  — the Office-gated probe, NOT the Teams one — probed per source rebuild so an
  `AuthGate` retry re-runs mode detection. The login hint comes only from
  `Office.auth.getAuthContext()`; there is no mailbox to fall back to, no
  Exchange on-prem branch and no Graph token provider. Word needs the same SPA
  redirect URI the Teams tab does (exact value under "Per-deployment setup"
  below), and without it the shell renders and never clears `AuthGate`.
- Serving: `WORD_OFFICE_FRAME_ANCESTORS` in
  `backend/erato/src/frontend_environment.rs` adds `*.officeapps.live.com` (the
  WAC frame that hosts the pane on the web) and `*.sharepoint.com` (in the
  chain when the document is opened from SharePoint or OneDrive).
  `frame-ancestors` requires EVERY ancestor to match, so missing either leaves
  the pane blank — the same class of failure the Teams tab records below. The
  origin set is a Microsoft fact, not a repo fact;
  `frontend.extra_frame_ancestors` is the per-deployment escape hatch.
- Test scaffolding: `src/test/mocks/word/document.ts` over the shared
  `setupOffice.ts` global. Installing `Office.onReady` is load-bearing —
  `loadOfficeJs` short-circuits on it, and without it the CDN script's `onload`
  never fires under jsdom and `OfficeProvider` parks on its loading branch.

### Word delivery routes and support matrix

Delivery is **two routes, one manifest**. The selection rule is a property of
the customer, not of the Office build:

- **Integrated apps portal** where the customer has an Exchange Online mailbox
  AND a subscription Office licence.
- **SharePoint app catalog** for every other combination.

One XML manifest (`manifests/manifest-document.xml`) serves both routes,
because the commands node is **ignored where unsupported, not rejected** — the
reason its `<VersionOverrides>` carries no `Requirements` child.

| Combination                                                           | Route                                          | Notes                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows / Mac desktop, subscription licence + Exchange Online mailbox | Integrated apps portal                         | Clears the WordApi 1.7 floor comfortably. Ribbon button and context menu available                                                                                                          |
| Windows desktop, Office LTSC 2024                                     | SharePoint app catalog                         | Sits at WordApi 1.8, so it clears the floor. No ribbon button, no context menu — pane only. Subject to verification (a); NAA sign-in behaviour on such a box is unrecorded                  |
| Word on the web                                                       | Whichever route the mailbox/licence rule picks | Supports all requirement sets. Framed by Office, so the `frame-ancestors` setup below applies                                                                                               |
| iPad                                                                  | Whichever route the mailbox/licence rule picks | WordApi 1.7 since 16.79 (Nov 2023). Pane only on either route — the host has no add-in commands, independent of the distribution channel                                                    |
| Mac desktop, on-premises mailbox                                      | **Unsupported in v1**                          | Mitigation: the catalog exclusion names the Mac desktop client but not the web insertion path, so a customer with a SharePoint **Online** catalog can point these users at Word for the web |
| Any build below WordApi 1.7                                           | None                                           | The add-in does not appear at all, with no error message and no entry point. Intended — and exactly what a confused admin reports as a bug                                                  |

- **The no-commands constraint belongs to the distribution channel, not the
  Office build.** Perpetual Office 2021+ supports add-in commands normally when
  it receives the add-in another way; it is the catalog route that drops them.
  iPad is pane-only for a separate reason — the host has no add-in commands —
  so an iPad user who receives the add-in on the **portal** route is pane-only
  too. Ribbon and context-menu entry points are therefore additive affordances,
  and every capability must also be reachable inside the pane.
- **Requirement-set facts the rows rest on.** Office LTSC 2024 sits at WordApi
  1.8; iPad has had 1.7 since 16.79 (Nov 2023); Word on the web supports all
  requirement sets. Office LTSC 2021 caps **below** WordApi 1.7, which is a
  capability fact independent of any date — separately it leaves support on
  2026-10-14, and Erato does not support end-of-support builds, but that is the
  reason the floor was allowed to move off 1.3, not the reason LTSC 2021 fails
  it. LTSC 2024 is the only perpetual build in the matrix.
- **One catalog entry, not one per host.** The manifest is host-neutral and
  declares the Word host alone in v1, so Excel and PowerPoint later join the
  **same** catalog entry with a version bump rather than a second entry and a
  second install. A declared host is a live promise: an admin-deployed host
  downloads on next launch, so no host is declared before its facets exist.
- **Rollout is incremental: test users first, wider customer release decided
  later.** This is a delivery rule, not a suggestion. It is the ratified
  mitigation for the accepted v1 window in which Erato writes prose
  indistinguishable from the user's own typing with no in-file trace (D-14 —
  no Erato identifier is written into the document).
- **A public marketplace listing is ruled out technically**, so it should not be
  re-proposed: `SourceLocation` is a single fixed URL, one listing is therefore
  one origin, and customers self-host at different origins.
- **Open verifications** (each needs an environment that does not exist yet;
  none is resolved here): (a) whether `Paragraph.uniqueLocalId` functions on an
  Office 2024 LTSC box with no Microsoft 365 subscription identity signed in —
  `isSetSupported` reports it available either way, so only a real read proves
  it; on failure that host falls back to the search-anchor design and only the
  `word.apply_edits` resolution step changes. (b) whether a catalog-inserted
  task pane persists per document — if it does not, the catalog rows gain the
  explicit step "insert Erato from the catalog in each new document" (copy, not
  code). (c) one SharePoint catalog upload test recording both whether the
  upload is accepted and whether ribbon commands render for a catalog
  recipient; a rejected upload refutes "two routes, one manifest" and goes back
  to the owner.

### Per-deployment setup for Word

Three things a deployment needs before a Word user there can send anything.
They belong together, next to the Teams NAA requirement below.

1. **The SPA redirect URI.** Word has no mailbox, so the NAA path applies and
   mirrors Teams. Register an **SPA** redirect URI `brk-multihub://<host>`,
   where `<host>` is the host and port serving the task pane — exactly the
   string `getSpaRedirectUri()` emits in `src/pages/AddinSetupPage.tsx`
   (`brk-multihub://${window.location.host}`). No scheme, no path, no trailing
   slash. Note the wording gap: the Teams note below says
   `brk-multihub://<origin>` "(origin only, no path)" while the code emits host
   **and port**; the two agree for a default-port HTTPS deployment, and what
   Entra accepts for a non-default port is unverified — the code's form is the
   one to register. It goes on the Entra app registration whose client id is
   `integrations.ms_office.addin.msal_client_id`; the backend injects it into
   the add-in bundle and `createEntraAuthSource().initialize()` reads it as
   `VITE_MSAL_CLIENT_ID ?? env().msalClientId`. This is **per host, not per
   Office app**: a deployment already running the Outlook Exchange Online route
   or the Teams tab from the same origin has it registered already, so this is
   a no-op there and real work only for a Word-first deployment or one whose
   pane moves to a new host. **Open, not answered:** whether Word also needs an
   oauth2-proxy login page in `displayDialogAsync` as a fallback for a host
   without usable NAA. Today's `Oauth2ProxyLoginProvider` cannot serve that
   unchanged — `OutlookAuthProvider` gates the proxy path on
   `Office.context.mailbox`, which Word never has, and the provider lives under
   `src/outlook/**`, which the ESLint host peer fence puts out of reach of
   `src/word/**`.
2. **The subscription content package carrying the `word_*` action facets.**
   The facets are config-only and live in the separate `erato-subscription-content`
   repo. A deployment that receives the Word add-in without that package fails
   **hard, not softly**: `validate_action_facet` returns a 400 "Unknown action
   facet" on every document send, and that 400 fires before a chat row exists.
   The facets must additionally declare `platform = "word"`, which is what makes
   `is_known_platform` accept the `X-Erato-Platform` value the Word route
   stamps; without it `warn_unknown_platform` logs on every Word request. So
   "has the subscription package with the Word facets" is a delivery
   precondition, not a nice-to-have.
3. **`frame-ancestors` for Word on the web.** `WORD_OFFICE_FRAME_ANCESTORS` in
   `backend/erato/src/frontend_environment.rs` ships the seed
   `https://*.officeapps.live.com` and `https://*.sharepoint.com`. That seed is
   a Microsoft fact awaiting confirmation against a real tenant; any additional
   framing origin is recorded per deployment as a
   `frontend.extra_frame_ancestors` value, and belongs back in the shipped
   default only if it is universal. No additional origin is known today.

Which deployments need which of the three, and which of them are in the
test-user group, is enumerated in the `rollout-config` sub-issues that ship the
add-in config keys and the subscription package — this section describes the
work, it does not duplicate that inventory.

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
- Graph: `TeamsAuthProvider` mounts the shared `GraphTokenProvider` over the NAA
  source, so a Teams-hosted component can acquire a Graph token. The chat data
  layer (`src/teams/utils`, `src/teams/hooks`) reads chats, messages and search
  with delegated `Chat.Read`. Everything chat-scoped goes through
  `runGatedByChat`: Graph allows only 1 rps against a single chat, so paging one
  conversation is inherently serial and a fan-out is a bug, not a missed
  optimization. Reads across _different_ chats are what that gate cannot bound;
  `runWithChatReadSlot` caps those so a search page cannot land as one burst.
- Chat picker: `TeamsChatPickerProvider` sits above `NeutralAddinChatPage` and
  owns the picker dialog plus the in-flight transcript build. It cannot live
  under the composer's "+" popover — `AnchoredPopover` dismisses on any
  `pointerdown` outside its panel, and a portalled dialog is a DOM sibling of
  that panel, so it would close itself on first click. The menu row only hands
  over the composer's `onSelectFiles` and closes the menu; the selection is
  serialized to one markdown `File` and goes through the ordinary upload path.
- Not shipped: production manifest distribution (`manifests/manifest.json` is
  the local unified package).
