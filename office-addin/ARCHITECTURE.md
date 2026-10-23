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
  (`useAvailableActionFacets.ts`), the proposal validator
  (`proposedClientAction.ts`) and the fresh-completion tracker. They are
  generic over the action id (`TAction extends string`); each host keeps its
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
- `src/word` — the Word task pane at `/office-addin/word`. `WordApp.tsx`
  composes the shared Office.js providers with Word auth, session, document
  capture, review and write components. Document protocols and OOXML
  compilation stay under `src/word/utils`; shared UI comes from the frontend library.
- The shared Office.js ring — stays in `src/providers`, `src/hooks`,
  `src/utils`: `OfficeProvider`, `OfficeThemeProvider`, `useOfficeTheme`,
  `utils/officeTheme/`, `officeAsync.ts`, the drag-drop broker
  (`officeDragAndDropBroker.ts` + `useOfficeDragAndDrop.ts`), and
  `detectExchangeOnPrem.ts`. This ring is office.js-generic and is planned to
  become `src/office`. Word also consumes this ring. The rename and injection
  of the mailbox-specific `detectExchangeOnPrem` remain separate work.
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
   `erato.addin.teams.currentChat.v1`; Word supplies
   `WordAddinSessionController` (one chat per document, see the Word host).
   Each host keeps an independent selection.
3. **Auth** — a host auth provider mounts `SessionAuthProvider`
   (`src/core/SessionAuthProvider.tsx`) with an `AuthSource`; `AuthGate` reads
   only the `SessionAuthCore` fields. The NAA source
   (`createEntraNaaAuthSource`) is host-portable: Outlook injects a
   mailbox-aware `LoginHintResolver`, other hosts inject a mailbox-less one.
4. **Settings contribution** — `AddinSettingsDialogCore`
   (`src/core/AddinSettingsDialogCore.tsx`) takes
   `hostContribution?: AddinSettingsHostContribution` (tab label, heading,
   description, content, optional system description, appearance notice and
   `serversToolsEntities` — the host's rows in the Servers & Tools pane, e.g.
   Outlook's actions entity wrapping the core `ClientActionsSettings`).
   A host tab requires `content`; Word contributes tool rows without a host tab.
5. **Component registry** — hosts assign `componentRegistry` overrides at
   host-module eval: `src/outlook/OutlookApp.tsx` calls
   `installOutlookComponentRegistrations()` at module scope, before React
   renders. The registry is a mutable global, so exactly one host per loaded
   document — contributions stay route-local because only the matched lazy
   route module is evaluated. `src/teams/TeamsApp.tsx` mirrors this with
   `installTeamsComponentRegistrations()`, which contributes only
   `ChatAddMenuExtraContent`. Word registers its renderer in `HostCardCodeBlock`.
   Component-kit registrations are re-applied at the
   entry point via `applyComponentKitRegistrations()` in `src/main.tsx`.
6. **Platform identifier** — stamped explicitly per host, never inferred from
   a host SDK: the `platform` prop on `AddinChatProviderCore` flows into
   messaging and is sent as the `X-Erato-Platform` request header. Values:
   `web` (shared-frontend default), `outlook`, `teams`, `word`, `addin-neutral`
   (`NeutralAddinChatPage` default), future `excel`.

## Boundary enforcement (`eslint.config.mjs`)

- Core fence — an `import/no-restricted-paths` zone: `src/core/**` may not
  import anything under `src/` outside `./core`. Backed by
  `no-restricted-globals` for `Office`/`OfficeRuntime` and a name-based
  `no-restricted-imports` denylist (`**/OfficeProvider`, `**/Outlook*`,
  `**/outlook/**`, `**/sessionPolicy/**`, `**/useOutlook*`, `**/Teams*`,
  `**/teams/**`, `@microsoft/teams-js`, `**/Word*`, `**/word/**`).
- Host peer fence — `src/outlook/**`, `src/teams/**` and `src/word/**` may not
  import each other: one host SDK and one set of registry overrides per document. The
  Teams block also carries the `Office`/`OfficeRuntime` global ban.
- Residue-ring guard — `src/hooks`, `src/providers`, `src/utils`, `src/auth`
  may not import `**/outlook/**`, `**/teams/**` or `**/word/**` (test mocks excepted):
  shared code must not depend on a host module; move it out or invert the
  dependency.
- Characterization tests —
  `src/core/__tests__/NeutralAddinChatPage.test.tsx` renders the full neutral
  page with the `Office` global deleted and asserts no office.js CDN script
  (`appsforoffice.microsoft.com`) is appended;
  `src/teams/__tests__/TeamsApp.test.tsx` makes the same assertions for the
  Teams route and pins its storage key, MSAL ordering and the exact registry
  contribution (the add-menu row, and no Outlook renderers);
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

`WordApp` composes the shared shell and Office.js providers with Word auth
without a mailbox dependency. The manifest uses a distinct document add-in
identity and inherits deployment branding from the mail configuration.

Each document gets its own chat: `WordAddinSessionController` keeps the open
chat in pane state and remembers it per document in
`erato.addin.word.documentChats.v1`, keyed by a SHA-256 of the normalized URL.
Unsaved documents always start a new chat, and a chat whose history GET returns
404 is forgotten.

The open document is included by default (`default_settings.word_include_document`,
overridable per user and dismissible per chat); a selection the user made is
sent instead. The pane captures ahead of the send and reuses that capture until
Word reports a change (paragraph events, our own card operations, a Track Changes
check on returning to the pane, or any return where paragraph events are
unavailable); a failed read is retried at the next send, and a send never waits
on it longer than the capture deadline. Each send gets its own
copy with a fresh snapshot token. The host validates submitted structured plans
before offering consent; accepted plans still pass live-state checks before writing.
The compiler owns native XML, while the model receives typed document data.
Behavior instructions and action facets come from deployment configuration.

Writes are serialized across cards. Office.js batches can partially apply on
failure, so recovery preserves the original body or full file as appropriate.
Captures and recovery state live in pane memory and are lost on reload.

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
- The standalone Teams manifest is staged as `manifest-teams.json` and served
  with its package from `/office-addin/teams`. Teams distribution is configured
  separately from the Outlook and Word XML add-ins.
- `manifests/manifest.json` remains as a parked combined Outlook + Teams
  manifest reference for future work. It is not staged or used by the current
  standalone Teams distribution or local Teams package flow.

## Client tools in delegated tasks

A delegated task can read through the pane its parent turn was sent from,
under a grant the server writes when the task launches. The core is
host-neutral (`backend/delegated-client-tools.md`); the Linear document
"Contract: delegated tasks with client tools" is the contract. Each host
supplies an adapter, and two conformance suites hold every adapter to the same
lineage check, read-only mode, freshness shape and loss outcomes.

### Checklist (contract §13)

| #   | Item                                                                        | Where it lives                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | A host context kind and a binding sent as `X-Erato-Executor`                | The kind is compiled (`ClientToolHostContext` in `backend/erato_config/src/config.rs`). The pane registers its binding per tool with `registerOperationExecutor`; Word builds it in `word/utils/wordDocumentOperationBinding.ts`, Outlook in `outlook/hooks/useOutlookClientTools.ts`.                                         |
| 2   | The executor stream, handlers by tool, grant-capable tools advertised       | The shared coordinator opens the stream (`openExecutorStream` in `frontend/src/lib/clientOperations/`). Register each read with `registerClientToolExecutor(name, execute, isAvailable, { acceptsGrantCalls: true })`; only those are listed in `X-Erato-Child-Client-Tools`.                                                  |
| 3   | The lineage check (§7)                                                      | The handler compares `ClientToolCallContext.hostGrant` with its own context owner and version before it reads anything.                                                                                                                                                                                                        |
| 4   | A read-only mode for every child-eligible tool                              | Configuration marks the tool: `child_access = "read"` and `host_context`, plus `child_context_arg` and `child_context_input` for a captured context version. Under `hostGrant` the handler returns no write token and no write guidance and leaves the coordinator's state alone; write handlers refuse it.                    |
| 5   | A freshness producer, with its blind spots documented                       | `result.freshness` on every read (§10), listed in the host context template below.                                                                                                                                                                                                                                             |
| 6   | Typed loss outcomes (§6)                                                    | A terminal `ok: false`: `validationErrors[].code` set to `capture-unavailable` (Word) or `context_unavailable`, with `submissionFeedback: { terminal: true, recovery: "cannot_continue" }`. A refusal on the device answers with the code `declined`; the backend does not map it to the `declined` outcome yet (ERMAIN-1034). |
| 7   | An overlay child facet                                                      | `facets.facets.<id>` with `child_host_context`: regular, not `hidden`, prompt only without `tool_call_allowlist`, listed in the coordinator facet's `delegation.child_facet_ids` and named in `facet_ids` by its template. Example: `[facets.facets.mailbox_reader]` in `backend/erato.template.toml`.                         |
| 8   | Read results framed as untrusted data                                       | ERMAIN-946, before enablement.                                                                                                                                                                                                                                                                                                 |
| 9   | A native gate matrix                                                        | The template below, filled for the host.                                                                                                                                                                                                                                                                                       |
| 10  | The conformance tests pass                                                  | A backend row and a frontend handler test, see "Adding a host".                                                                                                                                                                                                                                                                |
| 11  | An approval scope and its outside-change signal, or approval per call       | ERMAIN-1033.                                                                                                                                                                                                                                                                                                                   |
| 12  | Pickup of durable calls after a reconnect, if the context outlives the pane | ERMAIN-1032. Word never takes the slow path.                                                                                                                                                                                                                                                                                   |
| 13  | Device approvals for a grant call registered under the owner chat           | `useConfirmationRegistryStore` under `hostGrant.ownerChatId`. The shared file approval moves there in ERMAIN-1034.                                                                                                                                                                                                             |
| 14  | The release decision where a native component holds the data                | CT-9, in that component.                                                                                                                                                                                                                                                                                                       |

### Host context template

Fill one in per host and keep it with the host's issue.

```text
Host context:          kind; identity (what the binding names); realm
Context version:       source; child_context_arg -> child_context_input, or none
Read tools:            qualified names, registered with acceptsGrantCalls
Write tools:           qualified names, each refusing hostGrant
Loss code:             capture-unavailable | context_unavailable
Freshness:             producer; capturedAt | readAt; blind spots (each reports unknown)
Child facet:           id; prompt text
Approval scope:        call | context; the outside-change signal
Outlives the pane:     no | yes (slow path, ERMAIN-1032)
Device approvals:      none | which, under the owner chat; release decision (CT-9)
Framing:               untrusted-data framing of read results (ERMAIN-946)
Conformance:           backend row; frontend handler test; enabling issue
```

### Native gate matrix template

Each cell holds "date · build · result". Windows first, then Mac and the web.

| Check                                                          | Windows | Mac | Web |
| -------------------------------------------------------------- | ------- | --- | --- |
| A grant read reaches the pane and returns                      |         |     |     |
| A foreign or stale grant gets the loss code                    |         |     |     |
| After a new Send, the earlier turn's grant gets the loss code  |         |     |     |
| A closed pane gives `context_unavailable`                      |         |     |     |
| Ask on the parent's card: approve reads, deny gives `declined` |         |     |     |
| A blind spot reports `unknown`                                 |         |     |     |
| Write tools refuse grant calls                                 |         |     |     |
| A device approval shows in the parent chat                     |         |     |     |

### Adding a host

- Backend: `client_tool_operations/delegated/conformance.rs` (under
  `backend/erato/tests/integration_tests/api/messages/`) runs every case once
  per row of `delegated/rows.rs`, against a test-driven pane. A row names the
  host's binding, read tool, action-facet arguments, context version, the part
  a read asks for and the freshness its pane reports. A new host adds one row
  constructor and one `host_conformance!(module_name: row())` line.
- Frontend: `clientToolHostAdapterConformanceFailures` from
  `@erato/frontend/conformance` runs the host's registered handlers through
  the registration, lineage, read-only, write, device-approval and freshness
  rules and returns the failures. The host's handler test supplies the
  harness: how a turn starts, the coordinator's state, one call per read and
  write tool, the write markers, the blind spots and any device approval.

Status:

- fake host: passes on both sides, with and without a context version
  (`frontend/src/conformance/clientToolHostAdapter.test.ts`);
- `word_document`: registered and skipped until ERMAIN-1003
  (`word/utils/__tests__/wordGrantReadConformance.test.ts`);
- `outlook_mailbox`: registered and skipped until ERMAIN-1006
  (`outlook/hooks/__tests__/outlookGrantReadConformance.test.ts`);
- `desktop_sidecar`: ERMAIN-1034 adds the kind and its rows.

## Scoped Word cell reads

Authoring sends document identity, snapshot token, status and paragraph counts;
`wordActionFacet.ts` withholds the paragraph excerpt and heading outline. The
capture remains complete on the host. Review-only facets retain their excerpt.
An authoring capture has no initially writable paragraph ordinals, so paragraph
replacement artifacts cannot target text withheld from the model. Broader
requests use the existing paginated read and complete-plan workflow. Application
and customer instructions, permissions and MCP routing are unchanged.

`read_document_blocks` has an additive `table_cell` query with an explicit
`documentIdentity`. `wordTableCellRead.ts` searches the immutable inventory using
nearby text, first-row headers, first-column labels, current cell text and exact
source coordinates. These labels describe physical positions, not inferred
semantic roles. Search filters are bounded ANDed substrings. Results distinguish
not-found, ambiguous, unsupported and ready; ambiguity yields at most five
candidates per offset page and grants no authorization. Snippets are at most
256 serialized UTF-8 bytes and explicitly indicate truncation. A ready result
contains the exact target text (at most 4096 UTF-8 bytes), coordinates and a
random cell-scoped read token. At most 16 scopes are retained per request.

`wordTableCellScope.ts` binds that token to snapshot, identity, fingerprint and
exact original cell/text. Chat and assistant-request ownership remains in
`WordDocumentReadSession`. Targeted reads never mark body, story or layout
records as read and never create the full-read token. Scoped submissions must
use the existing concise envelope; full plans and repairs still require full
coverage. The host expands the concise edit into a complete plan. Validation
compares the entire normalized plan to the deterministic one-cell expansion,
including all keep entries and retained rows/cells, before ordinary validation,
compilation and preservation verification. Review and Apply repeat this scope
check; Apply also retains live fingerprint, document URL, tracking, consent and
recovery checks. A read grants no write permission.

The expanded plan is kept in the accepted receipt for review, as with the
existing concise implementation. Acceptance terminates model generation; later
receipt replay excludes the plan. Rejections on the scoped path expose bounded
diagnostics, with no materialized draft. All submission forms retain the shared
three-attempt deployment budget and existing argument/source/plan limits.

Discovery, scope authorization and plan validation use snapshot data and XML
utilities without Office.js calls. This keeps the editing core reusable by a
future server MCP or WASM host. This change uses the existing Office.js package
writer; it adds no native cell writer, MCP server or WASM runtime.

The supported operation remains one plain-text paragraph with uniform run
formatting in a standalone, unmerged body table. Rich/multiple paragraphs,
wrappers, nesting, merged cells, oversized target context, row changes and
formatting changes use complete reads and existing authoring. Existing capture
and conservative model-budget eligibility limits are unchanged. Tests cover
bounded context, scoped authorization and preservation.
